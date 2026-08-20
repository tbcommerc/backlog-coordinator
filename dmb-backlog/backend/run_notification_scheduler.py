"""Запуск единственного production worker плановых уведомлений."""
import asyncio

from config import validate_runtime_settings
from notification_scheduler import notification_scheduler_loop


if __name__ == "__main__":
    validate_runtime_settings()
    asyncio.run(notification_scheduler_loop())
