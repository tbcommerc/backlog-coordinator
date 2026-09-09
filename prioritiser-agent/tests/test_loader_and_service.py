"""Загрузка реального слепка бэклога, пересчёт и ex-post атрибуция."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.config import DATA_DIR
from app.core.attribution import AttributionError, run_attribution
from app.core.loader import load_backlog, read_seed
from app.core.models import Task
from app.core.references import ReferenceError, validate_weights
from app.core.service import recompute_all, recompute_task

SEED = DATA_DIR / "backlog_seed.json"
pytestmark = pytest.mark.skipif(not SEED.exists(), reason="нет слепка бэклога")


@pytest.fixture()
def loaded(session):
    load_backlog(session, SEED, replace=True)
    session.flush()
    return session


class TestLoader:
    def test_all_rows_are_read(self):
        assert len(read_seed(SEED)) == 446

    def test_duplicate_ids_collapse_to_unique_tasks(self, loaded):
        """В слепке два ID продублированы по 4 раза — в БД попадает 440 задач.

        Это дефект исходных данных, а не загрузчика: ID задачи обязан быть
        уникальным. Тест фиксирует текущее поведение, чтобы расхождение
        446 против 440 не выглядело потерей строк.
        """
        assert loaded.scalar(select(Task).where(Task.task_key == "TASK-500-001")) is not None
        assert len(loaded.scalars(select(Task)).all()) == 440

    def test_no_field_is_lost(self, loaded):
        task = loaded.scalar(select(Task).where(Task.task_key == "TASK-100-000"))
        assert len(task.raw) == 29

    def test_task_type_is_normalised(self, loaded):
        types = {t.task_type for t in loaded.scalars(select(Task)).all()}
        assert not any("\xa0" in (t or "") for t in types)
        assert "КВАРТАЛЬНАЯ/ГОДОВАЯ ЦЕЛЬ" in types

    def test_deadlines_are_parsed(self, loaded):
        tasks = loaded.scalars(select(Task)).all()
        with_deadline = [t for t in tasks if t.deadline is not None]
        assert len(with_deadline) > 400

    def test_team_class_is_assigned(self, loaded):
        ib = loaded.scalars(select(Task).where(Task.team == "IB")).first()
        core = loaded.scalars(select(Task).where(Task.team == "Core")).first()
        assert ib.team_class == "earning"
        assert core.team_class == "serving"

    def test_manual_value_is_captured(self, loaded):
        with_value = [
            t for t in loaded.scalars(select(Task)).all() if t.value_manual_mln is not None
        ]
        assert len(with_value) > 150


class TestRecomputeAll:
    def test_every_task_gets_a_priority(self, loaded):
        stats = recompute_all(loaded)
        assert stats.total == 440
        assert sum(stats.by_priority.values()) == 440
        assert all(t.priority is not None for t in loaded.scalars(select(Task)).all())

    def test_meets_performance_requirement(self, loaded):
        """НФ8: не более 60 секунд на 100 задач; здесь 440."""
        stats = recompute_all(loaded)
        assert stats.duration_seconds < 60 * 4.4

    def test_manual_value_is_preserved(self, loaded):
        recompute_all(loaded)
        task = loaded.scalar(
            select(Task).where(Task.value_manual_mln.is_not(None)).limit(1)
        )
        assert task.value_internal_mln == task.value_manual_mln
        assert task.value_source == "manual"

    def test_serving_teams_have_no_external_value(self, loaded):
        """US-7: экономия времени не может утечь во внешний контур."""
        recompute_all(loaded)
        serving = loaded.scalars(select(Task).where(Task.team_class == "serving")).all()
        assert all(t.value_external_mln is None for t in serving)
        assert all(t.value_external_status == "tbd" for t in serving)

    def test_history_is_written_on_first_run(self, loaded):
        recompute_all(loaded)
        task = loaded.scalars(select(Task)).first()
        assert task.history
        assert task.history[0].reason == "initial_load"

    def test_second_run_is_stable(self, loaded):
        """Детерминированность: без изменения вводных приоритеты не пляшут."""
        recompute_all(loaded)
        first = {t.task_key: t.priority for t in loaded.scalars(select(Task)).all()}

        stats = recompute_all(loaded)
        second = {t.task_key: t.priority for t in loaded.scalars(select(Task)).all()}

        assert first == second
        assert stats.priority_changed == 0


class TestRecomputeTask:
    def test_manual_value_changes_priority(self, loaded):
        """US-2: вписал Value руками — приоритет пересчитался."""
        recompute_all(loaded)
        task = loaded.scalar(select(Task).where(Task.task_key == "TASK-800-003"))
        before = task.priority

        task.value_manual_mln = 5000.0
        task.effort_man_days = 5.0
        recompute_task(loaded, task)

        assert task.value_internal_mln == 5000.0
        assert task.priority != before
        assert task.history[-1].reason == "attributes_changed"


class TestAttribution:
    @staticmethod
    def _population(loaded):
        return list(loaded.scalars(select(Task.task_key)).all())

    def test_distributes_residual_across_serving_teams(self, loaded):
        recompute_all(loaded)
        result = run_attribution(
            loaded,
            period="3Q 2026",
            front_actual_revenue_mln=5000.0,
            task_keys=self._population(loaded),
        )

        assert result["residual_mln"] > 0
        assert result["teams"]
        # Доли обслуживающих команд в сумме дают единицу.
        assert sum(t["share"] for t in result["teams"].values()) == pytest.approx(1.0, abs=1e-3)

    def test_serving_tasks_receive_external_value(self, loaded):
        recompute_all(loaded)
        run_attribution(
            loaded,
            period="3Q 2026",
            front_actual_revenue_mln=5000.0,
            task_keys=self._population(loaded),
        )

        assigned = [
            t
            for t in loaded.scalars(select(Task).where(Task.team_class == "serving")).all()
            if t.value_external_mln is not None
        ]
        assert assigned
        assert all(t.value_external_status == "computed" for t in assigned)

    def test_rejects_revenue_already_explained_by_front(self, loaded):
        """Защита от double-count: нельзя раздать доход, который уже объяснён
        инициативами самого фронта."""
        recompute_all(loaded)
        with pytest.raises(AttributionError, match="остаток"):
            run_attribution(
                loaded,
                period="3Q 2026",
                front_actual_revenue_mln=1.0,
                task_keys=self._population(loaded),
            )

    def test_rejects_non_positive_revenue(self, loaded):
        with pytest.raises(AttributionError):
            run_attribution(
                loaded,
                period="3Q 2026",
                front_actual_revenue_mln=0.0,
                task_keys=self._population(loaded),
            )

    def test_requires_explicit_period_population(self, loaded):
        with pytest.raises(AttributionError, match="непустую выборку"):
            run_attribution(
                loaded,
                period="3Q 2026",
                front_actual_revenue_mln=5000.0,
                task_keys=[],
            )

    def test_rejects_unknown_task_in_population(self, loaded):
        with pytest.raises(AttributionError, match="не найдены"):
            run_attribution(
                loaded,
                period="3Q 2026",
                front_actual_revenue_mln=5000.0,
                task_keys=["TASK-DOES-NOT-EXIST"],
            )


class TestWeightValidation:
    def test_sum_must_equal_one(self):
        """Ф17."""
        validate_weights({"weights": {"a": 0.5, "b": 0.5}})
        with pytest.raises(ReferenceError, match="сумма весов"):
            validate_weights({"weights": {"a": 0.5, "b": 0.4}})
