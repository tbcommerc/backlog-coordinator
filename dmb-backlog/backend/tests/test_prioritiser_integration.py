from datetime import date
from types import SimpleNamespace

from routers import prioritiser_router


class _Query:
    def filter(self, *_args, **_kwargs):
        return self

    def all(self):
        return [SimpleNamespace(id=2, name="AI"), SimpleNamespace(id=3, name="Core")]


class _Db:
    def query(self, *_args, **_kwargs):
        return _Query()


def _task(**overrides):
    values = {
        "id": 17,
        "public_id": "DMB-000017",
        "title": "Автоматизация сверки лимитов",
        "description": "Сверять лимиты без ручной обработки",
        "date_received": date(2026, 8, 1),
        "team": SimpleNamespace(name="Finance"),
        "task_type": SimpleNamespace(name="AD-HOC"),
        "department": SimpleNamespace(name="Корпоративный бизнес"),
        "project": SimpleNamespace(name="Лимиты"),
        "deadline": SimpleNamespace(name="4Q 2026"),
        # Keep the fixture aligned with the real Task ORM relationship name.
        "business_customer_rel": SimpleNamespace(name="Иван Иванов"),
        "involved_teams": [2, 3],
        "effort_days": 25,
        "financial_effect": None,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_task_payload_matches_prioritiser_contract():
    payload = prioritiser_router._task_payload(_task(), _Db())

    assert payload == {
        "task_id": "DMB-000017",
        "task_type": "AD-HOC",
        "team": "Finance",
        "title": "Автоматизация сверки лимитов",
        "description": "Сверять лимиты без ручной обработки",
        "created_date": "2026-08-01",
        "customer_division": "Корпоративный бизнес",
        "project": "Лимиты",
        "deadline": "4Q 2026",
        "involved_teams": "AI, Core",
        "effort_man_days": 25.0,
        "business_customer": "Иван Иванов",
        "value_internal_mln": None,
    }


def test_value_endpoint_returns_proposal_without_database_write(monkeypatch):
    task = _task()
    monkeypatch.setattr(prioritiser_router, "_load_task", lambda *_args: task)
    monkeypatch.setattr(
        prioritiser_router,
        "_call_prioritiser",
        lambda path, payload: {
            "status": "ok",
            "value": {
                "value_mln": 42.5,
                "explanation": "Оценка по аналогам.",
                "confidence": "medium",
                "range": {"text": "20–80 млн ₽"},
            },
            "warnings": ["Нужно уточнить число сделок"],
        },
    )

    monkeypatch.setattr(
        prioritiser_router,
        "update_task",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("расчёт не должен писать в БД")),
    )
    body = prioritiser_router.PrioritiserRunRequest(version=7)
    user = SimpleNamespace(id=1)

    proposal = prioritiser_router.calculate_task_value(17, body, _Db(), user)
    assert proposal.version == 7
    assert proposal.value_mln == 42.5
    assert "Диапазон оценки: 20–80 млн ₽" in proposal.justification


def test_value_is_saved_to_main_fields_only_after_approval(monkeypatch):
    captured = {}
    monkeypatch.setattr(prioritiser_router, "_load_task", lambda *_args: _task())

    def fake_update(task_id, changes, db, user):
        captured.update(task_id=task_id, changes=changes, db=db, user=user)
        return "updated"

    monkeypatch.setattr(prioritiser_router, "update_task", fake_update)
    body = prioritiser_router.PrioritiserValueApproval(
        version=8,
        value_mln=42.5,
        justification="Принятая пользователем оценка.",
    )

    assert prioritiser_router.approve_task_value(17, body, _Db(), SimpleNamespace(id=1)) == "updated"
    assert captured["changes"].version == 8
    assert captured["changes"].financial_effect == 42.5
    assert captured["changes"].financial_effect_justification == "Принятая пользователем оценка."
    assert "financial_effect_ai" not in captured["changes"].model_fields_set


def test_priority_endpoint_converts_raw_score_to_percent(monkeypatch):
    captured = {}
    task = _task()
    monkeypatch.setattr(prioritiser_router, "_load_task", lambda *_args: task)
    monkeypatch.setattr(
        prioritiser_router,
        "_call_prioritiser",
        lambda path, payload: {
            "status": "ok",
            "priority": {"priority": "P2", "score": 0.684, "rationale": "Сильный вклад Value."},
            "value": {"value_mln": 35.0, "explanation": "Оценка по аналогам.", "confidence": "high"},
            "warnings": [],
        },
    )

    def fake_update(task_id, changes, db, user):
        captured["changes"] = changes
        return "updated"

    monkeypatch.setattr(prioritiser_router, "update_task", fake_update)

    assert prioritiser_router.calculate_task_priority(
        17,
        prioritiser_router.PrioritiserRunRequest(version=3),
        _Db(),
        SimpleNamespace(id=1),
    ) == "updated"
    assert captured["changes"].priority_score == 68
    assert "Приоритет P2" in captured["changes"].priority_justification
    assert "financial_effect_ai" not in captured["changes"].model_fields_set
