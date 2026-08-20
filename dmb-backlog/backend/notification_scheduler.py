"""Плановая проверка уведомлений для отдельного singleton worker."""
import asyncio
import logging

from database import SessionLocal
from notifications import check_scheduled_notifications


logger = logging.getLogger("dmb_backlog.notification_scheduler")


def run_notification_check() -> None:
    """Выполнить один цикл с гарантированным закрытием DB session."""
    db = SessionLocal()
    try:
        check_scheduled_notifications(db)
    finally:
        db.close()


async def notification_scheduler_loop(interval_seconds: int = 3600) -> None:
    while True:
        try:
            run_notification_check()
        except Exception:
            logger.exception("Scheduled notification check failed")
        await asyncio.sleep(interval_seconds)
