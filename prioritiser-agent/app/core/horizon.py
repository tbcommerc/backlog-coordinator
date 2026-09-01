"""Период получения дохода.

Правило из ТЗ: доход считается за три года, начиная с периода, следующего за
сроком выполнения. Пока задача не сдана, она не приносит денег, поэтому окно
сдвинуто относительно срока, а не относительно даты постановки.

Гранулярность сдвига повторяет гранулярность срока: «3Q 2026» → окно
начинается 1 октября 2026, «2026» → окно начинается 1 января 2027. Считать
квартальный срок годовым означало бы терять до трёх кварталов дохода, а
годовой квартальным — приписывать доход раньше, чем работа закончена.
"""

from __future__ import annotations

import calendar
import datetime as dt

from app.core.normalise import parse_deadline_period

HORIZON_YEARS = 3


def _next_quarter_start(end: dt.date) -> dt.date:
    """Первый день квартала, следующего за тем, что кончается `end`."""
    quarter = (end.month - 1) // 3 + 1
    if quarter == 4:
        return dt.date(end.year + 1, 1, 1)
    return dt.date(end.year, quarter * 3 + 1, 1)


def revenue_window(
    deadline: object,
    *,
    today: dt.date | None = None,
    years: int = HORIZON_YEARS,
) -> tuple[dt.date, dt.date, str, str | None]:
    """Возвращает (начало, конец, откуда взято, предупреждение).

    Конец — последний день окна, а не первый день следующего: окно из трёх лет,
    начавшееся 1 октября 2026, кончается 30 сентября 2029.

    Когда срока нет, окно отсчитывается от квартала, следующего за текущим.
    Это допущение, а не факт, поэтому оно возвращается предупреждением и должно
    дойти до пользователя: без срока неизвестно, когда доход вообще начнётся.
    """
    today = today or dt.date.today()
    parsed = parse_deadline_period(deadline)

    warning: str | None = None
    if parsed is None:
        end_of_period = _quarter_end_of(today)
        granularity = "quarter"
        derived_from = "срок не указан"
        warning = (
            "Срок выполнения не указан: период дохода отсчитан от квартала, "
            "следующего за текущим. Это допущение — при появлении срока оценку "
            "нужно пересчитать."
        )
    else:
        end_of_period, granularity = parsed
        derived_from = str(deadline)

    if granularity == "year":
        start = dt.date(end_of_period.year + 1, 1, 1)
    else:
        start = _next_quarter_start(end_of_period)

    end = _shift_years(start, years) - dt.timedelta(days=1)
    return start, end, derived_from, warning


def _quarter_end_of(day: dt.date) -> dt.date:
    month = ((day.month - 1) // 3 + 1) * 3
    return dt.date(day.year, month, calendar.monthrange(day.year, month)[1])


def _shift_years(day: dt.date, years: int) -> dt.date:
    """`day` плюс `years` лет. 29 февраля уезжает на 1 марта."""
    try:
        return day.replace(year=day.year + years)
    except ValueError:
        return day.replace(year=day.year + years, month=3, day=1)
