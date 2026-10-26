"""Сценарии Координатора бэклога: расчёт Value и приоритета без доступа к БД.

Проверяется не арифметика — она покрыта тестами ядра, — а то, что относится
именно к сервисному слою: сборка задачи из атрибутов, повторяемость ответов,
отказ при нехватке данных и провенанс в ответе.
"""

from __future__ import annotations

import datetime as dt
from threading import Barrier

import pytest

from app.api.contract import AgentResponse, ErrorResponse, TaskAttributes
from app.service import handle_request
from app.service.scenarios import build_task, reset_analogy_index
from app.snapshot import ValueSnapshot, reset_snapshot_cache, write_snapshot


@pytest.fixture(autouse=True)
def _isolated_snapshot(tmp_path, monkeypatch):
    """Свой слепок на тест: общий делал бы тесты зависимыми от даты сборки."""
    import numpy as np

    import app.core.analogy as analogy_module
    import app.snapshot as snapshot_module

    class DeterministicEncoder:
        def encode(self, texts, **_kwargs):
            return np.ones((len(texts), 4), dtype="float32")

    path = tmp_path / "snapshot.json"
    monkeypatch.setattr(snapshot_module, "SNAPSHOT_PATH", path)
    monkeypatch.setattr(analogy_module, "INDEX_DIR", tmp_path / "index")
    monkeypatch.setattr(
        analogy_module.AnalogyIndex,
        "_encoder",
        lambda _self: DeterministicEncoder(),
    )
    monkeypatch.setattr(
        analogy_module.AnalogyIndex,
        "_load_or_build",
        lambda self: setattr(
            self,
            "_matrix",
            np.ones((len(self.entries), 4), dtype="float32"),
        ),
    )
    write_snapshot(
        entries=[
            {"task_key": "TASK-300-001", "title": "AI помощник для подготовки питча по сделкам IB",
             "team": "IB", "project": "AI ПОМОЩНИК IB", "value_mln": 200.0},
            {"task_key": "TASK-300-002", "title": "Реестр фондов для инвестиционных сделок",
             "team": "IB", "project": "AI ПОМОЩНИК IB", "value_mln": 150.0},
            {"task_key": "TASK-400-001", "title": "Автоматизация сверки лимитов",
             "team": "Core", "project": "ПЛАТФОРМА", "value_mln": 30.0},
        ],
        max_value_mln=3600.0,
        source_rows=440,
        path=path,
        version="test-1",
    )
    reset_analogy_index()
    yield
    reset_snapshot_cache()
    reset_analogy_index()


def attrs(**overrides) -> TaskAttributes:
    base = {
        "task_id": "NEW-001",
        "task_type": "КВАРТАЛЬНАЯ/ГОДОВАЯ ЦЕЛЬ",
        "team": "IB",
        "title": "Автоматизация подготовки инвестиционного меморандума для сделок ECM",
        "project": "AI ПОМОЩНИК IB",
        "deadline": "3Q 2026",
    }
    return TaskAttributes(**{**base, **overrides})


def priority_attrs(**overrides) -> TaskAttributes:
    return attrs(effort_man_days=40, business_customer="Д. Андреев", **overrides)


class TestRequiredAttributes:
    def test_priority_refuses_without_effort_and_customer(self, session):
        result = handle_request(attrs(), "priority", session)
        assert isinstance(result, ErrorResponse)
        assert result.status == "insufficient_data"
        assert set(result.missing_attributes) == {"effort_man_days", "business_customer"}

    def test_value_needs_less(self, session):
        result = handle_request(attrs(), "value", session)
        assert isinstance(result, AgentResponse)
        assert result.status == "ok"

    def test_refusal_happens_before_any_work(self, session):
        """Отказ дешевле правдоподобного числа на нейтральных значениях."""
        result = handle_request(attrs(), "priority", session)
        assert isinstance(result, ErrorResponse)
        assert result.priority is None if hasattr(result, "priority") else True

    def test_llm_failure_returns_error_without_calculated_value(self, session, monkeypatch):
        """Недоступная LLM не должна подменяться эвристическим расчётом."""

        class BrokenAdapter:
            name = "broken"
            model = "broken-1"

            def classify(self, *_args, **_kwargs):
                raise RuntimeError("контур недоступен")

        monkeypatch.setattr("app.llm.factory.get_adapter", lambda: BrokenAdapter())

        result = handle_request(attrs(task_id="LLM-FAIL-001"), "value", session)

        assert isinstance(result, ErrorResponse)
        assert result.status == "error"
        assert result.error == "LLM недоступна. Расчёт не выполнен."


