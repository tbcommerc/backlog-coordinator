"""Контракт с Координатором: обязательные поля, строгость схем, ключ кэша."""

from __future__ import annotations

import datetime as dt

import pytest
from pydantic import ValidationError

from app.api.contract import (
    AgentResponse,
    Analogue,
    FactorResult,
    Horizon,
    PriorityRequest,
    PriorityResult,
    ResponseAudit,
    TaskAttributes,
    ValueRequest,
    ValueResult,
    cache_key,
    cache_key_payload,
    check_required,
)


def make_task(**overrides) -> TaskAttributes:
    base = {
        "task_id": "TASK-300-014",
        "task_type": "КВАРТАЛЬНАЯ/ГОДОВАЯ ЦЕЛЬ",
        "team": "IB",
        "title": "Поиск потенциалов для новых выпусков облигаций",
        "project": "РЕАЛИЗОВАН ПОИСК ПОТЕНЦИАЛОВ ДЛЯ НОВЫХ ВЫПУСКОВ ОБЛИГАЦИЙ",
        "deadline": "3Q 2026",
        "created_date": dt.date(2026, 1, 15),
    }
    return TaskAttributes(**{**base, **overrides})


def test_value_needs_less_than_priority():
    task = make_task()
    assert check_required(task, "value") == []
    assert check_required(task, "priority") == ["effort_man_days", "business_customer"]


def test_priority_is_complete_with_effort_and_customer():
    task = make_task(effort_man_days=40, business_customer="Иванов И.И.")
    assert check_required(task, "priority") == []


def test_blank_string_counts_as_missing():
    """Пустая строка — не заполненное поле, а видимость заполненного."""
    task = make_task(effort_man_days=40, business_customer="   ")
    assert "business_customer" in check_required(task, "priority")


def test_unknown_attribute_is_rejected():
    """Молча проглоченное поле — данные, которые Координатор считает учтёнными."""
    with pytest.raises(ValidationError):
        TaskAttributes(
            task_id="T-1", task_type="AD-HOC", team="IB", title="…", velue_mln=10
        )


def test_cosmetic_text_changes_do_not_miss_the_cache():
    """Лишний пробел от копирования не должен вызывать новый расчёт."""
    a = make_task(title="Автоматизация  отчёта")
    b = make_task(title="автоматизация отчёта ")
    assert cache_key(a, "value") == cache_key(b, "value")


def test_meaningful_change_changes_the_key():
    a = make_task()
    b = make_task(title="Совсем другая задача")
    assert cache_key(a, "value") != cache_key(b, "value")


def test_scenarios_do_not_share_a_key():
    """Один и тот же вход в двух сценариях даёт разные ответы."""
    task = make_task(effort_man_days=40, business_customer="Иванов И.И.")
    assert cache_key(task, "value") != cache_key(task, "priority")


def test_prompt_wording_is_outside_the_key():
    """Переформулировка задания Координатором не меняет цифру."""
    task = make_task()
    a = ValueRequest(task=task, prompt="Рассчитай Value(internal) по инициативе ниже")
    b = ValueRequest(task=task, prompt="Посчитай, пожалуйста, финансовый эффект")
    assert cache_key(a.task, "value") == cache_key(b.task, "value")


def test_unset_and_null_attributes_are_equivalent():
    """`null` и отсутствие поля — одно и то же состояние «не заполнено»."""
    a = make_task(description=None)
    b = make_task()
    assert cache_key(a, "value") == cache_key(b, "value")
    assert "description" not in cache_key_payload(a, "value")


def test_request_types_are_fixed():
    assert ValueRequest(task=make_task()).request_type == "value"
    assert PriorityRequest(task=make_task()).request_type == "priority"


def _audit(**overrides) -> ResponseAudit:
    base = {
        "request_id": "3f2b",
        "cache_key": "9a71",
        "cached": False,
        "reference_versions": {"value_drivers": 2},
        "snapshot_version": "2026-08-11",
        "computed_at": dt.datetime(2026, 8, 13, 10, 24, 11),
    }
    return ResponseAudit(**{**base, **overrides})


