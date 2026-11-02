"""Complete, permission-scoped request search and pagination."""
from datetime import datetime, timedelta, timezone
import re
import math
from fastapi import HTTPException
from sqlalchemy import select, func, or_, and_, cast, String
from sqlalchemy.orm import aliased, joinedload
from auth import get_request_review_access, is_customer_portal_only
from models import RequirementRequest as R, User, Team, BusinessCustomer
from services.request_state import state_expression, CLOSED, FOLLOW_UP, today


def tokens(value, allowed):
    values = {x for x in value.split(',') if x}
    if values - set(allowed):
        raise HTTPException(422, 'Неизвестный фильтр запросов')
    return values


def signal_count(draft):
    draft = draft if isinstance(draft, dict) else {}
    seen = set()
    for key in ('open_questions', 'conflicts', 'risks', 'assumptions', 'quality_issues', 'review_findings', 'gaps'):
        if key == 'risks' and (draft.get('field_status') or {}).get('risks') == 'not_applicable':
            continue
        values = draft.get(key) or []
        for value in values if isinstance(values, list) else [values]:
            if isinstance(value, dict):
                if str(value.get('status', '')).lower() in {'resolved', 'closed', 'not_applicable'}:
                    continue
                value = next((value.get(k) for k in ('text', 'message', 'question', 'value') if value.get(k)), '')
            text = str(value or '').strip().lower()
            if text: seen.add(text)
    return len(seen)


def registry(db, user, *, q='', mode='all', status='any', sort='stage_oldest', signals=False, aged=False,
             team_ids='', customer_ids='', coordinator_ids='', limit=50, offset=0):
    access = get_request_review_access(user)
    if access == 'none' or is_customer_portal_only(user): raise HTTPException(403, 'Доступ запрещён')
    author, coordinator = aliased(User), aliased(User)
    state = state_expression()
    query = db.query(R).outerjoin(author, author.id == R.user_id).outerjoin(Team, Team.id == R.team_id).outerjoin(coordinator, coordinator.id == R.coordinator_id).outerjoin(BusinessCustomer, BusinessCustomer.id == author.business_customer_id)
    query = query.filter(R.is_deleted.is_(False), R.status != 'draft')
    if access != 'all': query = query.filter(R.team_id == user.team_id)
    options = {
        'teams': [{'id': id, 'name': name} for id, name in query.with_entities(Team.id, Team.name).filter(Team.id.is_not(None)).distinct().order_by(Team.name)],
        'customers': [{'id': id, 'name': name} for id, name in query.with_entities(BusinessCustomer.id, BusinessCustomer.name).filter(BusinessCustomer.id.is_not(None)).distinct().order_by(BusinessCustomer.name)],
        'coordinators': [{'id': id, 'name': name} for id, name in query.with_entities(coordinator.id, coordinator.name).filter(coordinator.id.is_not(None)).distinct().order_by(coordinator.name)],
    }
    for values, column in ((team_ids, R.team_id), (customer_ids, author.business_customer_id), (coordinator_ids, R.coordinator_id)):
        if values:
            try: ids = [int(x) for x in values.split(',')]
            except ValueError: raise HTTPException(422, 'Некорректный фильтр участников')
            if any(x <= 0 for x in ids): raise HTTPException(422, 'Некорректный фильтр участников')
            query = query.filter(column.in_(ids))
    if q.strip():
        match=re.fullmatch(r'(?:#|запрос\s*#?)?\s*(\d+)',q.strip(),re.IGNORECASE)
        query = query.filter(or_(R.id==int(match.group(1)) if match else False, *(func.lower(func.coalesce(cast(c, String), '')).contains(q.strip().lower(), autoescape=True)
            for c in (R.id, R.title, R.description, R.reject_reason, R.next_action, author.name, Team.name, coordinator.name, BusinessCustomer.name))))
    due = and_(R.next_action_due <= today(), ~state.in_(CLOSED))
    needs_action = or_(R.status == 'submitted', and_(R.status == 'in_review', R.reviewer_id == user.id),
                      and_(or_(R.coordinator_id == user.id, and_(R.coordinator_id.is_(None), R.reviewer_id == user.id)), or_(due, state.in_(FOLLOW_UP))))
    modes = {'all': True, 'action': needs_action, 'active': ~state.in_(CLOSED), 'history': state.in_(CLOSED),
             'my_review': and_(R.reviewer_id == user.id, R.status == 'in_review'),
             'my_work': or_(R.coordinator_id == user.id, R.assignee_id == user.id),
             'confirmation': state == 'awaiting_confirmation', 'verification': state == 'needs_verification', 'due': due}
    old = and_(func.coalesce(R.updated_at, R.created_at) <= datetime.now(timezone.utc) - timedelta(days=3), ~state.in_(CLOSED))
    counts = {name: query.filter(condition).count() for name, condition in {'all': True, 'new': R.status == 'submitted', 'mine': modes['my_review'], 'action': needs_action, 'aged': old}.items()}
    # Irregular historical draft shapes are normalized on the server before filtering/pagination.
    drafts = dict(query.with_entities(R.id, R.draft).all())
    scores = {id: signal_count(draft) for id, draft in drafts.items()}
    counts['risk'] = sum(value > 0 for value in scores.values())
    query = query.filter(or_(*(modes[x] for x in tokens(mode, modes) or {'all'})))
    statuses = tokens(status, {'any', 'submitted', 'in_review', 'returned', 'accepted', 'deferred', 'withdrawn', 'queued', 'in_progress', 'approved', 'rejected', 'completed', 'not_relevant', 'task_rejected', 'task_deleted', 'fulfilled', *FOLLOW_UP})
    if statuses and 'any' not in statuses: query = query.filter(state.in_(statuses))
    if aged: query = query.filter(old)
    if signals: query = query.filter(R.id.in_([id for id, n in scores.items() if n]))
    total = query.count()
    from sqlalchemy import case
    if sort == 'signals': order = case(scores, value=R.id, else_=0).desc() if scores else R.id.desc()
    elif sort == 'quality':
        quality={}
        for id,draft in drafts.items():
            try:
                value=float(draft.get('quality_score'))
                if math.isfinite(value): quality[id]=value
            except (ValueError,TypeError,AttributeError): pass
        order=case(quality,value=R.id,else_=None).asc().nullslast() if quality else R.id.asc()
    elif sort == 'newest': order = func.coalesce(R.updated_at, R.created_at).desc()
    elif sort == 'stage_oldest': order = func.coalesce(R.updated_at, R.created_at).asc()
    else: raise HTTPException(422, 'Неизвестная сортировка')
    rows = query.options(joinedload(R.user), joinedload(R.team), joinedload(R.coordinator), joinedload(R.reviewer), joinedload(R.assignee), joinedload(R.task)).add_columns(state).order_by(order, R.id).offset(offset).limit(limit).all()
    from routers.agent_router import _request_to_dict
    return {'items': [_request_to_dict(r, user, effective_status=effective) for r, effective in rows], 'total': total, 'offset': offset, 'limit': limit,
            'has_more': offset + len(rows) < total, 'counts': counts, 'options': options}
