"""Ex-post атрибуция value_external для обслуживающих команд (ТЗ Ф8, US-6).

Смысл механизма: обслуживающие команды не имеют собственного дохода, но их
работа — часть дохода фронта. Поэтому во внешний контур их эффект попадает не
как «экономия времени» (что руководство банка запретило подсвечивать), а как
доля фактического дохода фронта, распределённая пропорционально внутренним
оценкам.

Формула (handoff, раздел 4.1):

    R = Факт_дохода_фронта − Атрибутированный_доход_инициатив_фронта
    value_external_командыᵢ = R × (Σ value_internal_i / Σ value_internal_всех)
    value_external_инициативы_j = value_external_командыᵢ × (value_j / Σ value_i)

Запуск — только по инициативе методолога или финансиста (Ф26), никогда
автоматически.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.models import AttributionRun, Task
from app.core.references import ReferenceBundle
from app.core.value import STATUS_COMPUTED


class AttributionError(RuntimeError):
    pass


def run_attribution(
    session: Session,
    period: str,
    front_actual_revenue_mln: float,
    actor: str = "methodologist",
    only_closed: bool = True,
) -> dict[str, Any]:
    """Распределяет остаточный доход фронта по инициативам обслуживающих команд.

    `only_closed=True` ограничивает базу закрытыми инициативами: атрибутировать
    фактический доход на ещё не сделанную работу методологически некорректно.
    """
    if front_actual_revenue_mln <= 0:
        raise AttributionError("фактический доход фронта должен быть положительным")

    refs = ReferenceBundle(session)
    tasks = list(session.scalars(select(Task)).all())

    def is_closed(task: Task) -> bool:
        status = (task.status or "").upper()
        return status in {"ВЫПОЛНЕНА", "СДЕЛАНО"}

    earning = [t for t in tasks if refs.team_class(t.team) == "earning"]
    serving = [t for t in tasks if refs.team_class(t.team) == "serving"]
    if only_closed:
        earning = [t for t in earning if is_closed(t)]
        serving = [t for t in serving if is_closed(t)]

    # Доход фронта, уже объяснённый его собственными инициативами, повторно
    # распределять нельзя — это и есть защита от double-count.
    attributed_front = sum(t.value_internal_mln or 0.0 for t in earning)
    residual = front_actual_revenue_mln - attributed_front
    if residual <= 0:
        raise AttributionError(
            "остаток для распределения не положителен: доход фронта "
            f"{front_actual_revenue_mln:.1f} млн ₽ полностью объяснён инициативами "
            f"фронта ({attributed_front:.1f} млн ₽). Проверьте период и оценки."
        )

    by_team: dict[str, list[Task]] = defaultdict(list)
    for task in serving:
        by_team[task.team or "—"].append(task)

    total_serving_value = sum(t.value_internal_mln or 0.0 for t in serving)
    if total_serving_value <= 0:
        raise AttributionError(
            "суммарный value_internal обслуживающих команд равен нулю — "
            "распределять пропорционально нечему"
        )

    result: dict[str, Any] = {
        "period": period,
        "front_actual_revenue_mln": front_actual_revenue_mln,
        "attributed_front_initiatives_mln": round(attributed_front, 2),
        "residual_mln": round(residual, 2),
        "teams": {},
    }

    for team, team_tasks in by_team.items():
        team_value = sum(t.value_internal_mln or 0.0 for t in team_tasks)
        if team_value <= 0:
            continue
        team_share = team_value / total_serving_value
        team_external = residual * team_share

        for task in team_tasks:
            task_share = (task.value_internal_mln or 0.0) / team_value
            task.value_external_mln = round(team_external * task_share, 2)
            task.value_external_status = STATUS_COMPUTED

        result["teams"][team] = {
            "value_internal_mln": round(team_value, 2),
            "share": round(team_share, 4),
            "value_external_mln": round(team_external, 2),
            "initiatives": len(team_tasks),
        }

    session.add(
        AttributionRun(
            period=period,
            front_actual_revenue_mln=front_actual_revenue_mln,
            attributed_front_initiatives_mln=attributed_front,
            residual_mln=residual,
            result=result,
            actor=actor,
        )
    )
    return result