def test_value_response_round_trips_through_json():
    """Ответ должен собираться и разбираться: его читает чужая система."""
    from app.api.contract import ValueRange

    response = AgentResponse(
        task_id="TASK-300-014",
        request_type="value",
        value=ValueResult(
            value_mln=126.75,
            range=ValueRange(
                low_mln=4.2, high_mln=148.0, text="4.2–148 млн ₽", coverage=0.95
            ),
            explanation="Среднее доходной и сравнительной оценок…",
            confidence="medium",
            method="blended",
            horizon=Horizon(
                start=dt.date(2026, 10, 1),
                end=dt.date(2029, 9, 30),
                derived_from="3Q 2026",
            ),
            calculation="(53.5 + 200.0) / 2 = 126.75 млн ₽",
            missing_inputs=["Ожидаемое число сделок в год"],
            method_divergence=3.74,
        ),
        audit=_audit(),
    )
    restored = AgentResponse.model_validate_json(response.model_dump_json())
    assert restored.value is not None
    assert restored.value.value_mln == 126.75
    assert restored.value.range is not None
    assert restored.value.range.low_mln < restored.value.value_mln < restored.value.range.high_mln
    assert restored.priority is None


def test_coordinator_template_has_exactly_three_fields():
    """Ответ уходит в чужую систему напрямую — лишние ключи там не нужны."""
    from app.api.contract import CoordinatorValueOut, ValueRange, to_coordinator

    assert set(CoordinatorValueOut.model_fields) == {
        "value_internal",
        "value_internal_confidence",
        "value_internal_logic",
    }

    out = to_coordinator(
        ValueResult(
            value_mln=126.75,
            range=ValueRange(
                low_mln=1.0, high_mln=3655.0, text="1.0–3 655 млн ₽", coverage=0.95
            ),
            explanation="Среднее двух методов…",
            confidence="low",
            method="blended",
        )
    )
    assert out.value_internal == 126.75
    assert out.value_internal_confidence == "низкая"
    assert out.value_internal_logic == "Среднее двух методов…"


def test_confidence_field_accepts_only_three_words():
    """Поле перечислимое: посторонняя строка не должна туда попасть."""
    from app.api.contract import CoordinatorValueOut

    for level in ("низкая", "средняя", "высокая"):
        CoordinatorValueOut(
            value_internal=1.0, value_internal_confidence=level, value_internal_logic="…"
        )

    with pytest.raises(ValidationError):
        CoordinatorValueOut(
            value_internal=1.0,
            value_internal_confidence="1.0–3 655 млн ₽ (уверенность низкая)",
            value_internal_logic="…",
        )


def test_priority_response_carries_factor_provenance():
    """Балл «нейтрально, данных не было» обязан отличаться от посчитанного."""
    response = AgentResponse(
        task_id="TASK-300-014",
        request_type="priority",
        priority=PriorityResult(
            priority="P2",
            score=0.647,
            factors=[
                FactorResult(code="F1", title="Value (внутренний)",
                             weight=0.34, score=0.71, contribution=0.169,
                             explanation="Value 25 млн ₽ при максимуме 3600 млн ₽",
                             source="computed"),
                FactorResult(code="F2", title="Уровень бизнес-заказчика",
                             weight=0.15, score=0.5, contribution=0.075,
                             explanation="Уровень заказчика не определён",
                             source="default"),
            ],
            rationale="…",
        ),
        audit=_audit(cached=True, reused_from_request_id="1a2b"),
    )
    restored = AgentResponse.model_validate_json(response.model_dump_json())
    assert restored.priority is not None
    sources = {f.code: f.source for f in restored.priority.factors}
    assert sources == {"F1": "computed", "F2": "default"}
    assert restored.audit.cached is True


def test_response_rejects_unknown_fields():
    with pytest.raises(ValidationError):
        AgentResponse(
            task_id="T-1", request_type="value", audit=_audit(), priorty="P1"
        )
