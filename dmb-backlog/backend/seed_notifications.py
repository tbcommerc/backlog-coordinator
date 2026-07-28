"""
Seed demo notifications into the database.
Run:  cd backend && python seed_notifications.py
"""
import sqlite3
import os
from datetime import datetime, timedelta
import random

DB_PATH = os.path.join(os.path.dirname(__file__), "dmb_backlog.db")

USER_ID = 1  # Т. Бабяк — ЛТ, видит все риски

NOW = datetime.utcnow()


def dt(hours_ago: int) -> str:
    """Return an ISO timestamp N hours ago."""
    return (NOW - timedelta(hours=hours_ago)).strftime("%Y-%m-%dT%H:%M:%S")


def insert(cur, **kw):
    # Ensure legacy NOT NULL columns are populated
    kw.setdefault("type", "system")
    kw.setdefault("message", kw.get("title", ""))
    # Explicitly set booleans to 0/1 (not None) so SQLAlchemy filters work
    kw.setdefault("is_read", 0)
    kw.setdefault("is_dismissed", 0)
    kw.setdefault("group_count", 1)
    cols = ", ".join(kw.keys())
    phs = ", ".join(["?"] * len(kw))
    cur.execute(
        f"INSERT INTO notifications ({cols}) VALUES ({phs})",
        list(kw.values()),
    )


