"""LLM-адаптер, кэш вызовов и поиск по корпусу."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.core.models import LlmCall
from app.llm.base import parse_hints, prompt_hash
from app.llm.factory import classify_with_cache, get_adapter
from app.llm.mock import MockAdapter
from app.rag.search import search_corpus
from app.strategy.decomposer import StubStrategyDecomposer


class TestMockAdapter:
    def test_is_deterministic(self):
        """Воспроизводимость — условие того, чтобы прогон бэклога был сравним
        с предыдущим, а расхождение считалось изменением, а не шумом."""
        adapter = MockAdapter()
        first = adapter.classify("Автоматизация витрины отчётности", "Core", "serving")
        second = adapter.classify("Автоматизация витрины отчётности", "Core", "serving")
        assert first.as_dict() == second.as_dict()

    def test_detects_regulatory(self):
        hints = MockAdapter().classify("Требование регулятора по отчётности", "Core", "serving")
        assert hints.kind == "regulatory"

    def test_detects_rnd(self):
        hints = MockAdapter().classify("Исследование гипотезы по AI-агенту", "AI", "serving")
        assert hints.kind == "rnd"

    def test_method_follows_team_class(self):
        assert MockAdapter().classify("Доработка", "IB", "earning").kind == "revenue"
        assert MockAdapter().classify("Доработка", "Core", "serving").kind == "time_saving"

    def test_does_not_invent_numbers(self):
        """Мок не подставляет вводные вместо автора задачи."""
        hints = MockAdapter().classify("Автоматизация витрины", "Core", "serving")
        assert hints.users is None
        assert hints.minutes_per_operation is None
        assert hints.deals_per_year is None


class TestParseHints:
    def test_parses_plain_json(self):
        hints = parse_hints('{"kind": "revenue", "deals_per_year": 3, "confident": true}', "test")
        assert hints.kind == "revenue"
        assert hints.deals_per_year == 3.0
        assert hints.confident is True

    def test_parses_json_in_code_fence(self):
        hints = parse_hints('```json\n{"kind": "rnd", "confident": false}\n```', "test")
        assert hints.kind == "rnd"

    def test_rejects_garbage_instead_of_substituting_empty_hints(self):
        with pytest.raises(ValueError, match="без JSON"):
            parse_hints("совершенно не JSON", "test")

    def test_null_and_zero_become_none(self):
        """Ноль пользователей — не число, а отсутствие данных."""
        hints = parse_hints(
            '{"kind": "time_saving", "users": 0, "minutes_per_operation": null, "confident": false}',
            "t",
        )
        assert hints.users is None
        assert hints.minutes_per_operation is None

    def test_rejects_unknown_kind(self):
        with pytest.raises(ValueError, match="неизвестный kind"):
            parse_hints('{"kind": "placeholder", "confident": false}', "test")


class TestPromptHash:
    def test_same_input_same_hash(self):
        assert prompt_hash("s", "u", "m") == prompt_hash("s", "u", "m")

    def test_model_change_changes_hash(self):
        assert prompt_hash("s", "u", "m1") != prompt_hash("s", "u", "m2")


class TestCache:
    def test_second_call_is_served_from_cache(self, session):
        """НФ5: ответы кэшируются по хешу промпта — иначе пересчёт бэклога
        при смене весов снова опрашивал бы модель 440 раз."""
        adapter = get_adapter("mock")
        classify_with_cache(adapter, "Автоматизация витрины", "Core", "serving", session)
        session.flush()
        classify_with_cache(adapter, "Автоматизация витрины", "Core", "serving", session)
        session.flush()

        calls = session.scalars(select(LlmCall)).all()
        assert len(calls) == 1, "второй вызов должен был попасть в кэш"

    def test_failure_is_logged_and_propagated_without_mock_fallback(self, session):
        """Сбой настроенной модели не подменяется правдоподобной эвристикой."""

        class BrokenAdapter:
            name = "broken"
            model = "broken-1"

            def classify(self, *_args, **_kwargs):
                raise RuntimeError("контур недоступен")

        with pytest.raises(RuntimeError, match="LLM недоступна"):
            classify_with_cache(BrokenAdapter(), "Витрина", "Core", "serving", session)
        session.flush()

        call = session.scalars(select(LlmCall)).one()
        assert "контур недоступен" in call.error
        assert call.response is None


class TestStrategyDecomposer:
    def test_stub_is_deterministic(self):
        stub = StubStrategyDecomposer()
        assert stub.score("Платформенная инициатива").score == stub.score(
            "Платформенная инициатива"
        ).score

    def test_score_is_in_range(self):
        stub = StubStrategyDecomposer()
        for text in ["", "Стратегическая AI-платформа", "Мелкая правка формы"]:
            assert 1 <= stub.score(text).score <= 10

    def test_strategic_markers_raise_the_score(self):
        stub = StubStrategyDecomposer()
        plain = stub.score("правка")
        strategic = stub.score("правка стратегическая платформенная масштабирование доход")
        assert strategic.score >= plain.score


class TestRagSearch:
    def test_finds_tribe_knowledge(self):
        result = search_corpus("Pre-trade акционерный риск", top_k=3, layer="knowledge")
        assert result["results"]
        assert all(r["layer"] == "knowledge" for r in result["results"])
        assert any("tribe" in r["source"] for r in result["results"])

    def test_layer_filter_does_not_return_empty(self):
        """Регрессия: фильтр по слою применялся после отбора top-k и мог
        обнулить выдачу — 440 коротких задач бэклога занимали её целиком."""
        result = search_corpus("чем занимается команда Pre-Trade", top_k=3, layer="knowledge")
        assert result["results"], "фильтр по слою не должен обнулять выдачу"

    def test_backlog_layer_returns_tasks(self):
        result = search_corpus("автоматизация отчётности", top_k=3, layer="backlog")
        assert all(r["chunk_id"].startswith("backlog:") for r in result["results"])

    def test_every_result_names_its_source(self):
        """Без источника RAG превращается в ещё один генератор
        правдоподобных, но непроверяемых утверждений."""
        result = search_corpus("Value методика расчёта", top_k=5)
        assert all(r["source"] and r["chunk_id"] for r in result["results"])

    def test_empty_query_does_not_crash(self):
        assert search_corpus("", top_k=3)["results"] == []