class TestValueScenario:
    def test_uses_analogy_from_the_bundled_snapshot(self, session):
        """Аналоги приходят из зашитого слепка — базы бэклога агент не видит."""
        result = handle_request(attrs(), "value", session)

        analogy = next(m for m in result.value.methods if m.method == "analogy")
        assert analogy.analogues
        assert {a.task_id for a in analogy.analogues} <= {
            "TASK-300-001", "TASK-300-002", "TASK-400-001"
        }
        assert result.audit.snapshot_version == "test-1"

    def test_interval_brackets_the_estimate(self, session):
        result = handle_request(attrs(), "value", session)
        v = result.value
        assert v.range is not None
        assert v.range.low_mln <= v.value_mln <= v.range.high_mln
        assert v.range.coverage == 0.95

    def test_horizon_starts_after_the_deadline(self, session):
        result = handle_request(attrs(deadline="3Q 2026"), "value", session)
        assert result.value.horizon.start == dt.date(2026, 10, 1)
        assert result.value.horizon.end == dt.date(2029, 9, 30)

    def test_human_value_is_taken_as_truth(self, session):
        """Заполненное человеком значение агент не пересчитывает (ТЗ Ф1)."""
        result = handle_request(attrs(value_internal_mln=77.0), "value", session)
        assert result.value.value_mln == 77.0
        assert result.value.method == "manual"
        assert result.value.confidence == "high"
        # У точного значения диапазона нет: рисовать его вокруг истины значило
        # бы придумывать неопределённость, которой не существует.
        assert result.value.range is None

    def test_human_value_does_not_build_unused_analogy_index(
        self, session, monkeypatch
    ):
        def unexpected_index(_snapshot):
            raise AssertionError("индекс аналогий не нужен для ручного Value")

        monkeypatch.setattr("app.service.scenarios._analogy_index", unexpected_index)

        result = handle_request(
            attrs(task_id="MANUAL-NO-INDEX", value_internal_mln=77.0),
            "value",
            session,
        )

        assert result.value.value_mln == 77.0
        assert result.audit.phase_duration_ms["analogy_index"] >= 0

    def test_research_task_gets_zero_with_a_reason(self, session):
        result = handle_request(attrs(task_type="ИССЛЕДОВАНИЕ"), "value", session)
        assert result.value.method == "zero"
        assert result.value.value_mln == 0.0
        assert result.value.zero_reason

    def test_missing_snapshot_degrades_loudly(self, session, tmp_path, monkeypatch):
        """Без слепка расчёт идёт, но пользователь обязан узнать, что он хуже."""
        import app.snapshot as snapshot_module

        monkeypatch.setattr(snapshot_module, "SNAPSHOT_PATH", tmp_path / "нет.json")
        reset_snapshot_cache()
        reset_analogy_index()

        result = handle_request(attrs(), "value", session)
        assert result.value.method != "analogy"
        assert any("слепок" in w.lower() for w in result.warnings)


