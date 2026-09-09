"""Streamlit-интерфейс приоритизатора.

    streamlit run app/ui/streamlit_app.py

UI ходит в базу напрямую, а не через FastAPI: это прототип на одной машине, и
лишний сетевой слой между двумя локальными процессами ничего не проверяет.
Вся логика живёт в `app.core`, поэтому расхождения между UI и API невозможны.
"""

from __future__ import annotations

import pandas as pd
import streamlit as st
from sqlalchemy import select

from app.core.attribution import AttributionError, run_attribution
from app.core.db import init_db, session_scope
from app.core.models import Task
from app.core.references import (
    ReferenceError,
    get_reference,
    save_reference,
    validate_weights,
)
from app.core.scoring import FACTOR_TITLES
from app.core.service import REASON_MANUAL, REASON_WEIGHTS, recompute_all, recompute_task

st.set_page_config(page_title="Приоритизатор инициатив трайба", layout="wide")

PRIORITY_HELP = {
    "P1": "Критично",
    "P2": "Высокий",
    "P3": "Средний",
    "P4": "Низкий",
    "P5": "Отложено",
}


@st.cache_data(ttl=5)
def load_tasks() -> pd.DataFrame:
    with session_scope() as session:
        tasks = session.scalars(
            select(Task).order_by(Task.priority.asc(), Task.priority_score.desc())
        ).all()
        return pd.DataFrame(
            [
                {
                    "ID": t.task_key,
                    "Приоритет": t.priority,
                    "Скор": round(t.priority_score, 3) if t.priority_score else None,
                    "Команда": t.team,
                    "Задача": t.title,
                    "Тип": t.task_type,
                    "Value внутр., млн ₽": t.value_internal_mln,
                    "Диапазон 95%": (
                        f"{t.value_low_mln:g}–{t.value_high_mln:g}"
                        if t.value_low_mln is not None
                        and t.value_high_mln is not None
                        and t.value_low_mln != t.value_high_mln
                        else "—"
                    ),
                    "Value внеш., млн ₽": t.value_external_mln,
                    "Метод Value": t.value_source,
                    "Уверенность": t.value_confidence,
                    "Трудозатраты, ч/д": t.effort_man_days,
                    "C/V": round(t.cost_to_value, 3) if t.cost_to_value else None,
                    "Срок": t.deadline,
                    "Был приоритет": t.backlog_priority_original,
                }
                for t in tasks
            ]
        )


def _refresh() -> None:
    load_tasks.clear()


st.title("Агент-приоритизатор инициатив трайба")

with st.sidebar:
    st.header("Управление")
    if st.button("Пересчитать весь бэклог", type="primary", width="stretch"):
        with st.spinner("Пересчитываю…"), session_scope() as session:
            stats = recompute_all(session, reason=REASON_WEIGHTS)
        _refresh()
        st.success(
            f"Пересчитано {stats.total} задач за {stats.duration_seconds:.1f} с; "
            f"приоритет изменился у {stats.priority_changed}."
        )

    st.caption(
        "Пересчёт не обращается к модели заново: классификация задач кэширована "
        "и от весов не зависит."
    )

tab_backlog, tab_task, tab_weights, tab_constants, tab_attribution = st.tabs(
    ["Бэклог", "Карточка задачи", "Веса факторов", "Драйверы расчёта", "Ex-post атрибуция"]
)

# --- Бэклог ------------------------------------------------------------------
with tab_backlog:
    frame = load_tasks()
    if frame.empty:
        st.warning("Бэклог пуст. Выполните `python -m app.cli init --reset`.")
    else:
        left, middle, right = st.columns(3)
        teams = left.multiselect("Команда", sorted(frame["Команда"].dropna().unique()))
        priorities = middle.multiselect("Приоритет", ["P1", "P2", "P3", "P4", "P5"])
        search = right.text_input("Поиск по названию")

        view = frame
        if teams:
            view = view[view["Команда"].isin(teams)]
        if priorities:
            view = view[view["Приоритет"].isin(priorities)]
        if search:
            view = view[view["Задача"].str.contains(search, case=False, na=False)]

        counters = st.columns(5)
        for column, priority in zip(counters, ["P1", "P2", "P3", "P4", "P5"]):
            column.metric(
                f"{priority} · {PRIORITY_HELP[priority]}",
                int((view["Приоритет"] == priority).sum()),
            )

        st.dataframe(view, width="stretch", height=520, hide_index=True)
        st.caption(f"Показано {len(view)} из {len(frame)} задач.")

