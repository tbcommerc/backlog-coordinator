#!/usr/bin/env python3
"""Бэктест методов оценки Value на задачах, где его заполнил человек.

Leave-one-out: каждая из задач с известным ответом предсказывается по
остальным, предсказание сравнивается с истиной. Так проверяется утверждение
«аналогия точнее формулы» — иначе оно остаётся мнением.

    python3 scripts/value_backtest.py
    python3 scripts/value_backtest.py --json

Важная оговорка о том, что меряет этот бэктест. Задачи с заполненным Value
похожи друг на друга сильнее, чем на задачи без него: у эталонного набора
медианная схожесть с ближайшим соседом 0.96, у реальных задач без Value —
0.90. Поэтому цифры бэктеста — верхняя граница качества, а не ожидаемая
точность на новых задачах.
"""

from __future__ import annotations

import argparse
import json
import statistics as st
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from sqlalchemy import select  # noqa: E402

from value_priority_assessor.core.db import session_scope  # noqa: E402
from value_priority_assessor.core.models import Task  # noqa: E402

# Сдвиг для отношений: в бэклоге есть задачи с Value = 0.
ZERO_SHIFT = 0.5


def load_reference() -> list[dict]:
    """Задачи с человеческим Value плюс то, что дала бы формула без него."""
    from value_priority_assessor.core.references import ReferenceBundle
    from value_priority_assessor.core.value import compute_value

    with session_scope() as session:
        refs = ReferenceBundle(session)
        rows = []
        for task in session.scalars(select(Task)).all():
            if task.value_manual_mln is None or not task.title:
                continue
            truth = float(task.value_manual_mln)
            # Формулу считаем, сняв ручное значение: иначе она «предскажет»
            # ответ, прочитав его, и покажет стопроцентную точность.
            task.value_manual_mln = None
            formula = compute_value(task, refs).value_internal_mln
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
                    "formula": formula,
                    "components": (
                        compute_value(task, refs).inputs or {}
                    ).get("components"),
                }
            )
        session.rollback()
    return rows


def embed(rows: list[dict]):
    import numpy as np

    from value_priority_assessor.config import get_settings
    from value_priority_assessor.rag.embeddings import get_encoder

    model = get_encoder(get_settings().rag_embedding_model)
    # Текст строится той же функцией, что и в расчёте. Дублировать её здесь
    # значит мерить не ту методику, которая работает: так и случилось — правка
    # `_passage` не отразилась в бэктесте, и он показывал прежние цифры.
    from value_priority_assessor.core.analogy import _passage

    texts = [
        _passage(r["team"], r["title"], r.get("project"), r.get("task_type"), r.get("comment"))
        for r in rows
    ]
    return np.asarray(
        model.encode(texts, normalize_embeddings=True, show_progress_bar=False, batch_size=32),
        dtype="float32",
    )


def score(predictions: list[float], truths: list[float]) -> dict:
    def ratio(a: float, b: float) -> float:
        return max(a + ZERO_SHIFT, ZERO_SHIFT) / max(b + ZERO_SHIFT, ZERO_SHIFT)

    import math

    within2 = sum(1 for p, t in zip(predictions, truths) if 0.5 <= ratio(p, t) <= 2.0)
    within3 = sum(1 for p, t in zip(predictions, truths) if 1 / 3 <= ratio(p, t) <= 3.0)
    log_error = st.median(
        [abs(math.log1p(max(p, 0)) - math.log1p(max(t, 0))) for p, t in zip(predictions, truths)]
    )
    return {
        "within_2x": round(within2 / len(truths), 4),
        "within_3x": round(within3 / len(truths), 4),
        "median_log_error": round(log_error, 4),
    }


