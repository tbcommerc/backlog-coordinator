#!/usr/bin/env python3
"""Проверка качества выдачи RAG на контрольном наборе из пакета K3.

Пакет несёт 25 размеченных запросов (`quality/k3-queries.json`): для каждого
указаны ожидаемые источники, а три запроса помечены `no_answer` — на них
корректный ответ «в корпусе этого нет».

Смысл проверки. Векторный поиск легко «работает» на глаз: он всегда что-то
возвращает, и выдача всегда выглядит правдоподобно. Отличить работающий поиск
от неработающего можно только на размеченном наборе, где заранее известно,
какой источник обязан оказаться в выдаче. Поэтому набор из пакета —
не приложение к RAG, а условие того, чтобы называть его рабочим.

    python3 scripts/rag_quality.py
    python3 scripts/rag_quality.py --top-k 8 --json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from app.rag.corpus import K3_DIR, k3_installed  # noqa: E402
from app.rag.search import search_corpus  # noqa: E402

QUERY_SET = K3_DIR / "quality" / "k3-queries.json"


def _chunk_sources(results: list[dict]) -> tuple[set[str], set[str]]:
    """Логические имена источников и канонические идентификаторы в выдаче."""
    logical: set[str] = set()
    canonical: set[str] = set()
    for item in results:
        meta = item.get("metadata") or {}
        if meta.get("logical_source"):
            logical.add(str(meta["logical_source"]))
        if meta.get("canonical_id"):
            canonical.add(str(meta["canonical_id"]))
    return logical, canonical


def run(top_k: int) -> dict:
    payload = json.loads(QUERY_SET.read_text(encoding="utf-8"))
    queries = payload.get("queries") or []

    answered_total = 0
    answered_hit = 0
    required_total = 0
    required_hit = 0
    no_answer_total = 0
    no_answer_correct = 0
    rows: list[dict] = []

    for item in queries:
        query = item["query"]
        result = search_corpus(query, top_k=top_k, layer="k3")
        results = result["results"]
        logical, canonical = _chunk_sources(results)

        expected = set(item.get("expected_sources") or [])
        required = set(item.get("required_sources") or [])
        is_no_answer = bool(item.get("no_answer"))

        row = {
            "id": item["id"],
            "category": item["category"],
            "no_answer": is_no_answer,
            "returned": len(results),
        }

        if is_no_answer:
            no_answer_total += 1
            # Для no-answer запросов корпус не содержит ответа. Ретривер всё
            # равно что-то вернёт — важно, чтобы это «что-то» не совпало
            # с реальными источниками, то есть чтобы модель не выдумала
            # соответствие там, где его нет.
            ok = not (logical & expected) if expected else True
            no_answer_correct += int(ok)
            row["ok"] = ok
        else:
            answered_total += 1
            hit = bool(logical & expected) if expected else False
            answered_hit += int(hit)
            row["hit"] = hit
            row["matched"] = sorted(logical & expected)

            if required:
                required_total += 1
                # required_sources ссылается на канонический идентификатор
                # (form-4441), а не на имя файла.
                got = bool(canonical & required) or bool(logical & required)
                required_hit += int(got)
                row["required_hit"] = got

        rows.append(row)

    def rate(hit: int, total: int) -> float:
        return round(hit / total, 4) if total else 1.0

    return {
        "corpus_id": payload.get("corpus_id"),
        "chunking_version": payload.get("chunking_version"),
        "top_k": top_k,
        "queries": len(queries),
        "retrieval_mode": search_corpus("проверка", top_k=1, layer="k3")["retrieval_mode"],
        "metrics": {
            "hit_at_k": rate(answered_hit, answered_total),
            "hit_at_k_counts": f"{answered_hit}/{answered_total}",
            "required_source_hit": rate(required_hit, required_total),
            "required_source_counts": f"{required_hit}/{required_total}",
            "no_answer_precision": rate(no_answer_correct, no_answer_total),
            "no_answer_counts": f"{no_answer_correct}/{no_answer_total}",
        },
        "rows": rows,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Качество выдачи RAG на наборе K3")
    parser.add_argument("--top-k", type=int, default=8, help="глубина выдачи (в наборе 8)")
    parser.add_argument("--json", action="store_true", help="полный JSON вместо сводки")
    parser.add_argument(
        "--min-hit", type=float, default=0.0, help="минимальный hit@k, иначе выход с кодом 1"
    )
    args = parser.parse_args(argv)

    if not k3_installed():
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "пакет K3 не установлен: python3 scripts/rag_package_install.py install",
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 3

    report = run(args.top_k)

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        metrics = report["metrics"]
        print(f"корпус:          {report['corpus_id']}")
        print(f"режим поиска:    {report['retrieval_mode']}")
        print(f"запросов:        {report['queries']}, top_k={report['top_k']}")
        print()
        print(f"hit@k:                 {metrics['hit_at_k']:.2f}  ({metrics['hit_at_k_counts']})")
        print(f"обязательный источник: {metrics['required_source_hit']:.2f}  ({metrics['required_source_counts']})")
        print(f"no-answer precision:   {metrics['no_answer_precision']:.2f}  ({metrics['no_answer_counts']})")
        misses = [r for r in report["rows"] if r.get("hit") is False]
        if misses:
            print()
            print("промахи:")
            for row in misses:
                print(f"  {row['id']} [{row['category']}] вернулось {row['returned']} фрагментов")

    if report["metrics"]["hit_at_k"] < args.min_hit:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
