"""Shared read projection for request registers and cards; never changes a decision."""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from sqlalchemy import select, exists, case, and_, or_, cast, String, func
from models import RequirementRequest, WorkResolution, RequestWorkLink, WorkTask, Task, TaskStatus

CLOSED = ('rejected', 'withdrawn', 'completed', 'fulfilled', 'not_relevant', 'task_rejected', 'task_deleted', 'approved')
FOLLOW_UP = ('awaiting_confirmation', 'needs_verification')


def today():
    return datetime.now(ZoneInfo('Europe/Moscow')).date()


def state_expression(req=None):
    """Correlated SQL used before pagination, including changed/deleted linked work."""
    req = RequirementRequest.__table__ if req is None else req
    r, l, w, t, s = (x.__table__.alias() for x in (WorkResolution, RequestWorkLink, WorkTask, Task, TaskStatus))
    targets = l.outerjoin(w, w.c.id == l.c.work_task_id).outerjoin(t, t.c.id == l.c.major_task_id).outerjoin(s, s.c.id == t.c.status_id)
    valid = and_(l.c.is_active.is_(True), or_(and_(l.c.work_task_id.is_not(None), w.c.id.is_not(None), w.c.is_deleted.is_(False)),
                  and_(l.c.major_task_id.is_not(None), t.c.id.is_not(None), t.c.is_deleted.is_(False))))
    done = or_(and_(l.c.work_task_id.is_not(None), w.c.status == 'done'), and_(l.c.major_task_id.is_not(None), s.c.name == 'ВЫПОЛНЕНА'))
    def any_link(condition):
        return exists(select(1).select_from(targets).where(l.c.request_id == req.c.id, condition).correlate(req, r))
    has_links = any_link(True)
    invalid = any_link(or_(~valid, w.c.status == 'cancelled', s.c.name.in_(['ОТКЛОНЕНА', 'НЕ АКТУАЛЬНА'])))
    unfinished = any_link(~func.coalesce(done, False))
    changed_revision = any_link(and_(l.c.work_task_id.is_not(None),
        func.coalesce(r.c.confirmed_work_revisions[cast(w.c.id, String)].as_integer(), -1) != w.c.result_revision))
    executing = any_link(or_(w.c.status.in_(['in_progress', 'in_acceptance']), s.c.name == 'ПРИНЯТА В РАБОТУ'))
    resolved = select(case(
        (or_(~has_links, invalid, r.c.fulfillment=='needs_verification', and_(r.c.fulfillment == 'fulfilled', or_(r.c.coverage!='full', unfinished, changed_revision))), 'needs_verification'),
        (and_(r.c.fulfillment == 'fulfilled', r.c.coverage == 'full'), 'fulfilled'),
        (~unfinished, 'awaiting_confirmation'),
        (executing, 'in_progress'),
        else_='queued',
    )).where(r.c.request_id == req.c.id).correlate(req).scalar_subquery()
    return case((req.c.status.in_(['rejected', 'withdrawn', 'submitted', 'in_review', 'returned', 'accepted', 'deferred']), req.c.status),
                else_=func.coalesce(resolved, req.c.status))


def effective_state(db, req):
    return db.scalar(select(state_expression()).where(RequirementRequest.id == req.id)) or req.status


def follow_up_due(req):
    return bool(req.next_action_due and req.next_action_due <= today())


def lifecycle_actions(req, user, can_review, effective=None):
    effective = effective or req.status
    actions = []
    if req.user_id == user.id and effective not in CLOSED and req.status != 'draft':
        actions.append('withdraw')
    if not can_review:
        return actions
    if req.status in {'rejected', 'withdrawn', 'deferred'}:
        actions.append('reconsider')
    if req.status == 'in_review' and req.reviewer_id == user.id:
        actions += ['accept', 'defer']
    if req.status == 'accepted':
        actions += ['place', 'defer']
    if effective not in CLOSED:
        actions.append('follow_up')
    return actions