def run(top_k: int = 3) -> dict:
    import numpy as np

    from value_priority_assessor.core.analogy import DEFAULT_TOP_K

    rows = load_reference()
    if len(rows) < 10:
        raise SystemExit("недостаточно задач с человеческим Value для бэктеста")

    vectors = embed(rows)
    truths = [r["truth"] for r in rows]
    teams = [r["team"] for r in rows]
    global_median = float(st.median(truths))

    predictions = {
        "global": [], "team": [], "analogy": [], "formula": [],
        "mean_arithmetic": [], "mean_geometric": [], "weighted": [],
    }

    for i, row in enumerate(rows):
        predictions["global"].append(global_median)

        same_team = [t for j, t in enumerate(truths) if teams[j] == row["team"] and j != i]
        predictions["team"].append(float(st.median(same_team)) if same_team else global_median)

        similarities = vectors @ vectors[i]
        similarities[i] = -1.0
        pool = sorted(
            ((float(similarities[j]), truths[j], teams[j]) for j in range(len(rows)) if j != i),
            reverse=True,
        )
        # Та же логика, что в value_priority_assessor/core/analogy.py: аналоги своей команды
        # предпочтительнее, если их хотя бы два.
        own = [p for p in pool if p[2] == row["team"]]
        chosen = own if len(own) >= 2 else pool
        neighbours = [value for _s, value, _t in chosen[:top_k]]
        predictions["analogy"].append(float(st.median(neighbours)))

        formula_value = row["formula"] if row["formula"] is not None else global_median
        predictions["formula"].append(formula_value)

        # Итоговая цифра для бэклога — среднее двух методов (решение владельца
        # от 2026-08-18). Меряем оба вида среднего: величины различаются на
        # порядки, и для таких данных геометрическое среднее обычно устойчивее
        # арифметического, которое тянется за большим из двух чисел.
        analogy_value = predictions["analogy"][-1]
        predictions["mean_arithmetic"].append((analogy_value + formula_value) / 2)
        shifted = [max(v, 0.0) + ZERO_SHIFT for v in (analogy_value, formula_value)]
        predictions["mean_geometric"].append((shifted[0] * shifted[1]) ** 0.5 - ZERO_SHIFT)

        # Действующая методика: вес доходного метода зависит от обоснованности
        # его вводных и от качества аналогов.
        from value_priority_assessor.core.weights import compute_weights

        values = [v for _s, v, _t in chosen[:top_k]]
        spread = 1.0
        if len(values) > 1:
            shifted_vals = [v + ZERO_SHIFT for v in values]
            spread = max(shifted_vals) / min(shifted_vals)
        weights = compute_weights(
            driver_inputs=row.get("components"),
            analogy_available=True,
            count=len(values),
            best_similarity=chosen[0][0] if chosen else 0.0,
            same_team=chosen is own,
            value_spread=spread,
        )
        predictions["weighted"].append(
            weights.drivers * formula_value + weights.analogy * analogy_value
        )

    best_similarity = []
    for i in range(len(rows)):
        similarities = vectors @ vectors[i]
        similarities[i] = -1.0
        best_similarity.append(float(similarities.max()))

    return {
        "reference_tasks": len(rows),
        "top_k": top_k,
        "default_top_k": DEFAULT_TOP_K,
        "methods": {name: score(preds, truths) for name, preds in predictions.items()},
        "similarity_within_reference": {
            "p10": round(float(np.percentile(best_similarity, 10)), 4),
            "median": round(float(np.median(best_similarity)), 4),
            "p90": round(float(np.percentile(best_similarity, 90)), 4),
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Бэктест методов оценки Value")
    parser.add_argument("--top-k", type=int, default=3)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    report = run(args.top_k)

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0

    titles = {
        "global": "медиана всего бэклога",
        "team": "медиана команды",
        "analogy": f"аналогия по {args.top_k} похожим задачам",
        "formula": "формула по типовым значениям",
        "mean_arithmetic": "среднее арифметическое двух методов",
        "mean_geometric": "среднее геометрическое двух методов",
        "weighted": "взвешенная сумма (действующая методика)",
    }
    print(f"задач с человеческим Value: {report['reference_tasks']}\n")
    print(f"{'метод':<34} {'в 2 раза':>10} {'в 3 раза':>10} {'log-ошибка':>12}")
    for name, metrics in report["methods"].items():
        print(
            f"{titles[name]:<34} {metrics['within_2x']:>9.1%} "
            f"{metrics['within_3x']:>10.1%} {metrics['median_log_error']:>12.3f}"
        )
    similarity = report["similarity_within_reference"]
    print(
        f"\nсхожесть внутри эталонного набора: p10 {similarity['p10']:.3f} | "
        f"медиана {similarity['median']:.3f} | p90 {similarity['p90']:.3f}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
