"""Разбор запроса Координатора в CLI.

Координатор передаёт запрос файлом, и файл составлен по контракту: конверт с
типом сценария и вложенными атрибутами — тот же, что принимают REST-эндпоинты.
До этих тестов CLI понимал только голые атрибуты, и файл по контракту он
отвергал. Расхождение не ловилось ничем: контракт проверялся на уровне сервиса,
а путь через командную строку тестов не имел вовсе, хотя именно им пользуется
инструмент opencode.
"""

from __future__ import annotations

import json

import pytest

from value_priority_assessor.cli import main

ATTRS = {
    "task_id": "TASK-300-014",
    "task_type": "AD-HOC",
    "team": "Core",
    "title": "Автоматическая сверка расчётных документов",
}
PRIORITY_ATTRS = {
    **ATTRS,
    "deadline": "3Q 2026",
    "effort_man_days": 12.0,
    "business_customer": "И. Иванов",
}


def _run(tmp_path, session, scenario, payload):
    """Прогон сценария через CLI: файл на входе, файл на выходе."""
    request = tmp_path / "request.json"
    request.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    out = tmp_path / "response.json"
    code = main(["agent", scenario, "--json", str(request), "--out", str(out)])
    answer = json.loads(out.read_text(encoding="utf-8")) if out.exists() else None
    return code, answer


class TestEnvelope:
    def test_value_scenario_accepts_the_contract_envelope(self, tmp_path, session):
        code, answer = _run(tmp_path, session, "value", {"request_type": "value", "task": ATTRS})

        assert code == 0
        assert set(answer) == {
            "value_internal", "value_internal_confidence", "value_internal_logic"
        }
        assert answer["value_internal_confidence"] in {"низкая", "средняя", "высокая"}

    def test_priority_scenario_accepts_the_contract_envelope(self, tmp_path, session):
        code, answer = _run(
            tmp_path, session, "priority", {"request_type": "priority", "task": PRIORITY_ATTRS}
        )

        assert code == 0
        assert set(answer) == {
            "priority_score", "priority_score_confidence", "priority_score_logic"
        }
        assert answer["priority_score"] in {"P1", "P2", "P3", "P4", "P5"}

    def test_prompt_in_the_envelope_is_ignored(self, tmp_path, session):
        """Формулировка задания из Координатора приходит рядом с атрибутами и
        на расчёт не влияет — но и отвергать запрос из-за неё нельзя."""
        code, answer = _run(
            tmp_path, session, "value",
            {"request_type": "value", "task": ATTRS, "prompt": "Рассчитай Value"},
        )
        assert code == 0
        assert answer["value_internal_logic"]

    def test_bare_attributes_still_work(self, tmp_path, session):
        """Голые атрибуты остаются рабочей формой: ими пользуются скрипты."""
        code, answer = _run(tmp_path, session, "value", ATTRS)
        assert code == 0
        assert "value_internal" in answer


class TestEnvelopeIsChecked:
    def test_scenario_mismatch_is_refused(self, tmp_path, session):
        """Файл говорит «приоритет», вызван «value».

        Молча посчитать не тот сценарий хуже, чем отказать: Координатор
        записал бы результат не в то поле карточки.
        """
        code, answer = _run(
            tmp_path, session, "value", {"request_type": "priority", "task": PRIORITY_ATTRS}
        )
        assert code == 2
        assert answer is None

    def test_unknown_key_in_the_envelope_is_refused(self, tmp_path, session):
        code, answer = _run(
            tmp_path, session, "value", {"request_type": "value", "task": ATTRS, "extra": 1}
        )
        assert code == 2
        assert answer is None


def test_refusal_keeps_the_three_field_schema(tmp_path, session):
    """Нехватка атрибутов — штатный ответ, а не сбой: схема та же, код 0.

    Код возврата сообщает о работоспособности программы, а не об исходе
    расчёта: иначе обёртка вокруг CLI сочтёт отказ падением и выбросит ответ.
    """
    code, answer = _run(tmp_path, session, "priority", {"request_type": "priority", "task": ATTRS})

    assert code == 0
    assert answer["priority_score"] is None
    assert answer["priority_score_confidence"] == "низкая"
    assert "РАСЧЁТ НЕ ВЫПОЛНЕН" in answer["priority_score_logic"]
