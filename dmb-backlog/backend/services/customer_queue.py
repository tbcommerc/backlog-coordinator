"""Read-only customer queue: SQL projection/search + bounded merge of remote drafts."""
import re
from datetime import datetime, timezone
from typing import Literal
from pydantic import BaseModel, Field
from sqlalchemy import select, union_all, literal, cast, String, case, func, and_, or_, exists
from models import Task, RequirementRequest, Team, User, TaskStatus, Deadline
from services.backlog_assistant_integration.policy import customer_tasks_clause

GROUPS = ("action", "draft", "review", "work", "complete")
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


class QueueItem(BaseModel):
    id: str
    kind: Literal["request", "task", "draft"]
    title: str
    description: str | None = None
    status: str
    group: str
    task_id: int | None = None
    task_public_id: str | None = None
    task_status: str | None = None
    task_progress: int | None = None
    task_deadline: str | None = None
    team_name: str | None = None
    reviewer_name: str | None = None
    assignee_name: str | None = None
    reject_reason: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    session_id: str | None = None
    active: bool = False
    draft_session: bool = False
    legacy_task: bool = False
    unread_event_count: int = 0


class QueueResponse(BaseModel):
    items: list[QueueItem]
    total: int
    page: int
    per_page: int
    pages: int
    counts: dict[str, int]
    warnings: list[str] = Field(default_factory=list)
    preferred_draft: QueueItem | None = None


def projection(user):
    """Own requests and own customer's tasks; deduplication precedes search."""
    task, req = Task.__table__, RequirementRequest.__table__
    team, people = Team.__table__, User.__table__
    status, deadline = TaskStatus.__table__, Deadline.__table__
    reviewer, assignee = people.alias("queue_reviewer"), people.alias("queue_assignee")

    def columns(kind, identifier, title, description, state, created, updated, **extra):
        values = dict(kind=literal(kind), id=cast(identifier, String), title=title,
            description=description, status=state, created_at=created,
            updated_at=func.coalesce(updated, created), task_id=task.c.id,
            task_public_id=task.c.public_id, task_status=status.c.name,
            task_progress=task.c.progress, task_deadline=deadline.c.name,
            team_name=team.c.name, reviewer_name=cast(literal(None), String),
            assignee_name=cast(literal(None), String), reject_reason=cast(literal(None), String))
        values.update(extra)
        group = case(
            (state.in_(["completed", "not_relevant", "task_rejected", "task_deleted", "rejected"]), "complete"),
            (status.c.name.in_(["ВЫПОЛНЕНА", "ОТКЛОНЕНА", "НЕ АКТУАЛЬНА"]), "complete"),
            (status.c.name == "ХОЛД", "action"),
            (status.c.name == "ПРИНЯТА В РАБОТУ", "work"),
            (state.in_(["approved", "rejected"]), "complete"),
            (state.in_(["draft", "returned"]), "action"),
            (state.in_(["submitted", "in_review"]), "review"), else_="work")
        values["group"] = group
        return [value.label(key) for key, value in values.items()]

    request_rows = select(*columns("request", req.c.id, req.c.title, req.c.description,
        req.c.status, req.c.created_at, req.c.updated_at,
        reviewer_name=reviewer.c.name, assignee_name=assignee.c.name,
        reject_reason=req.c.reject_reason)).select_from(
        req.outerjoin(task, and_(task.c.id == req.c.task_id, task.c.is_deleted.is_(False)))
        .outerjoin(team, team.c.id == req.c.team_id)
        .outerjoin(reviewer, reviewer.c.id == req.c.reviewer_id)
        .outerjoin(assignee, assignee.c.id == req.c.assignee_id)
        .outerjoin(status, status.c.id == task.c.status_id)
        .outerjoin(deadline, deadline.c.id == task.c.deadline_id)
    ).where(req.c.user_id == user.id, req.c.is_deleted.is_(False))
    own_link = exists(select(req.c.id).where(req.c.task_id == task.c.id,
        req.c.user_id == user.id, req.c.is_deleted.is_(False)))
    task_rows = select(*columns("task", task.c.id, task.c.title, task.c.description,
        literal("in_progress"), task.c.created_at, task.c.updated_at)).select_from(
        task.outerjoin(team, team.c.id == task.c.team_id)
        .outerjoin(status, status.c.id == task.c.status_id)
        .outerjoin(deadline, deadline.c.id == task.c.deadline_id)
    ).where(task.c.is_deleted.is_(False), customer_tasks_clause(user), ~own_link)
    return union_all(request_rows, task_rows).subquery("customer_queue")