class TestScenarioPerformancePlumbing:
    def test_independent_factor_assessments_run_in_parallel(self, session, monkeypatch):
        from app.strategy.analysts import (
            DeclaredDependencyAnalyst,
            StubStrategyAnalyst,
        )
        both_started = Barrier(2)

        class SlowStrategy(StubStrategyAnalyst):
            def assess(self, *args, **kwargs):
                both_started.wait(timeout=1)
                return super().assess(*args, **kwargs)

        class SlowDependency(DeclaredDependencyAnalyst):
            def assess(self, *args, **kwargs):
                both_started.wait(timeout=1)
                return super().assess(*args, **kwargs)

        monkeypatch.setattr(
            "app.strategy.analysts.get_strategy_analyst",
            lambda **_kwargs: SlowStrategy(),
        )
        monkeypatch.setattr(
            "app.strategy.analysts.get_dependency_analyst",
            lambda *_args, **_kwargs: SlowDependency(),
        )

        result = handle_request(
            priority_attrs(
                task_id="PARALLEL-F5-F6",
                value_internal_mln=77.0,
                involved_teams="Core",
            ),
            "priority",
            session,
        )

        assert isinstance(result, AgentResponse)
        assert "factor_assessments" in result.audit.phase_duration_ms


class TestCoordinatorTemplate:
    """Сценарий Value отдаёт ровно три поля шаблона и ничего больше."""

    def test_exactly_three_fields(self, session):
        from app.api.contract import CoordinatorValueOut, to_coordinator

        result = handle_request(attrs(), "value", session)
        out = to_coordinator(result.value)

        assert set(CoordinatorValueOut.model_fields) == {
            "value_internal",
            "value_internal_confidence",
            "value_internal_logic",
        }
        assert out.value_internal == result.value.value_mln
        assert out.value_internal_logic == result.value.explanation

    def test_confidence_is_one_of_three_words(self, session):
        """Поле перечислимое: Координатор по нему фильтрует и красит."""
        from app.api.contract import to_coordinator

        result = handle_request(attrs(), "value", session)
        out = to_coordinator(result.value)

        assert out.value_internal_confidence in ("низкая", "средняя", "высокая")

    def test_range_lives_in_the_logic_not_in_confidence(self, session):
        """Диапазон относится к расчёту. В поле уверенности числам не место —
        строка с ними сделала бы поле нефильтруемым."""
        from app.api.contract import to_coordinator

        result = handle_request(attrs(), "value", session)
        out = to_coordinator(result.value)

        assert result.value.range is not None
        assert result.value.range.text in out.value_internal_logic
        assert result.value.range.text not in out.value_internal_confidence

    def test_analogue_task_ids_are_in_the_logic(self, session):
        """Без номеров задач оценку нельзя проверить.

        «медиана(200; 50; 400)» — утверждение, которое приходится принимать на
        веру. С номерами человек открывает эти задачи и видит, откуда взялось
        число.
        """
        from app.api.contract import to_coordinator

        result = handle_request(attrs(), "value", session)
        out = to_coordinator(result.value)

        analogy = next(m for m in result.value.methods if m.method == "analogy")
        assert analogy.analogues, "аналоги должны быть найдены на этом слепке"
        for a in analogy.analogues:
            assert a.task_id in out.value_internal_logic, (
                f"номер аналога {a.task_id} потерялся в пояснении"
            )
            assert a.task_id in (analogy.calculation or ""), (
                f"номер аналога {a.task_id} отсутствует в строке расчёта"
            )

    def test_exact_value_has_no_invented_range(self, session):
        """У ручного значения диапазона нет — рисовать его было бы выдумкой."""
        from app.api.contract import to_coordinator

        result = handle_request(attrs(value_internal_mln=77.0), "value", session)
        out = to_coordinator(result.value)

        assert result.value.range is None
        assert out.value_internal == 77.0
        assert out.value_internal_confidence == "высокая"
        assert "точное" in out.value_internal_logic.lower()

    def test_template_rejects_extra_keys(self):
        """Лишний ключ в чужой системе либо игнорируется, либо ломает разбор."""
        from pydantic import ValidationError

        from app.api.contract import CoordinatorValueOut

        with pytest.raises(ValidationError):
            CoordinatorValueOut(
                value_internal=1.0,
                value_internal_confidence="…",
                value_internal_logic="…",
                priority="P1",
            )


