"""Плановая проверка уведомлений для отдельного singleton worker."""
import asyncio
import logging

from database import SessionLocal
from notifications import check_scheduled_notifications
from worker_lock import singleton_worker_lock
from metrics import inc_counter, set_gauge


logger = logging.getLogger("dmb_backlog.notification_scheduler")


def run_notification_check() -> None:
    """Выполнить один цикл с гарантированным закрытием DB session."""
    db = SessionLocal()
    try:
        check_scheduled_notifications(db)
    finally:
        db.close()


async def notification_scheduler_loop(interval_seconds: int = 3600, standby_seconds: int = 30) -> None:
    while True:
        try:
            with singleton_worker_lock("dmb.notification-scheduler") as lease:
                if not lease:
                    set_gauge("dmb_notification_scheduler_leader", 0)
                    await asyncio.sleep(standby_seconds)
                    continue
                set_gauge("dmb_notification_scheduler_leader", 1)
                logger.info("Notification scheduler singleton lock acquired")
                while lease.is_valid():
                    try:
                        run_notification_check()
                        inc_counter("dmb_notification_scheduler_cycles_total", labels={"outcome": "success"})
                    except Exception:
                        inc_counter("dmb_notification_scheduler_cycles_total", labels={"outcome": "error"})
                        logger.exception("Scheduled notification check failed")
                    await asyncio.sleep(interval_seconds)
                set_gauge("dmb_notification_scheduler_leader", 0)
        except asyncio.CancelledError:
            set_gauge("dmb_notification_scheduler_leader", 0)
            raise
        except Exception:
            set_gauge("dmb_notification_scheduler_leader", 0)
            logger.exception("Notification scheduler singleton lease lost")
            await asyncio.sleep(standby_seconds)
