"""Read-only probe of the real import parser/row validator against generated fixtures.

The probe never opens a database session and monkey-patches only _build_task so
successful rows become in-memory dictionaries. Reference dictionaries contain
one existing team name and no protected records are created or changed.
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path


ROOT = Path.cwd()
BACKEND = ROOT / "dmb-backlog" / "backend"
sys.path.insert(0, str(BACKEND))

import import_service  # noqa: E402


EVIDENCE = ROOT / "docs" / "dev-testing" / "evidence" / "import-testing-2026-09-20"
INPUTS = EVIDENCE / "inputs"
TEAM = "Проектный офис"


FIELD_MAP = {import_service._norm(key): key for key in import_service.IMPORTABLE_FIELDS}
FIELD_MAP.update({
    import_service._norm("Название задачи"): "title",
    import_service._norm("Ответственная команда"): "team_id",
})
LABELS = {key: key for key in import_service.IMPORTABLE_FIELDS}
REQUIRED = {"title", "team_id"}
REFS = {
    "teams": {import_service._norm(TEAM): 1},
    "channels": {},
    "business_customers": {},
    "did_client_groups": {},
    "contacts_by_name": {},
    "departments": {},
    "projects": {},
    "task_types": {},
    "priorities": {},
    "deadlines": {},
    "statuses": {},
    "users": {},
}


def build_in_memory(_db, task_data, jira_links, _user_id):
    return {**task_data, "_jira_links": list(jira_links)}


import_service._build_task = build_in_memory


def probe(path: Path) -> dict:
    raw = path.read_bytes()
    item = {"file": path.name, "bytes": len(raw)}
    if len(raw) > 10 * 1024 * 1024:
        item.update(stage="router", outcome="http_413")
        return item
    if not raw:
        item.update(stage="router", outcome="http_400_empty")
        return item
    try:
        content = import_service.decode_content(raw)
        delimiter = import_service.detect_delimiter(content)
        rows = import_service.parse_csv(content, delimiter)
    except Exception as exc:  # exact production parser behavior is the evidence
        item.update(stage="parse", outcome=type(exc).__name__, message=str(exc))
        return item

    errors = []
    created = 0
    skipped = 0
    for index, row in enumerate(rows, start=2):
        try:
            task, row_errors = import_service.process_row(
                index,
                row,
                FIELD_MAP,
                LABELS,
                REFS,
                REQUIRED,
                None,
                1,
            )
        except Exception as exc:
            errors.append({"type": "probe_exception", "message": f"{type(exc).__name__}: {exc}"})
            skipped += 1
            continue
        errors.extend(row_errors)
        if task is None:
            skipped += 1
        else:
            created += 1

    item.update(
        stage="rows",
        outcome="completed",
        delimiter=repr(delimiter),
        total=len(rows),
        created=created,
        skipped=skipped,
        error_types=dict(sorted(Counter(e["type"] for e in errors).items())),
        fatal_errors=sum(1 for e in errors if e.get("fatal")),
        nonfatal_errors=sum(1 for e in errors if not e.get("fatal")),
    )
    return item


results = []
for file_path in sorted(INPUTS.iterdir()):
    if file_path.suffix.lower() != ".csv":
        continue
    results.append(probe(file_path))

output = EVIDENCE / "parser-probe-results.json"
output.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Probed {len(results)} CSV fixtures -> {output}")
for result in results:
    if result["outcome"] != "completed" or result.get("error_types"):
        print(json.dumps(result, ensure_ascii=False))