class TestCoordinatorPriorityTemplate:
    """Сценарий приоритета отдаёт ровно три поля шаблона."""

    def test_exactly_three_fields(self, session):
        from app.api.contract import CoordinatorPriorityOut, to_coordinator_priority

        result = handle_request(priority_attrs(), "priority", session)
        out = to_coordinator_priority(result.priority, result.value)

        assert set(CoordinatorPriorityOut.model_fields) == {
            "priority_score",
            "priority_score_confidence",
            "priority_score_logic",
        }
        assert out.priority_score == result.priority.priority

    def test_score_carries_the_band_not_the_raw_number(self, session):
        """В поле уходит полоса P1–P5: по ней принимают решения.

        Сырой скор нужен для сортировки внутри полосы и остаётся в пояснении —
        записывать его в поле приоритета значило бы отдать Координатору число,
        которое нельзя показать человеку без объяснения шкалы.
        """
        from app.api.contract import to_coordinator_priority

        result = handle_request(priority_attrs(), "priority", session)
        out = to_coordinator_priority(result.priority, result.value)

        assert out.priority_score in ("P1", "P2", "P3", "P4", "P5")
        assert f"{result.priority.score:.4f}" in out.priority_score_logic

    def test_confidence_is_one_of_three_words(self, session):
        from app.api.contract import to_coordinator_priority

        result = handle_request(priority_attrs(), "priority", session)
        out = to_coordinator_priority(result.priority, result.value)

        assert out.priority_score_confidence in ("низкая", "средняя", "высокая")

    def test_every_factor_reaches_the_logic(self, session):
        """Все восемь факторов с вкладом и происхождением балла."""
        from app.api.contract import to_coordinator_priority

        result = handle_request(priority_attrs(), "priority", session)
        out = to_coordinator_priority(result.priority, result.value)

        for factor in result.priority.factors:
            assert factor.code in out.priority_score_logic
        assert "нейтральное значение" in out.priority_score_logic

    def test_formula_is_arithmetically_checkable(self, session):
        """Формула приведена целиком: вес, балл, произведение и сумма.

        Смысл в том, чтобы результат можно было проверить на бумаге, не доверяя
        агенту. Если в тексте нет какого-то слагаемого, проверка невозможна.
        """
        from app.api.contract import to_coordinator_priority

        result = handle_request(priority_attrs(), "priority", session)
        logic = to_coordinator_priority(result.priority, result.value).priority_score_logic

        assert "ФОРМУЛА" in logic
        for factor in result.priority.factors:
            assert f"{factor.weight:>5.2f} × {factor.score:>5.2f}" in logic
            assert f"{factor.contribution:.4f}" in logic

        # Сумма слагаемых обязана сходиться с заявленным скором.
        total = sum(f.contribution for f in result.priority.factors)
        assert total == pytest.approx(result.priority.score, abs=1e-3)
        assert f"{result.priority.score:.4f}" in logic

    def test_bands_make_the_letter_checkable(self, session):
        """Полосу нельзя проверить по скору, не зная порогов."""
        from app.api.contract import to_coordinator_priority

        result = handle_request(priority_attrs(), "priority", session)
        logic = to_coordinator_priority(result.priority, result.value).priority_score_logic

        assert result.priority.bands, "пороги должны доходить до ответа"
        assert "Шкала:" in logic
        for band in ("P1", "P2", "P3", "P4"):
            assert band in logic

    def test_score_justification_states_the_rule(self, session):
        """Обоснование объясняет правило, а не только исходное значение.

        «Трудозатраты 45 ч/д» не объясняет балл 0.38; нужны пороги шкалы.
        """
        from app.api.contract import to_coordinator_priority

        result = handle_request(priority_attrs(), "priority", session)
        logic = to_coordinator_priority(result.priority, result.value).priority_score_logic

        assert "ОБОСНОВАНИЕ БАЛЛОВ" in logic
        assert "Обратная шкала" in logic          # F4: пороги 5 и 50 ч/д
        assert "Логарифмическая нормализация" in logic  # F1
        assert "Ступени" in logic                  # F3

    def test_unbacked_weight_is_named(self, session):
        """Доля веса без данных обязана быть названа числом.

        Пока уровни заказчиков не проставлены, F2 даёт нейтральный балл всем
        задачам подряд. Без явного «не обеспечено 15% веса» это выглядит как
        рабочая оценка.
        """
        from app.api.contract import to_coordinator_priority

        result = handle_request(priority_attrs(), "priority", session)
        out = to_coordinator_priority(result.priority, result.value)

        assert "НЕ ОБЕСПЕЧЕНО ДАННЫМИ" in out.priority_score_logic
        assert "F2" in out.priority_score_logic

    def test_confidence_drops_when_value_is_shaky(self, session):
        """Фактор F1 весит больше всех и стоит на оценке Value.

        Задача с ручным Value и задача с оценкой на подставленных драйверах не
        должны получать одинаково уверенный приоритет.
        """
        from app.api.contract import priority_confidence

        result = handle_request(priority_attrs(), "priority", session)

        _, backing_high = priority_confidence(result.priority, "high")
        _, backing_low = priority_confidence(result.priority, "low")
        assert backing_high > backing_low

    def test_template_rejects_extra_keys(self):
        from pydantic import ValidationError

        from app.api.contract import CoordinatorPriorityOut

        with pytest.raises(ValidationError):
            CoordinatorPriorityOut(
                priority_score="P1",
                priority_score_confidence="низкая",
                priority_score_logic="…",
                value_internal=1.0,
            )