def main():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # Count existing for this user
    existing = cur.execute(
        "SELECT COUNT(*) FROM notifications WHERE user_id = ?", (USER_ID,)
    ).fetchone()[0]
    if existing >= 20:
        print(f"User {USER_ID} already has {existing} notifications. Skipping seed.")
        conn.close()
        return

    rows = [
        # ── risk (3) ─────────────────────────────────────────────
        dict(
            user_id=USER_ID, task_id=1, category="risk",
            title="Задача «Интеграция с MOEX API» переведена в ХОЛД",
            body="Команда Pre-Trade заблокирована. Требуется решение руководства.",
            importance="critical", is_read=0, action_url="#/backlog",
            group_key=None, group_count=1, created_at=dt(2),
        ),
        dict(
            user_id=USER_ID, task_id=2, category="risk",
            title="Эскалация на ЛТ: «Модуль ценообразования»",
            body="Задача требует участия ЛТ для разрешения блокировки по архитектуре.",
            importance="high", is_read=0, action_url="#/backlog",
            group_key=None, group_count=1, created_at=dt(5),
        ),
        dict(
            user_id=USER_ID, task_id=20, category="risk",
            title="Задача «Миграция легаси-сервисов» переведена в ХОЛД",
            body="Архитектурные противоречия требуют согласования с техническим руководителем.",
            importance="critical", is_read=0, action_url="#/backlog",
            group_key=None, group_count=1, created_at=dt(8),
        ),

        # ── deadline (3) ─────────────────────────────────────────
        dict(
            user_id=USER_ID, task_id=3, category="deadline",
            title="Дедлайн через 3 дня: «Распределённое кэширование»",
            body="До дедлайна осталось менее 72 часов. Прогресс: 35%.",
            importance="high", is_read=0, action_url="#/backlog",
            created_at=dt(1),
        ),
        dict(
            user_id=USER_ID, task_id=4, category="deadline",
            title="Дедлайн задачи завтра: «OpenAPI документация»",
            body="Срочно завершить работу! Прогресс: 80%.",
            importance="critical", is_read=0, action_url="#/backlog",
            created_at=dt(3),
        ),
        dict(
            user_id=USER_ID, task_id=19, category="deadline",
            title="Дедлайн через 5 дней: «Сервис нотификаций»",
            body="Приближается дедлайн. Прогресс: 60%.",
            importance="medium", is_read=1,
            read_at=dt(1), action_url="#/backlog",
            created_at=dt(12),
        ),

        # ── status_change (4) ────────────────────────────────────
        dict(
            user_id=USER_ID, task_id=1, category="status_change",
            title="Задача #1 переведена в «ХОЛД»",
            body="Новый статус: ХОЛД. Предыдущий: ПРИНЯТА В РАБОТУ.",
            importance="high", is_read=0, action_url="#/backlog",
            created_at=dt(2),
        ),
        dict(
            user_id=USER_ID, task_id=5, category="status_change",
            title="Задача #5 переведена в «ЭКСПРЕСС-ОЦЕНКУ»",
            body="Новый статус: ЭКСПРЕСС-ОЦЕНКА. Предыдущий: СБОР ТРЕБОВАНИЙ.",
            importance="medium", is_read=0, action_url="#/backlog",
            created_at=dt(6),
        ),
        dict(
            user_id=USER_ID, task_id=19, category="status_change",
            title="Задача #19 переведена в «ВЫПОЛНЕНА»",
            body="Задача успешно завершена. Все acceptance criteria выполнены.",
            importance="low", is_read=1,
            read_at=dt(4), action_url="#/backlog",
            created_at=dt(24),
        ),
        dict(
            user_id=USER_ID, task_id=3, category="status_change",
            title="Задача #3 переведена в «ПРИНЯТА В РАБОТУ»",
            body="Новый статус: ПРИНЯТА В РАБОТУ. Предыдущий: НАЗНАЧЕНА КОМАНДА.",
            importance="medium", is_read=0, action_url="#/backlog",
            created_at=dt(10),
        ),

        # ── assignment (2) ───────────────────────────────────────
        dict(
            user_id=USER_ID, task_id=8, category="assignment",
            title="Вы назначены ответственным за задачу #8",
            body="Вас назначили исполнителем задачи «Бюджетирование IT-проектов».",
            importance="medium", is_read=0, action_url="#/backlog",
            created_at=dt(4),
        ),
        dict(
            user_id=USER_ID, task_id=15, category="assignment",
            title="Вы назначены ответственным за задачу #15",
            body="Назначение: «Разработка ML-модели прогнозирования». Дедлайн: конец квартала.",
            importance="medium", is_read=1,
            read_at=dt(10), action_url="#/backlog",
            created_at=dt(20),
        ),

        # ── mention (2) ──────────────────────────────────────────
        dict(
            user_id=USER_ID, task_id=1, category="mention",
            title="А. Коптелов упомянул вас в задаче #1",
            body="«@Т. Бабяк, нужна ваша оценка по интеграции с MOEX API»",
            importance="high", is_read=0, action_url="#/backlog",
            created_at=dt(1),
        ),
        dict(
            user_id=USER_ID, task_id=6, category="mention",
            title="Д. Маркус упомянул вас в задаче #6",
            body="«@Т. Бабяк, посмотрите пожалуйста API-спецификацию для Post-Trade»",
            importance="medium", is_read=1,
            read_at=dt(8), action_url="#/backlog",
            created_at=dt(16),
        ),

        # ── comment (3) ──────────────────────────────────────────
        dict(
            user_id=USER_ID, task_id=2, category="comment",
            title="Новый комментарий к задаче #2",
            body="Д. Фомин: «Нужно согласовать тарифы с бэк-офисом до конца недели»",
            importance="medium", is_read=0, action_url="#/backlog",
            created_at=dt(3),
        ),
        dict(
            user_id=USER_ID, task_id=7, category="comment",
            title="Новый комментарий к задаче #7",
            body="Р. Хачатрян: «Обновил описание, посмотрите пожалуйста»",
            importance="low", is_read=0, action_url="#/backlog",
            created_at=dt(7),
        ),
        dict(
            user_id=USER_ID, task_id=20, category="comment",
            title="Новый комментарий к задаче #20",
            body="В. Баклушин: «Микросервис готов к ревью, назначьте тайм-слот»",
            importance="medium", is_read=1,
            read_at=dt(5), action_url="#/backlog",
            created_at=dt(14),
        ),

        # ── express (2) ──────────────────────────────────────────
        dict(
            user_id=USER_ID, task_id=4, category="express",
            title="Экспресс-импорт: задача #4 переведена в оценку",
            body="Задача «OpenAPI документация Pre-Trade API» импортирована из внешней системы.",
            importance="medium", is_read=0, action_url="#/backlog",
            created_at=dt(18),
        ),
        dict(
            user_id=USER_ID, task_id=12, category="express",
            title="Экспресс-импорт: задача #12 переведена в оценку",
            body="Экспресс-оценка для задачи «Обновление интерфейса клиринга».",
            importance="medium", is_read=1,
            read_at=dt(12), action_url="#/backlog",
            created_at=dt(36),
        ),

        # ── stale (2) ────────────────────────────────────────────
        dict(
            user_id=USER_ID, task_id=3, category="stale",
            title="Задача «Распределённое кэширование» простаивает 14 дней",
            body="Задача в статусе «ПРИНЯТА В РАБОТУ» без обновлений более 2 недель.",
            importance="medium", is_read=0, action_url="#/backlog",
            created_at=dt(6),
        ),
        dict(
            user_id=USER_ID, task_id=10, category="stale",
            title="Задача #10 без обновлений 18 дней",
            body="Требуется статус-апдейт или изменение статуса.",
            importance="medium", is_read=1,
            read_at=dt(3), action_url="#/backlog",
            created_at=dt(48),
        ),

        # ── attrs (3) ────────────────────────────────────────────
        dict(
            user_id=USER_ID, task_id=4, category="attrs",
            title="У задачи #4 не заполнено описание",
            body="Описание отсутствует или содержит менее 20 символов.",
            importance="low", is_read=1,
            read_at=dt(6), action_url="#/backlog",
            created_at=dt(30),
        ),
        dict(
            user_id=USER_ID, task_id=11, category="attrs",
            title="У задачи #11 не указана оценка трудозатрат",
            body="Поле «Трудозатраты (дни)» пустое. Заполните для корректного планирования.",
            importance="low", is_read=0, action_url="#/backlog",
            created_at=dt(15),
        ),
        dict(
            user_id=USER_ID, task_id=25, category="attrs",
            title="У задачи #25 не указан бизнес-заказчик",
            body="Заполните поле «Бизнес-заказчик» для корректного формирования отчётов.",
            importance="low", is_read=0, action_url="#/backlog",
            created_at=dt(22),
        ),

        # ── system (2) ───────────────────────────────────────────
        dict(
            user_id=USER_ID, task_id=9, category="system",
            title="Задача от заказчика: «Тестирование API»",
            body="Новая задача создана через портал бизнес-заказчика.",
            importance="medium", is_read=0, action_url="#/backlog",
            created_at=dt(9),
        ),
        dict(
            user_id=USER_ID, task_id=16, category="system",
            title="Задача от заказчика: «Отчёт по риску»",
            body="Задача автоматически создана из обращения заказчика. Ожидает распределения.",
            importance="medium", is_read=1,
            read_at=dt(8), action_url="#/backlog",
            created_at=dt(26),
        ),

        # ── grouped (3) ──────────────────────────────────────────
        dict(
            user_id=USER_ID, task_id=None, category="risk",
            title="3 задачи в статусе «ХОЛД»",
            body="Задачи #1, #2, #20 находятся в статусе ХОЛД. Требуется внимание.",
            importance="high", is_read=0, action_url="#/backlog",
            group_key="demo_risk_hold", group_count=3, created_at=dt(4),
        ),
        dict(
            user_id=USER_ID, task_id=None, category="deadline",
            title="2 задачи с дедлайном на этой неделе",
            body="Задачи #3 и #4 — дедлайны в ближайшие 3 дня.",
            importance="high", is_read=0, action_url="#/backlog",
            group_key="demo_deadline_week", group_count=2, created_at=dt(2),
        ),
        dict(
            user_id=USER_ID, task_id=None, category="comment",
            title="4 новых комментария к вашим задачам",
            body="Комментарии к задачам #2, #7, #19, #20 за последние сутки.",
            importance="medium", is_read=1,
            read_at=dt(6), action_url="#/backlog",
            group_key="demo_comments", group_count=4, created_at=dt(11),
        ),

        # ── final system greeting (1) ────────────────────────────
        dict(
            user_id=USER_ID, task_id=None, category="system",
            title="Система уведомлений активирована",
            body="Серверные уведомления запущены. Настройте интересующие категории в «Настройки → Уведомления».",
            importance="low", is_read=1,
            read_at=dt(0.5), action_url="#/settings",
            created_at=dt(48),
        ),
    ]

    for r in rows:
        insert(cur, **r)

    conn.commit()
    inserted = cur.execute("SELECT COUNT(*) FROM notifications").fetchone()[0]
    print(f"Seeded {len(rows)} notifications (total in DB: {inserted})")
    conn.close()


if __name__ == "__main__":
    main()