# --- Карточка задачи ---------------------------------------------------------
with tab_task:
    frame = load_tasks()
    if not frame.empty:
        task_key = st.selectbox("Задача", frame["ID"].tolist())
        with session_scope() as session:
            task = session.scalar(select(Task).where(Task.task_key == task_key))
            if task is not None:
                head_left, head_right = st.columns([3, 1])
                head_left.subheader(task.title or task.task_key)
                head_right.metric(
                    "Приоритет", task.priority or "—", help=task.priority_reason or ""
                )

                info = st.columns(4)
                info[0].metric("Скор", f"{task.priority_score:.3f}" if task.priority_score else "—")
                # Диапазон показывается подписью под значением: точечная
                # оценка без него выглядит точнее, чем есть.
                range_caption = None
                if (
                    task.value_low_mln is not None
                    and task.value_high_mln is not None
                    and task.value_low_mln != task.value_high_mln
                ):
                    range_caption = (
                        f"95%: {task.value_low_mln:,.1f}–{task.value_high_mln:,.1f}".replace(",", " ")
                    )
                info[1].metric(
                    "Value внутр.",
                    f"{task.value_internal_mln:,.1f} млн ₽".replace(",", " ")
                    if task.value_internal_mln is not None
                    else "—",
                    delta=range_caption,
                    delta_color="off",
                )
                info[2].metric(
                    "Value внеш.",
                    f"{task.value_external_mln:,.1f} млн ₽".replace(",", " ")
                    if task.value_external_mln is not None
                    else "TBD",
                )
                info[3].metric("C/V", f"{task.cost_to_value:.2f}" if task.cost_to_value else "—")

                st.markdown("**Подсказка под полем Value**")
                st.info(task.value_hint or "—")

                if task.applied_overrides:
                    st.markdown("**Сработавшие правила-овверрайды**")
                    for override in task.applied_overrides:
                        st.warning(
                            f"{override.get('title')} "
                            f"({override.get('priority_before')} → {override.get('priority_after')})"
                        )

                st.markdown("**Вклад факторов в скор**")
                contributions = pd.DataFrame(
                    [
                        {
                            "Фактор": FACTOR_TITLES.get(code, code),
                            "Балл": task.factor_scores.get(code),
                            "Вклад": value,
                        }
                        for code, value in (task.factor_contributions or {}).items()
                    ]
                ).sort_values("Вклад", ascending=False)
                st.dataframe(contributions, hide_index=True, width="stretch")

                st.markdown("**Ручная корректировка**")
                with st.form(f"edit-{task.task_key}"):
                    edit_left, edit_right = st.columns(2)
                    manual_value = edit_left.number_input(
                        "Value вручную, млн ₽",
                        value=float(task.value_manual_mln or 0.0),
                        step=1.0,
                    )
                    effort = edit_right.number_input(
                        "Трудозатраты, ч/д",
                        value=float(task.effort_man_days or 0.0),
                        step=1.0,
                    )
                    if st.form_submit_button("Сохранить и пересчитать"):
                        task.value_manual_mln = manual_value or None
                        task.effort_man_days = effort or None
                        recompute_task(session, task, reason=REASON_MANUAL)
                        _refresh()
                        st.success("Пересчитано.")

                history = sorted(task.history, key=lambda h: h.id)
                if history:
                    st.markdown("**История изменений приоритета**")
                    st.dataframe(
                        pd.DataFrame(
                            [
                                {
                                    "Когда": h.created_at,
                                    "Было": h.old_priority,
                                    "Стало": h.new_priority,
                                    "Причина": h.reason,
                                }
                                for h in history
                            ]
                        ),
                        hide_index=True,
                        width="stretch",
                    )

# --- Веса --------------------------------------------------------------------
with tab_weights:
    st.markdown(
        "Сумма весов обязана равняться 1 (ТЗ Ф17). Сохранение создаёт новую "
        "версию справочника и запускает пересчёт всего бэклога."
    )
    with session_scope() as session:
        payload = get_reference(session, "factor_weights")
    weights = dict(payload.get("weights") or {})

    edited: dict[str, float] = {}
    for code, value in weights.items():
        edited[code] = st.slider(
            f"{code} — {FACTOR_TITLES.get(code, code)}",
            min_value=0.0,
            max_value=1.0,
            value=float(value),
            step=0.01,
        )

    total = sum(edited.values())
    (st.success if abs(total - 1.0) < 1e-6 else st.error)(f"Сумма весов: {total:.2f}")

    if st.button("Сохранить веса и пересчитать"):
        new_payload = dict(payload)
        new_payload["weights"] = edited
        try:
            validate_weights(new_payload)
        except ReferenceError as exc:
            st.error(str(exc))
        else:
            with session_scope() as session:
                save_reference(session, "factor_weights", new_payload, actor="ui")
                session.flush()
                stats = recompute_all(session, reason=REASON_WEIGHTS)
            _refresh()
            st.success(
                f"Сохранено. Приоритет изменился у {stats.priority_changed} из {stats.total} задач."
            )