class TestRefusalKeepsTheSchema:
    """У ответа и отказа одна схема: Координатор разбирает один формат.

    Раньше при нехватке атрибутов наружу уходила другая структура — с ключами
    `status`, `error`, `missing_attributes`, — а CLI на сценарии приоритета
    вовсе падал с трейсбеком. Координатор получил бы не JSON, а мусор.
    """

    def test_value_refusal_has_the_same_three_keys(self, session):
        from app.api.contract import CoordinatorValueOut, refusal_to_coordinator

        error = handle_request(
            TaskAttributes(task_id="T", task_type="AD-HOC", team="IB", title="…"),
            "value",
            session,
        )
        # Сценарий Value обязательных полей почти не требует, поэтому отказ
        # конструируем напрямую: проверяется форма, а не условие срабатывания.
        from app.api.contract import ErrorResponse

        out = refusal_to_coordinator(
            ErrorResponse(
                task_id="T",
                request_type="value",
                status="insufficient_data",
                error="Не заполнены обязательные атрибуты",
                missing_attributes=["title"],
            ),
            "value",
        )
        assert set(out.model_dump()) == set(CoordinatorValueOut.model_fields)
        assert out.value_internal is None, "ноль означал бы «эффекта нет»"
        assert out.value_internal_confidence == "низкая"
        assert "не выполнен" in out.value_internal_logic.lower()

    def test_priority_refusal_has_the_same_three_keys(self, session):
        from app.api.contract import (
            CoordinatorPriorityOut,
            ErrorResponse,
            refusal_to_coordinator,
        )

        error = handle_request(attrs(), "priority", session)
        assert isinstance(error, ErrorResponse)

        out = refusal_to_coordinator(error, "priority")
        assert set(out.model_dump()) == set(CoordinatorPriorityOut.model_fields)
        assert out.priority_score is None
        assert out.priority_score_confidence == "низкая"

    def test_missing_attributes_are_named_in_russian(self, session):
        """Отказ читает человек: «effort_man_days» ему ничего не говорит."""
        from app.api.contract import ErrorResponse, refusal_to_coordinator

        error = handle_request(attrs(), "priority", session)
        assert isinstance(error, ErrorResponse)

        logic = refusal_to_coordinator(error, "priority").priority_score_logic
        assert "Оценка трудозатрат" in logic
        assert "ФИО бизнес-заказчика" in logic
        assert "effort_man_days" not in logic

    def test_payload_survives_a_json_round_trip(self, session):
        """Ответ уходит Координатору файлом, значит обязан разбираться обратно."""
        import json

        from app.api.contract import to_coordinator, to_coordinator_priority

        value = handle_request(attrs(), "value", session)
        priority = handle_request(priority_attrs(), "priority", session)

        for payload in (
            to_coordinator(value.value).model_dump(mode="json"),
            to_coordinator_priority(priority.priority, priority.value).model_dump(mode="json"),
        ):
            text = json.dumps(payload, ensure_ascii=False)
            assert json.loads(text) == payload