def timestamp(value):
    if isinstance(value, str):
        try: value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError: return None
    if not isinstance(value, datetime): return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def drafts_from_sessions(sessions):
    result = {}
    for session in sessions:
        sid = session.get("session_id")
        if not sid or session.get("archived") or session.get("request_id") or not (session.get("has_draft") or session.get("phase") == "draft_ready"):
            continue
        result[str(sid)] = QueueItem(id="draft-" + str(sid), kind="draft",
            title=str(session.get("title") or "Новый запрос"), status="draft", group="draft",
            session_id=str(sid), draft_session=True, active=bool(session.get("active")),
            created_at=timestamp(session.get("created_at") or session.get("updated_at")),
            updated_at=timestamp(session.get("last_message_at") or session.get("updated_at")))
    return list(result.values())


def sort_key(item):
    # String IDs provide deterministic tie-breaking across the SQL/remote merge.
    return (timestamp(item.updated_at or item.created_at) or EPOCH, item.kind, item.id)


def queue_page(db, user, sessions, *, q="", group="", sort="newest", page=1, per_page=25, warnings=None):
    source = projection(user)
    drafts = drafts_from_sessions(sessions)
    preferred = next((d for d in drafts if d.active), max(drafts, key=sort_key, default=None))
    counts = {key: 0 for key in ("all", *GROUPS)}
    for name, count in db.execute(select(source.c.group, func.count()).group_by(source.c.group)):
        counts[name] = count
    counts["draft"] += len(drafts)
    counts["all"] = sum(counts[g] for g in GROUPS)
    query = select(source)
    if group: query = query.where(source.c.group == group)
    if q:
        text = literal("")
        for name in ("id", "task_public_id", "title", "description", "team_name", "assignee_name", "reviewer_name", "reject_reason"):
            text = text + literal(" ") + func.coalesce(cast(source.c[name], String), "")
        search = func.lower(text).contains(q.lower(), autoescape=True)
        public_id = re.fullmatch(r"TASK-(\d{3})-(\d{3})", q, re.IGNORECASE)
        if public_id:
            # Legacy tasks may have no stored public_id; match the displayed fallback.
            search = or_(search, source.c.task_id == int("".join(public_id.groups())))
        query = query.where(search)
    matching_drafts = [d for d in drafts if (not group or group == "draft") and
        (not q or q.lower() in (d.id + " " + d.title).lower())]
    total = db.scalar(select(func.count()).select_from(query.subquery())) + len(matching_drafts)
    pages = (total + per_page - 1) // per_page
    page = min(page, max(1, pages))
    offset = (page - 1) * per_page
    order = [func.coalesce(source.c.updated_at, source.c.created_at, EPOCH), source.c.kind, source.c.id]
    query = query.order_by(*(c.desc() if sort == "newest" else c.asc() for c in order))
    # Only a bounded prefix is needed when remote drafts participate in the page.
    query = query.limit(offset + per_page) if matching_drafts else query.offset(offset).limit(per_page)
    items = []
    for row in db.execute(query).mappings():
        data = dict(row)
        data.update(created_at=timestamp(data["created_at"]), updated_at=timestamp(data["updated_at"]))
        if data["kind"] == "task": data.update(id="task-" + data["id"], legacy_task=True)
        items.append(QueueItem(**data))
    if matching_drafts:
        # Use raw task ID for the same ordering as SQL, not the display prefix.
        def key(item):
            time, kind, identifier = sort_key(item)
            return time, kind, identifier.removeprefix("task-") if kind == "task" else identifier
        items = sorted(items + matching_drafts, key=key, reverse=sort == "newest")[offset:offset + per_page]
    from services.customer_events import summaries
    unread = summaries(db, user.id, [item.id for item in items if item.kind == "request"])
    for item in items:
        if item.kind == "request":
            item.unread_event_count = unread.get(f"#/customer/request/{item.id}", 0)
    return QueueResponse(items=items, total=total, page=page, per_page=per_page, pages=pages,
        counts=counts, warnings=warnings or [], preferred_draft=preferred)