def refs_constants_hour_rate() -> float:
    """Ставка часа для подписи: выводится из бюджета ПШЕ, а не хранится."""
    from app.core.references import ReferenceBundle

    with session_scope() as session:
        return ReferenceBundle(session).constants.man_hour_rate_rub


# --- Драйверы расчёта --------------------------------------------------------
with tab_constants:
    with session_scope() as session:
        payload = get_reference(session, "value_drivers")

    st.caption(
        "Величины, из которых считается финансовый эффект. Столбец «Достоверность» "
        "не украшение: оценка, собранная хотя бы из одного предположения, не может "
        "получить высокий уровень уверенности."
    )

    tier_ru = {"measured": "измерено", "expert": "экспертно", "assumed": "предположение"}
    rows = [
        {
            "Ключ": key,
            "Название": entry.get("title", ""),
            "Значение": entry.get("value"),
            "Ед.": entry.get("unit", ""),
            "Категория": entry.get("category", ""),
            "Достоверность": tier_ru.get(entry.get("tier", ""), entry.get("tier", "")),
            "Источник": entry.get("source", ""),
        }
        for key, entry in (payload.get("drivers") or {}).items()
    ]
    st.dataframe(pd.DataFrame(rows), hide_index=True, width="stretch")

    st.markdown("**Параметры методики**")
    policy_rows = [
        {
            "Ключ": key,
            "Название": entry.get("title", ""),
            "Значение": entry.get("value"),
            "Ед.": entry.get("unit", ""),
            "Источник": entry.get("source", ""),
        }
        for key, entry in (payload.get("policy") or {}).items()
    ]
    st.dataframe(pd.DataFrame(policy_rows), hide_index=True, width="stretch")

    calendar = payload.get("working_days_per_year") or {}
    st.caption(
        "Рабочих дней в году: "
        + ", ".join(f"{year} — {days}" for year, days in sorted((calendar.get("by_year") or {}).items()))
        + f". Ставка часа выводится отсюда же и равна {refs_constants_hour_rate():.0f} ₽/ч — "
        "отдельного справочника констант больше нет."
    )
    st.caption(
        "Правка через админ-эндпоинт PUT /admin/references/value_drivers — "
        "каждая версия сохраняется с автором и временем."
    )

# --- Атрибуция ---------------------------------------------------------------
with tab_attribution:
    st.markdown(
        "Пересчёт `value_external` для обслуживающих команд от факта дохода "
        "фронта (ТЗ Ф8). Запускается вручную методологом или финансистом."
    )
    period = st.text_input("Отчётный период", value="3Q 2026")
    revenue = st.number_input(
        "Фактический доход фронта за период, млн ₽", value=1000.0, step=50.0
    )
    only_closed = st.checkbox("Только закрытые инициативы", value=True)
    with session_scope() as session:
        available_task_keys = list(
            session.scalars(select(Task.task_key).order_by(Task.task_key)).all()
        )
    task_keys = st.multiselect(
        "Инициативы отчётного периода",
        options=available_task_keys,
        help="Выборка фиксируется в результате запуска и не выводится из текстовой метки периода.",
    )

    if st.button("Запустить атрибуцию"):
        try:
            with session_scope() as session:
                result = run_attribution(
                    session,
                    period=period,
                    front_actual_revenue_mln=revenue,
                    task_keys=task_keys,
                    actor="ui",
                    only_closed=only_closed,
                )
        except AttributionError as exc:
            st.error(str(exc))
        else:
            _refresh()
            st.success(f"Распределено {result['residual_mln']:.1f} млн ₽.")
            st.dataframe(
                pd.DataFrame(
                    [
                        {"Команда": team, **values}
                        for team, values in result["teams"].items()
                    ]
                ),
                hide_index=True,
                width="stretch",
            )
