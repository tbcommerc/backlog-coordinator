"""Отдельная регистрация аналитических API задач."""
from fastapi import APIRouter, Depends

from auth import require_backlog_page_access
from services.task_analytics import (
    get_analytics,
    get_effort_by_type,
    get_lt_reports,
    get_tribe_dashboard,
)


router = APIRouter(dependencies=[Depends(require_backlog_page_access)])
router.add_api_route("/analytics", get_analytics, methods=["GET"])
router.add_api_route("/analytics/effort-by-type", get_effort_by_type, methods=["GET"])
router.add_api_route("/analytics/tribe-dashboard", get_tribe_dashboard, methods=["GET"])
router.add_api_route("/analytics/lt-reports", get_lt_reports, methods=["GET"])