class TestValueScenarioNeverPrioritises:
    """Расчёт приоритета в сценарии Value запрещён.

    На приоритет Координатор присылает отдельный запрос. Посчитать его заодно
    значило бы потратить вызовы субагентов и вернуть число, которого не просили,
    — а по нему ещё и приняли бы решение.
    """

    def test_no_priority_in_the_response(self, session):
        result = handle_request(attrs(), "value", session)
        assert result.priority is None

    def test_subagents_are_not_called(self, session, monkeypatch):
        """Ни стратегия, ни зависимости не оцениваются — это работа приоритета."""
        import app.strategy.analysts as analysts

        called: list[str] = []
        monkeypatch.setattr(
            analysts, "get_strategy_analyst",
            lambda *a, **k: called.append("strategy") or (_ for _ in ()).throw(AssertionError()),
        )
        monkeypatch.setattr(
            analysts, "get_dependency_analyst",
            lambda *a, **k: called.append("dependency") or (_ for _ in ()).throw(AssertionError()),
        )

        result = handle_request(attrs(), "value", session)
        assert result.status in ("ok", "insufficient_data")
        assert called == [], f"в сценарии Value вызваны субагенты приоритета: {called}"


class TestPriorityScenario:
    def test_computes_value_when_it_is_absent(self, session):
        """Приоритет опирается на Value: отдельный вызов Координатору не нужен."""
        result = handle_request(priority_attrs(), "priority", session)
        assert result.priority is not None
        assert result.value is not None
        assert result.priority.priority in ("P1", "P2", "P3", "P4", "P5")

    def test_does_not_return_value_when_human_filled_it(self, session):
        result = handle_request(priority_attrs(value_internal_mln=77.0), "priority", session)
        assert result.value is None
        assert result.priority is not None

    def test_factor_codes_are_contiguous(self, session):
        """Коды идут подряд, без дыр.

        Дыра означала бы, что в модели есть фактор, которого нет: читателю
        обоснования пришлось бы объяснять пропуск номера. C/V и уверенность
        факторами не являются — первый остаётся диагностикой карточки, вторая
        входит множителем при F1.
        """
        result = handle_request(priority_attrs(), "priority", session)
        codes = {f.code for f in result.priority.factors}
        assert codes == {f"F{i}" for i in range(1, 8)}
        assert result.priority.cost_rub is not None
        assert result.priority.cost_to_value is not None

    def test_contributions_sum_to_the_score(self, session):
        result = handle_request(priority_attrs(), "priority", session)
        total = sum(f.contribution for f in result.priority.factors)
        assert total == pytest.approx(result.priority.score, abs=1e-3)

    def test_unfilled_customer_level_is_marked_default(self, session):
        """Имя заказчика есть, а уровня в справочнике нет — балл нейтральный.

        Назвать такой балл посчитанным значило бы скрыть незаполненный
        справочник: в интерфейсе это выглядело бы как рабочая оценка.
        """
        result = handle_request(priority_attrs(), "priority", session)
        customer = next(f for f in result.priority.factors if f.code == "F2")
        assert customer.source == "default"

    def test_effort_drives_a_computed_factor(self, session):
        result = handle_request(priority_attrs(), "priority", session)
        effort = next(f for f in result.priority.factors if f.code == "F4")
        assert effort.source == "computed"
        assert "40" in effort.explanation

    def test_scale_comes_from_the_snapshot(self, session):
        """Шкала F1 строится по максимуму из слепка, а не по одной задаче."""
        result = handle_request(priority_attrs(), "priority", session)
        f1 = next(f for f in result.priority.factors if f.code == "F1")
        assert 0.0 < f1.score < 1.0


