"""Нормализация сырых значений Единого бэклога.

Экспорт из Confluence приходит грязным: неразрывные пробелы внутри значений
(`КВАРТАЛЬНАЯ/ГОДОВАЯ\\xa0ЦЕЛЬ`), числа то с точкой, то с запятой, сроки —
списком кварталов вида `1Q 2026,2Q 2026`. Всё это чинится здесь, один раз,
на входе в БД, чтобы дальше по коду ходили уже чистые типы.
"""

from __future__ import annotations

import calendar
import datetime as dt
import re

_WHITESPACE_RE = re.compile(r"\s+")
_QUARTER_RE = re.compile(r"(?:(?P<q1>[1-4])\s*Q|Q\s*(?P<q2>[1-4]))\s*(?P<year>20\d{2})", re.IGNORECASE)
_YEAR_RE = re.compile(r"\b(20\d{2})\b")
_NUMBER_RE = re.compile(r"-?\d+(?:[.,]\d+)?")

# Явные пометки «срока нет» встречаются в поле «Срок выполнения».
_NO_DEADLINE_MARKERS = {"без срока", "нет срока", "n/a", "-", "—"}


def clean_text(value: object) -> str | None:
    """Приводит значение к чистой строке: NBSP → пробел, схлопывание пробелов."""
    if value is None:
        return None
    text = str(value).replace("\xa0", " ").replace(" ", " ")
    text = _WHITESPACE_RE.sub(" ", text).strip()
    return text or None


def normalise_key(value: object) -> str | None:
    """Ключ для сопоставления со справочниками: чистый текст в верхнем регистре."""
    text = clean_text(value)
    return text.upper() if text else None


def parse_number(value: object) -> float | None:
    """Достаёт первое число. Терпит `473.0`, `54,7`, `355 млн руб.`."""
    if value is None:
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    text = clean_text(value)
    if not text:
        return None
    match = _NUMBER_RE.search(text.replace(" ", ""))
    if not match:
        return None
    try:
        return float(match.group(0).replace(",", "."))
    except ValueError:
        return None


def quarter_end(year: int, quarter: int) -> dt.date:
    month = quarter * 3
    return dt.date(year, month, calendar.monthrange(year, month)[1])


def parse_deadline(value: object) -> dt.date | None:
    """Срок выполнения → конкретная дата.

    Договорённость (handoff, раздел 8.3): из списка кварталов берётся последний,
    дата = конец этого квартала. Голый год `2026` → 31 декабря. `БЕЗ СРОКА` и
    пустое значение → None, фактор срочности получит балл «нет дедлайна».
    """
    text = clean_text(value)
    if not text:
        return None
    if text.lower() in _NO_DEADLINE_MARKERS:
        return None

    quarters = [
        (int(m.group("year")), int(m.group("q1") or m.group("q2")))
        for m in _QUARTER_RE.finditer(text)
    ]
    if quarters:
        year, quarter = max(quarters)
        return quarter_end(year, quarter)

    years = [int(y) for y in _YEAR_RE.findall(text)]
    if years:
        return dt.date(max(years), 12, 31)
    return None


def parse_deadline_period(value: object) -> tuple[dt.date, str] | None:
    """Срок выполнения → (конец периода, гранулярность).

    Отличается от `parse_deadline` тем, что сохраняет, чем был задан срок —
    кварталом или годом. Это нужно расчёту периода получения дохода: он
    начинается со следующего периода той же гранулярности, и для «3Q 2026»
    следующий период — 4Q 2026, а для «2026» — весь 2027 год.

    Гранулярность: `"quarter"` или `"year"`.
    """
    text = clean_text(value)
    if not text or text.lower() in _NO_DEADLINE_MARKERS:
        return None

    quarters = [
        (int(m.group("year")), int(m.group("q1") or m.group("q2")))
        for m in _QUARTER_RE.finditer(text)
    ]
    if quarters:
        year, quarter = max(quarters)
        return quarter_end(year, quarter), "quarter"

    years = [int(y) for y in _YEAR_RE.findall(text)]
    if years:
        return dt.date(max(years), 12, 31), "year"
    return None


def parse_date(value: object) -> dt.date | None:
    """Разбирает `1 янв. 2026 г.` — формат поля «Дата поступления задачи»."""
    text = clean_text(value)
    if not text:
        return None
    months = {
        "янв": 1, "фев": 2, "мар": 3, "апр": 4, "ма": 5, "июн": 6,
        "июл": 7, "авг": 8, "сен": 9, "окт": 10, "ноя": 11, "дек": 12,
    }
    match = re.match(r"(\d{1,2})\s+([А-Яа-яё]+)\.?\s*(20\d{2})", text)
    if match:
        day, month_word, year = match.groups()
        month_word = month_word.lower()
        for prefix, number in months.items():
            if month_word.startswith(prefix):
                try:
                    return dt.date(int(year), number, int(day))
                except ValueError:
                    return None
    try:
        return dt.date.fromisoformat(text[:10])
    except ValueError:
        return None


def split_teams(value: object) -> list[str]:
    """«Другие вовлечённые команды» — список через запятую, точку с запятой или перенос."""
    text = clean_text(value)
    if not text:
        return []
    parts = re.split(r"[,;/\n]+", text)
    return [p.strip() for p in parts if p.strip()]


def contains_any(text: str | None, keywords: list[str]) -> bool:
    """Регистронезависимый поиск любого из ключевых слов."""
    if not text:
        return False
    lowered = text.lower()
    return any(keyword.lower() in lowered for keyword in keywords)
