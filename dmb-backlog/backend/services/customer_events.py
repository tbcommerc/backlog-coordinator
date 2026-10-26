"""Customer request events share Notification read state; no separate view counter."""
from sqlalchemy import select, func
from models import Notification


def unread_query(user_id, request_ids):
    return select(Notification).where(Notification.user_id == user_id,
        Notification.category == "request", Notification.is_read.is_(False),
        Notification.is_dismissed.is_(False),
        Notification.action_url.in_([f"#/customer/request/{i}" for i in request_ids]))


def summaries(db, user_id, request_ids):
    if not request_ids:
        return {}
    rows = unread_query(user_id, request_ids).subquery()
    return dict(db.execute(select(rows.c.action_url, func.count()).group_by(rows.c.action_url)).all())


def request_events(db, user_id, request_id):
    query = unread_query(user_id, [request_id])
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.scalars(query.order_by(Notification.created_at.desc(), Notification.id.desc()).limit(100))
    return {"total": total, "items": [{"id": n.id, "title": n.title, "body": n.body,
        "created_at": n.created_at, "type": n.type} for n in rows]}
