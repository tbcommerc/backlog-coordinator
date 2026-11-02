#!/usr/bin/env python3
"""Калибровка интервала оценки Value на задачах с известным ответом.

Точечная оценка без интервала вводит в заблуждение: «25 млн ₽» и «25 млн ₽,
но реально где-то между 2 и 150» — разные утверждения, а выглядят одинаково.

Интервал считается не из предположения о распределении, а из фактических ошибок:
методом leave-one-out по 192 задачам, где Value заполнил человек, собираются
остатки `log1p(оценка) − log1p(истина)`, и по ним берутся квантили 2.5% и 97.5%.
Это конформная калибровка: доля покрытия проверяется на тех же данных и
записывается в справочник рядом с множителями.

Остатки берутся **раздельно по методу и уровню уверенности** — иначе надёжная
оценка получила бы такой же широкий интервал, как и оценка наугад, и уверенность
перестала бы что-либо значить.

    python3 scripts/value_calibrate.py            # показать калибровку
    python3 scripts/value_calibrate.py --write    # записать в справочник
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

CALIBRATION_PATH = REPO_ROOT / "data" / "references" / "value_intervals.yaml"

# Конформная граница на уровне 95% требует, чтобы ceil(0.95·(n+1)) ≤ n.
# При меньшей выборке квантиль вырождается в максимум остатка и гарантии не даёт,
# поэтому такая группа наследует множители более широкой.
MIN_SAMPLES = 20

CONFIDENCE_ORDER = ("high", "medium", "low")


class _LooIndex:
    """Индекс из соседей одной задачи — чтобы прогнать боевой код оценки."""

    def __init__(self, analogues, same_team: bool, size: int) -> None:
        self._analogues = analogues
        self._same_team = same_team
        self.entries = [None] * size
        self.available = True

    def find(self, task, top_k=3):
        return self._analogues[:top_k], self._same_team


def collect_residuals() -> dict[str, list[tuple[str, float]]]:
    """Остатки на логарифмической шкале по каждому методу и уверенности."""
    import numpy as np
    from sqlalchemy import select

    from value_priority_assessor.config import get_settings
    from value_priority_assessor.core.analogy import Analogue, _passage, estimate_by_analogy
    from value_priority_assessor.core.db import session_scope
    from value_priority_assessor.core.models import Task
    from value_priority_assessor.core.references import ReferenceBundle
    from value_priority_assessor.core.value import compute_value
    from value_priority_assessor.rag.embeddings import get_encoder

    with session_scope() as session:
        refs = ReferenceBundle(session)
        rows = []
        for task in session.scalars(select(Task)).all():
            if task.value_manual_mln is None or not task.title:
                continue
            truth = float(task.value_manual_mln)
            # Формулу считаем со снятым ручным значением, иначе она «предскажет»
            # ответ, прочитав его.
            task.value_manual_mln = None
            formula = compute_value(task, refs)
            task.value_manual_mln = truth
            rows.append(
                {
                    "key": task.task_key,
                    "team": task.team,
                    "title": task.title,
                    "project": task.project,
                    "task_type": task.task_type,
                    "comment": task.comment,
                    "truth": truth,
                    "formula_value": formula.value_internal_mln,
                    "formula_confidence": formula.confidence,
                    "formula_components": (formula.inputs or {}).get("components"),
                }
            )
        session.rollback()

    if len(rows) < MIN_SAMPLES:
        raise SystemExit(f"для калибровки нужно хотя бы {MIN_SAMPLES} задач с ручным Value")

    encoder = get_encoder(get_settings().rag_embedding_model)
    vectors = np.asarray(
        encoder.encode(
            [
                _passage(
                    r["team"], r["title"], r.get("project"),
                    r.get("task_type"), r.get("comment"),
                )
                for r in rows
            ],
            normalize_embeddings=True,
            show_progress_bar=False,
            batch_size=32,
        ),
        dtype="float32",
    )

    class _Task:
        def __init__(self, key: str) -> None:
            self.task_key = key
            self.title = "x"
            self.team = None

    residuals: dict[str, list[tuple[str, float]]] = {
        "analogy": [], "formula": [], "blended": [],
    }

    for i, row in enumerate(rows):
        similarities = vectors @ vectors[i]
        similarities[i] = -1.0
        pool = sorted(
            (
                Analogue(
                    rows[j]["key"], rows[j]["title"], rows[j]["team"],
                    rows[j]["truth"], float(similarities[j]),
                )
                for j in range(len(rows))
                if j != i
            ),
            key=lambda a: a.similarity,
            reverse=True,
        )
        own = [a for a in pool if a.team == row["team"]]
        chosen, same_team = (own, True) if len(own) >= 2 else (pool, False)

        estimate = estimate_by_analogy(
            _Task(row["key"]), _LooIndex(chosen, same_team, len(rows)), row["formula_value"]
        )
        if estimate is not None:
            residuals["analogy"].append(
                (
                    estimate.confidence,
                    math.log1p(max(estimate.value_mln, 0)) - math.log1p(max(row["truth"], 0)),
                )
            )

        if row["formula_value"] is not None:
            residuals["formula"].append(
                (
                    row["formula_confidence"],
                    math.log1p(max(row["formula_value"], 0)) - math.log1p(max(row["truth"], 0)),
                )
            )

        # Среднее двух методов — то, что реально уходит в бэклог, поэтому и
        # калибруется отдельно. Наследовать множители у формулы нельзя: у
        # среднего своя природа ошибки, оно не занижает так сильно.
        if estimate is not None and row["formula_value"] is not None:
            from value_priority_assessor.core.weights import compute_weights

            weights = compute_weights(
                driver_inputs=row.get("formula_components"),
                analogy_available=True,
                count=len(estimate.analogues),
                best_similarity=estimate.best_similarity,
                same_team=estimate.same_team,
                value_spread=estimate.value_spread,
            )
            blended = (
                weights.drivers * row["formula_value"] + weights.analogy * estimate.value_mln
            )
            divergence = max(estimate.value_mln + 0.5, 0.5) / max(
                min(estimate.value_mln, row["formula_value"]) + 0.5, 0.5
            )
            # Уверенность у доминирующего метода — так же, как в расчёте.
            confidence = (
                row["formula_confidence"] if weights.drivers >= weights.analogy
                else estimate.confidence
            )
            if divergence >= 3.0:
                confidence = _one_step_lower(confidence)
            residuals["blended"].append(
                (
                    confidence,
                    math.log1p(max(blended, 0)) - math.log1p(max(row["truth"], 0)),
                )
            )

    return residuals


def _worse(first: str, second: str) -> str:
    ladder = ["high", "medium", "low"]
    return ladder[max(ladder.index(first), ladder.index(second))]


def _one_step_lower(level: str) -> str:
    ladder = ["high", "medium", "low"]
    return ladder[min(ladder.index(level) + 1, 2)]


def _quantiles(values: list[float]) -> tuple[float, float]:
    """Консервативные границы: берём наблюдённые остатки, а не интерполяцию.

    Интерполированный квантиль попадает между наблюдениями и на конечной
    выборке даёт покрытие ниже заявленного — при первом прогоне вышло 92.7%
    вместо 95%. Округление наружу (`lower` для нижней границы, `higher` для
    верхней) гарантирует, что фактическое покрытие не окажется меньше цели.
    """
    import numpy as np

    return (
        float(np.percentile(values, 2.5, method="lower")),
        float(np.percentile(values, 97.5, method="higher")),
    )


def build_calibration(residuals: dict[str, list[tuple[str, float]]]) -> dict:
    """Множители интервала по методу и уверенности, с проверкой покрытия."""
    calibration: dict = {"version": 1, "target_coverage": 0.95, "methods": {}}

    for method, records in residuals.items():
        by_level = {level: [r for c, r in records if c == level] for level in CONFIDENCE_ORDER}
        entries: dict[str, dict] = {}

        # Более широкие уровни считаются первыми: недобравшая группа наследует
        # множители следующей по ширине, а не получает узкий интервал по трём
        # наблюдениям.
        fallback: dict | None = None
        for level in reversed(CONFIDENCE_ORDER):
            sample = by_level[level]
            if len(sample) >= MIN_SAMPLES:
                low, high = _quantiles(sample)
                covered = sum(1 for value in sample if low <= value <= high) / len(sample)
                entry = {
                    "down_factor": round(math.exp(high), 3),
                    "up_factor": round(math.exp(-low), 3),
                    "samples": len(sample),
                    "coverage": round(covered, 4),
                    "calibrated": True,
                }
                fallback = entry
            elif fallback is not None:
                entry = {
                    **{k: fallback[k] for k in ("down_factor", "up_factor")},
                    "samples": len(sample),
                    "coverage": None,
                    "calibrated": False,
                    "inherited_from": "более широкий уровень: наблюдений меньше "
                    f"{MIN_SAMPLES}, конформная граница не определена",
                }
            else:
                continue
            entries[level] = entry

        calibration["methods"][method] = _enforce_monotonicity(
            {level: entries[level] for level in CONFIDENCE_ORDER if level in entries}
        )

    return calibration


def _enforce_monotonicity(levels: dict[str, dict]) -> dict[str, dict]:
    """Интервал не может сужаться при падении уверенности.

    Конформная граница берётся из хвоста распределения остатков, а хвост на
    выборке в несколько десятков наблюдений шумный: у `medium` может оказаться
    один-два промаха на порядок, которых не случилось у `low`, и множитель
    выйдет шире. Получается бессмыслица — оценка, названная средней, получает
    более широкий диапазон, чем названная низкой.

    Инверсия — артефакт малой выборки, а не свойство метода: по медиане ошибка
    растёт монотонно (0.06 → 0.31 → 0.87). Поэтому берём максимум по цепочке
    сверху вниз. Расширение безопасно — покрытие от него только растёт, — а
    сужение исказило бы заявленные 95%.
    """
    result: dict[str, dict] = {}
    widest = {"down_factor": 0.0, "up_factor": 0.0}
    for level in CONFIDENCE_ORDER:  # high → medium → low
        entry = levels.get(level)
        if entry is None:
            continue
        adjusted = dict(entry)
        for factor in ("down_factor", "up_factor"):
            if adjusted[factor] < widest[factor]:
                adjusted[factor] = widest[factor]
                adjusted["widened_to_keep_order"] = True
            widest[factor] = adjusted[factor]
        result[level] = adjusted
    return result


def to_yaml(calibration: dict) -> str:
    import yaml

    header = (
        "# Калибровка интервала оценки Value.\n"
        "#\n"
        "# Файл порождается скриптом и правится только через него:\n"
        "#     python3 scripts/value_calibrate.py --write\n"
        "#\n"
        "# Множители получены конформной калибровкой на задачах, где Value\n"
        "# заполнил человек:\n"
        "#     нижняя граница = оценка / down_factor\n"
        "#     верхняя граница = оценка * up_factor\n"
        "# Целевое покрытие — 95%.\n"
        "#\n"
        "# Интервал у уровня low очень широк, и это не дефект калибровки:\n"
        "# оценка низкой уверенности действительно ничего не гарантирует.\n"
        "# Единственный способ его сузить — заполнить Value вручную.\n"
    )
    return header + yaml.safe_dump(calibration, allow_unicode=True, sort_keys=False)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Калибровка интервала оценки Value")
    parser.add_argument("--write", action="store_true", help="записать в справочник")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    calibration = build_calibration(collect_residuals())

    if args.json:
        print(json.dumps(calibration, ensure_ascii=False, indent=2))
    else:
        print(f"целевое покрытие: {calibration['target_coverage']:.0%}\n")
        print(
            f"{'метод':<10} {'уверенность':<12} {'n':>5} "
            f"{'делим на':>10} {'множим на':>11} {'покрытие':>12}"
        )
        for method, levels in calibration["methods"].items():
            for level, entry in levels.items():
                coverage = (
                    f"{entry['coverage']:.1%}" if entry["coverage"] is not None else "унаследовано"
                )
                print(
                    f"{method:<10} {level:<12} {entry['samples']:>5} "
                    f"{entry['down_factor']:>9.1f}x {entry['up_factor']:>10.1f}x {coverage:>12}"
                )

    if args.write:
        CALIBRATION_PATH.write_text(to_yaml(calibration), encoding="utf-8")
        print(f"\nзаписано: {CALIBRATION_PATH.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
