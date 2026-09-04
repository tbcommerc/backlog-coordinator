"""Read-only customer portfolio and shared screen/export rules."""
from datetime import date, datetime
from decimal import Decimal
from functools import cmp_to_key
import math
import re

TITLE = "Бэклог для отправки на бизнес-заказчиков ДИД"
COLUMNS = (
    ("did_client_group", "Группировка для клиентов ДИД", 12),
    ("team_name", "Ответственная команда / кластер", 12),
    ("project_name", "Проект", 10),
    ("title", "Задача", 15),
    ("task_type_name", "Тип задачи", 8),
    ("department_name", "Подразделение Бизнес-заказчика", 12),
    ("business_customer_contact", "Бизнес-заказчик", 9),
    ("deadline_name", "Срок выполнения", 10),
    ("financial_effect", "Фин. эффект, млн ₽", 12),
)
FIELDS = {c[0] for c in COLUMNS}
EXCLUDED_STATUSES = {"холд", "отклонена", "не актуальна"}


def current_quarter(today=None):
    today = today or date.today()
    return f"{(today.month - 1) // 3 + 1}Q {today.year}"


def deadline_quarters(value):
    """Accept 1Q/Q1, lists of quarters; annual goals belong to Q4 (BR-02)."""
    value = str(value or "").upper().strip()
    pairs = re.findall(r"(?:([1-4])\s*Q|Q\s*([1-4]))\s*(20\d{2})(?!\d)", value)
    result = {f"{a or b}Q {year}" for a, b, year in pairs}
    annual = re.fullmatch(r"(?:Y\s*)?(20\d{2})(?:\s*Г(?:ОД)?\.?)?", value)
    if annual:
        result.add(f"4Q {annual[1]}")
    return result


def missing(value):
    return value is None or (isinstance(value, str) and value.strip().casefold() in {"", "(без названия)"})


def report_quarters(deadline, task_type):
    """The Q4 annual exception applies to goals, not annual AD-HOC tasks."""
    quarters = deadline_quarters(deadline)
    is_annual = re.fullmatch(r"(?:Y\s*)?(20\d{2})(?:\s*Г(?:ОД)?\.?)?", str(deadline or "").upper().strip())
    if is_annual and str(task_type or "").strip().casefold() != "квартальная/годовая цель":
        return set()
    return quarters


def clean_prefs(raw):
    raw = raw if isinstance(raw, dict) else {}
    prefs = {"quarter": current_quarter(), "filters": {}, "sortField": None,
             "sortDir": "asc", "widths": {key: width for key, _, width in COLUMNS}}
    if isinstance(raw.get("quarter"), str) and re.fullmatch(r"[1-4]Q 20\d{2}", raw["quarter"]):
        prefs["quarter"] = raw["quarter"]
    for key, values in (raw.get("filters") or {}).items() if isinstance(raw.get("filters"), dict) else []:
        if key in FIELDS and isinstance(values, list):
            prefs["filters"][key] = list(dict.fromkeys(str(v)[:1000] for v in values[:1000] if isinstance(v, (str, int, float)) and not missing(v)))
    if isinstance(raw.get("sortField"), str) and raw["sortField"] in FIELDS:
        prefs["sortField"] = raw["sortField"]
    if isinstance(raw.get("sortDir"), str) and raw["sortDir"] in {"asc", "desc"}:
        prefs["sortDir"] = raw["sortDir"]
    widths = raw.get("widths")
    if isinstance(widths, dict) and all(isinstance(widths.get(k), (float, int)) and math.isfinite(widths[k]) and 4 <= widths[k] <= 68 for k in FIELDS):
        if abs(sum(widths[k] for k in FIELDS) - 100) < .01:
            prefs["widths"] = {k: widths[k] for k in FIELDS}
    return prefs


def task_row(task):
    def name(rel):
        item = getattr(task, rel, None)
        return getattr(item, "name", None) if item else None
    row = {"id": task.id, "did_client_group": name("did_client_group"),
           "team_name": name("team"), "project_name": name("project"), "title": task.title,
           "task_type_name": name("task_type"), "department_name": name("department"),
           "business_customer_contact": name("business_customer_rel"),
           "deadline_name": name("deadline"),
           "financial_effect": float(task.financial_effect) if task.financial_effect is not None else None}
    row["gaps"] = [key for key in FIELDS if missing(row[key])]
    row["group_order"] = getattr(getattr(task, "did_client_group", None), "sort_order", 0) or 0
    return row


def value_key(value):
    if isinstance(value, (int, float, Decimal)):
        return format(Decimal(str(value)).normalize(), 'f') if value else "0"
    return str(value).strip()


def apply_view(rows, prefs):
    prefs = clean_prefs(prefs)
    rows = [row for row in rows if all(not values or (not missing(row[key]) and value_key(row[key]) in values)
                                      for key, values in prefs["filters"].items())]
    field = prefs["sortField"]
    if not field:
        return sorted(rows, key=lambda r: (missing(r["did_client_group"]), r["group_order"],
                      (r["did_client_group"] or "").casefold(), missing(r["financial_effect"]), -(r["financial_effect"] or 0), r["id"]))
    def compare(a, b):
        av, bv = a[field], b[field]
        if missing(av) or missing(bv):
            return int(missing(av)) - int(missing(bv)) or a["id"] - b["id"]
        if field != "financial_effect":
            av, bv = str(av).casefold().replace("ё", "е"), str(bv).casefold().replace("ё", "е")
        result = (av > bv) - (av < bv)
        return result * (-1 if prefs["sortDir"] == "desc" else 1) or a["id"] - b["id"]
    return sorted(rows, key=cmp_to_key(compare))


def summary(rows):
    return {"empty_values": sum(len(r["gaps"]) for r in rows),
            "tasks_with_gaps": sum(bool(r["gaps"]) for r in rows)}


def display_value(row, key):
    if key in row["gaps"]:
        return "не заполнено"
    if key == "financial_effect":
        return f'{row[key]:,.1f}'.replace(",", "\u00a0").replace(".", ",")
    if key == "task_type_name" and row[key].casefold() == "квартальная/годовая цель":
        return "Цель"
    return str(row[key])