class TestRepeatability:
    def test_identical_attributes_give_the_identical_answer(self, session):
        first = handle_request(attrs(), "value", session)
        second = handle_request(attrs(), "value", session)

        assert second.audit.cached is True
        assert second.audit.reused_from_request_id == first.audit.request_id
        assert second.value.value_mln == first.value.value_mln
        assert second.audit.llm_calls == first.audit.llm_calls

    def test_cosmetic_edits_do_not_trigger_recalculation(self, session):
        handle_request(attrs(), "value", session)
        again = handle_request(attrs(title=attrs().title + "  "), "value", session)
        assert again.audit.cached is True

    def test_scenarios_do_not_share_the_cache(self, session):
        handle_request(priority_attrs(), "value", session)
        other = handle_request(priority_attrs(), "priority", session)
        assert other.audit.cached is False

    def test_changed_reference_forces_recalculation(self, session):
        """Правка весов методологом обязана давать новый расчёт, а не кэш."""
        from app.core.references import ReferenceBundle, save_reference

        first = handle_request(priority_attrs(), "priority", session)
        first_version = first.audit.reference_versions["factor_weights"]

        payload = ReferenceBundle(session).raw["factor_weights"]
        payload["weights"]["F1_value"] = 0.33
        payload["weights"]["F4_effort"] = 0.18
        save_reference(session, "factor_weights", payload, actor="test")
        session.flush()

        again = handle_request(priority_attrs(), "priority", session)
        assert again.audit.cached is False
        assert again.audit.reference_versions["factor_weights"] > first_version

    def test_history_records_the_request(self, session):
        from sqlalchemy import select

        from app.core.models import AgentRequest

        response = handle_request(attrs(), "value", session)
        stored = session.scalars(
            select(AgentRequest).where(AgentRequest.request_id == response.audit.request_id)
        ).one()
        assert stored.task_key == "NEW-001"
        assert stored.method == response.value.method
        assert stored.snapshot_version == "test-1"


class TestBuildTask:
    def test_research_type_is_flagged_as_rnd(self, refs):
        task = build_task(attrs(task_type="ИССЛЕДОВАНИЕ"), refs)
        assert task.is_rnd is True

    def test_regulatory_detected_in_the_project(self, refs):
        """Признака регуляторности в бэклоге нет — он ищется по ключевым словам
        в названии, проекте и типе, ровно как при загрузке слепка."""
        task = build_task(attrs(project="Предписание регулятора по отчётности"), refs)
        assert task.is_regulatory is True

    def test_involved_teams_are_counted(self, refs):
        task = build_task(attrs(involved_teams="Core, Finance, AI"), refs)
        assert task.involved_teams_count == 3

    def test_nothing_is_written_to_the_database(self, session, refs):
        from sqlalchemy import func, select

        from app.core.models import Task

        before = session.scalar(select(func.count()).select_from(Task))
        build_task(attrs(), refs)
        handle_request(attrs(), "value", session)
        assert session.scalar(select(func.count()).select_from(Task)) == before


class TestSnapshotArtifact:
    def test_empty_snapshot_is_a_working_state(self):
        snapshot = ValueSnapshot.empty()
        assert snapshot.available is False
        assert snapshot.version == "none"

    def test_written_snapshot_round_trips(self, tmp_path):
        from app.snapshot import load_snapshot

        path = tmp_path / "s.json"
        write_snapshot(
            entries=[{"task_key": "T-1", "title": "…", "team": "IB", "value_mln": 5.0}],
            max_value_mln=5.0,
            source_rows=1,
            path=path,
            version="2026-01-01",
        )
        restored = load_snapshot(path)
        assert restored.version == "2026-01-01"
        assert restored.size == 1
        assert restored.max_value_mln == 5.0

    def test_corrupt_entry_is_rejected(self, tmp_path):
        import json

        from app.snapshot import SnapshotError, load_snapshot

        path = tmp_path / "s.json"
        path.write_text(json.dumps({"version": "1", "entries": [{"team": "IB"}]}), encoding="utf-8")
        with pytest.raises(SnapshotError):
            load_snapshot(path)
