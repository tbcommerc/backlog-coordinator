"""Separate local execution API."""
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query, Header
from sqlalchemy.orm import Session
from sqlalchemy import func, case, or_, cast, String
from database import get_db
from auth import get_current_user, require_non_business_customer_access, can_access_task
from models import WorkTask, WorkHistory, WorkComment, Task, User, Team, Project
from work_contract import WorkCreate, WorkUpdate, Move, Transition, Assignment, Comment, Reassignment, ChecklistToggle, TemplateCreate, TemplateUpdate, Version, Priority
from services import work_tasks as work
from services.work_query import Filters, Selection
from services import work_board
from config import settings
from pydantic import ValidationError


def validated_filters(**values):
    try:
        return Filters(**values)
    except ValidationError:
        raise HTTPException(422, {'code':'invalid_filters','message':'Проверьте значения фильтров рабочих задач'})

def filter_dependency(**values):
    return validated_filters(**values)


# Keep the model query signature and return 422 for model-validation failures.
from inspect import signature
filter_dependency.__signature__ = signature(Filters)

router = APIRouter(dependencies=[Depends(require_non_business_customer_access)])


@router.get('/workspace-search')
def workspace_search(q: str = Query(..., min_length=1, max_length=200),
                     page: int = Query(1, ge=1), per_page: int = Query(20, ge=1, le=50),
                     db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Search the full accessible task corpus rather than a cached first page."""
    from auth import task_read_scope_clause, get_request_review_access
    from models import RequirementRequest
    from sqlalchemy import select, union_all, literal
    if not q.strip(): raise HTTPException(422, 'Введите текст поиска')
    pattern = '%' + q.strip().replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
    work_rows = select(WorkTask.id.label('id'), literal('work').label('kind'),
        WorkTask.title.label('title'), ('WRK-' + cast(WorkTask.id, String)).label('public_id')).where(
        WorkTask.is_deleted.is_(False), work.read_scope(user),
        or_(WorkTask.title.ilike(pattern, escape='\\'), WorkTask.description.ilike(pattern, escape='\\'),
            WorkTask.result_text.ilike(pattern, escape='\\'), ('WRK-' + cast(WorkTask.id, String)).ilike(pattern, escape='\\')))
    task_rows = select(Task.id.label('id'), literal('task').label('kind'), Task.title.label('title'),
        Task.public_id.label('public_id')).where(Task.is_deleted.is_(False), task_read_scope_clause(user, Task),
        or_(Task.title.ilike(pattern, escape='\\'), Task.public_id.ilike(pattern, escape='\\')))
    project_rows = select(Project.id.label('id'), literal('project').label('kind'),
        Project.name.label('title'), (literal('PRJ-') + cast(Project.id, String)).label('public_id')).where(
        or_(Project.name.ilike(pattern, escape='\\'), (literal('PRJ-') + cast(Project.id, String)).ilike(pattern, escape='\\')))
    review_scope = get_request_review_access(user)
    request_access = or_(RequirementRequest.user_id == user.id,
        (RequirementRequest.status != 'draft') & (True if review_scope == 'all' else
            RequirementRequest.team_id == user.team_id if review_scope == 'team' and user.team_id else False))
    request_rows = select(RequirementRequest.id.label('id'), literal('request').label('kind'),
        RequirementRequest.title.label('title'), (literal('REQ-') + cast(RequirementRequest.id, String)).label('public_id')).where(
        RequirementRequest.is_deleted.is_(False), request_access,
        or_(RequirementRequest.title.ilike(pattern, escape='\\'),
            (literal('REQ-') + cast(RequirementRequest.id, String)).ilike(pattern, escape='\\')))
    corpus = union_all(work_rows, task_rows, project_rows, request_rows).subquery()
    total = db.query(func.count()).select_from(corpus).scalar()
    rows = db.execute(select(corpus).order_by(case((func.lower(corpus.c.public_id) == q.strip().lower(), 0), else_=1),
        corpus.c.kind, corpus.c.id.desc()).offset((page-1)*per_page).limit(per_page)).mappings()
    return {'items': [dict(row) for row in rows], 'total': total, 'page': page, 'per_page': per_page}


@router.get('/work-tasks/options')
def options(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from auth import is_customer_portal_only
    return {'can_create': work.editor(user, user.team_id), 'board_enabled': settings.WORK_TASK_BOARD_ENABLED,
            'teams': [{'id': x.id, 'name': x.name} for x in db.query(Team).order_by(Team.name)],
            'users': [{'id': x.id, 'name': x.name, 'team_id': x.team_id, 'login_notice': {'invited': 'Приглашение не принято', 'reset_required': 'Требуется восстановление доступа'}.get(x.credential_state)} for x in db.query(User).filter_by(is_active=True) if not is_customer_portal_only(x)],
            'projects': [{'id': x.id, 'name': x.name} for x in db.query(Project).order_by(Project.name)]}


@router.get('/work-tasks/board')
def board(filters: Filters = Depends(filter_dependency), page_size: int = Query(20, ge=1, le=50), selected_id: int | None = Query(None, gt=0),
          db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    with work_board.snapshot(db) as reader:
        return work_board.read(reader, user, filters, page_size, selected_id=selected_id)


@router.get('/work-tasks/board/columns/{column_status}')
def board_column(column_status: Literal['new','ready','in_progress','in_acceptance','done','cancelled'],
                 filters: Filters = Depends(filter_dependency), page_size: int = Query(20, ge=1, le=50), cursor: str | None = None,
                 db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    with work_board.snapshot(db) as reader:
        return work_board.read(reader, user, filters, page_size, column_status, cursor)


@router.get('/work-tasks')
def list_work(view: Literal['all', 'mine', 'team', 'requested', 'acceptance'] = 'mine',
              status: str | None = None, q: str = '', execution_team_id: str | None = None,
              assignee_id: str | None = None, major_task_id: int | None = None,
              direct_project_id: int | None = None, work_direction: str | None = None,
              overdue: bool = False, blocked: bool = False, unassigned: bool = False, focus: str = '',
              sort: Literal['newest', 'due', 'attention', 'priority'] = 'newest', priority: str | None = None,
              page: int = Query(1, ge=1), per_page: int = Query(30, ge=1, le=100),
              db: Session = Depends(get_db), user: User = Depends(get_current_user),
              effective_project_id: str | None = None, done_period: Literal['all','7d','30d'] = 'all', selected_id: int | None = None):
    filters = validated_filters(view=view,status=status or '',q=q,execution_team_id=execution_team_id,
        assignee_id=assignee_id,major_task_id=major_task_id,direct_project_id=direct_project_id,
        effective_project_id=effective_project_id,work_direction=work_direction,priority=priority,
        overdue=overdue,blocked=blocked,unassigned=unassigned,focus=focus,sort=sort,done_period=done_period)
    selection = Selection(db,user,filters)
    collections,summary = selection.aggregates()
    rows = selection.query.order_by(*selection.keys).offset((page-1)*per_page).limit(per_page).all()
    return {'items':[work.response(db,x,user) for x in rows], 'total':summary['total'],'page':page,
        'collection_counts':collections,'summary':summary,'focus_counts':selection.focus_counts(),'summary_states':selection.summary_states(),
        'selected_matches':bool(selection.query.filter(WorkTask.id==selected_id).count()) if selected_id else None,
        'attention_items':[work.response(db,x,user) for x in selection.query.filter(selection.active).order_by(
            selection.attention,WorkTask.due_date.asc().nullslast(),WorkTask.id.desc()).limit(5)]}


@router.get('/tasks/{task_id}/work-tasks')
def task_work(task_id: int, page: int = Query(1, ge=1), status: str | None = None,
              db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    parent = db.get(Task, task_id)
    if not parent or parent.is_deleted or not can_access_task('read', parent, user):
        raise HTTPException(404, 'Задача недоступна')
    return list_work(view='all', major_task_id=task_id, status=status, page=page, per_page=30, db=db, user=user)


@router.get('/projects/{project_id}/work-tasks')
def project_work(project_id: int, page: int = Query(1, ge=1),
                 db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not db.get(Project, project_id): raise HTTPException(404, 'Проект недоступен')
    return list_work(view='all', direct_project_id=project_id, page=page, per_page=30, db=db, user=user)


@router.get('/projects/{project_id}/major-tasks')
def project_major_tasks(project_id: int, page: int = Query(1, ge=1),
                        db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from auth import task_read_scope_clause
    if not db.get(Project, project_id): raise HTTPException(404, 'Проект недоступен')
    query = db.query(Task).filter(Task.project_id == project_id, Task.is_deleted.is_(False), task_read_scope_clause(user, Task))
    return {'total': query.count(), 'items': [{'id': x.id, 'public_id': x.public_id, 'title': x.title}
            for x in query.order_by(Task.id.desc()).offset((page-1)*30).limit(30)]}


def saved(db, row, user):
    db.commit()
    db.refresh(row)
    return work.response(db, row, user)


@router.get('/work-targets')
def search_targets(kind: Literal['work', 'major'] = 'major', q: str = '',
                   editable: bool = False, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from auth import task_read_scope_clause, get_task_action_scope
    model = WorkTask if kind == 'work' else Task
    query = db.query(model).filter(model.is_deleted.is_(False),
        work.read_scope(user) if kind == 'work' else task_read_scope_clause(user, Task))
    if editable:
        scope = get_task_action_scope(user, 'edit')
        if scope == 'none': return {'items': []}
        if scope == 'team':
            if user.team_id is None: return {'items': []}
            query = query.filter((WorkTask.execution_team_id if kind == 'work' else Task.team_id) == user.team_id)
    if q.strip():
        text = q.strip()
        pattern = '%' + text.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
        numeric = text.upper().removeprefix('WRK-').removeprefix('TASK-').replace('-', '')
        query = query.filter(or_(model.title.ilike(pattern, escape='\\'), model.id == int(numeric) if numeric.isdigit() else False))
    rows = query.order_by(model.id.desc()).limit(30).all()
    items = []
    for row in rows:
        team = db.get(Team, row.execution_team_id if kind == 'work' else row.team_id)
        items.append({'id': row.id, 'public_id': row.public_id, 'title': row.title, 'team': team.name if team else '',
                      'context': work.response(db, row, user)['context'] if kind == 'work' else None})
    return {'items': items}


@router.post('/work-tasks', status_code=201)
def create(req: WorkCreate, idempotency_key: str | None = Header(None, min_length=8, max_length=64),
           db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from idempotency import reserve_idempotency
    reservation, fresh = reserve_idempotency(db, operation='work.create', user_id=user.id,
        request_key=idempotency_key, request_data=req.model_dump(mode='json'))
    if reservation and not fresh:
        return work.response(db, work.get_work(db, reservation.resource_id, user), user)
    row = work.create(db, user, req)
    if reservation:
        reservation.resource_type = 'work'
        reservation.resource_id = row.id
        reservation.resource_version = row.version
    return saved(db, row, user)


@router.get('/work-tasks/{work_id}')
def detail(work_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = work.get_work(db, work_id, user)
    data = work.response(db, row, user)
    data['return_feedback'] = None
    if row.status == 'in_progress':
        event = db.query(WorkHistory).filter_by(work_task_id=work_id, action='transition').order_by(WorkHistory.id.desc()).first()
        if event and event.before.get('status') == 'in_acceptance' and event.after.get('status') == 'in_progress':
            data['return_feedback'] = work.history_item(db, event, user)
    return data


@router.patch('/work-tasks/{work_id}')
def update(work_id: int, req: WorkUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return saved(db, work.update(db, work.get_work(db, work_id, user), user, req), user)


@router.post('/work-tasks/{work_id}/transitions')
def transition(work_id: int, req: Transition, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = work.get_work(db, work_id, user)
    values = work.transition_values(row, user, req)
    if req.status in {'ready', 'in_progress'}: work.validate_person(db, row.assignee_id, row.execution_team_id)
    return saved(db, work.change(db, row, user, req.version, values, 'transition', req.reason), user)


@router.patch('/work-tasks/{work_id}/checklist/{item_id}')
def toggle_checklist(work_id: int, item_id: str, req: ChecklistToggle,
                     db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return saved(db, work.toggle_checklist(db, work.get_work(db, work_id, user), user, item_id, req), user)


@router.get('/work-task-templates')
def templates(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from services import work_templates
    return {'items': [work_templates.dto(row) for row in work_templates.scope(db, user).order_by(work_templates.WorkTaskTemplate.name, work_templates.WorkTaskTemplate.id)]}


@router.post('/work-task-templates', status_code=201)
def create_template(req: TemplateCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from services import work_templates
    return work_templates.create(db, user, req)


@router.put('/work-task-templates/{template_id}')
def update_template(template_id: int, req: TemplateUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from services import work_templates
    return work_templates.change(db, user, template_id, req.version, {'name': req.name, 'content': req.content.model_dump(mode='json')})


@router.post('/work-task-templates/{template_id}/archive')
def archive_template(template_id: int, req: Version, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from services import work_templates
    return work_templates.change(db, user, template_id, req.version, {'is_deleted': True})


@router.post('/work-tasks/{work_id}/placement')
def placement(work_id: int, req: Move, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = work.get_work(db, work_id, user)
    work.require(work.editor(user, row.execution_team_id))
    values = req.model_dump(exclude={'version', 'reason'})
    work.validate_context(db, user, values)
    return saved(db, work.change(db, row, user, req.version, values, 'placement', req.reason), user)


@router.post('/work-tasks/{work_id}/assignment-decisions')
def assignment(work_id: int, req: Assignment, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = work.get_work(db, work_id, user)
    work.require(work.editor(user, row.execution_team_id))
    if row.assignment_state != 'proposed' or row.status != 'new': raise HTTPException(409, 'Назначение уже рассмотрено')
    values = {'assignment_state': req.decision}
    if req.decision == 'declined':
        if not req.reason: raise HTTPException(422, 'Укажите причину отказа')
    else:
        if not req.assignee_id or not req.due_date or not row.description.strip():
            raise HTTPException(422, 'Нужны исполнитель, срок и ожидаемый результат')
        work.validate_person(db, req.assignee_id, row.execution_team_id)
        values.update(assignee_id=req.assignee_id, due_date=req.due_date, status='ready')
    return saved(db, work.change(db, row, user, req.version, values, 'assignment', req.reason), user)


@router.get('/work-tasks/{work_id}/history')
def history(work_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user),
            before: int | None = Query(None, gt=0), limit: int = Query(100, ge=1, le=200), paginated: bool = False):
    work.get_work(db, work_id, user)
    # Raw context snapshots are never disclosed: they may reference inaccessible objects.
    query = db.query(WorkHistory).filter_by(work_task_id=work_id)
    if before is not None: query = query.filter(WorkHistory.id < before)
    rows = query.order_by(WorkHistory.id.desc()).limit(limit + 1).all()
    items = [work.history_item(db, x, user) for x in rows[:limit]]
    return {'items': items, 'next_cursor': rows[limit - 1].id if len(rows) > limit else None} if paginated else items


@router.post('/work-tasks/{work_id}/reassignment')
def reassign(work_id: int, req: Reassignment, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = work.get_work(db, work_id, user)
    work.require(work.editor(user, row.execution_team_id) or (row.requester_id == user.id and work.editor(user, user.team_id)))
    if row.status in {'done', 'cancelled'}: raise HTTPException(422, 'Нельзя передать завершённую задачу')
    if not db.get(Team, req.execution_team_id): raise HTTPException(422, 'Команда не найдена')
    values = {'execution_team_id': req.execution_team_id, 'assignment_state': 'proposed', 'assignee_id': None,
              'status': 'new', 'acceptance_required': True, 'acceptor_id': row.acceptor_id or row.requester_id}
    return saved(db, work.change(db, row, user, req.version, values, 'reassignment', req.reason), user)


@router.get('/work-tasks/{work_id}/comments')
def comments(work_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user),
             before: int | None = Query(None, gt=0), limit: int = Query(100, ge=1, le=200), paginated: bool = False):
    work.get_work(db, work_id, user)
    query = db.query(WorkComment).filter_by(work_task_id=work_id)
    if before is not None: query = query.filter(WorkComment.id < before)
    rows = query.order_by(WorkComment.id.desc()).limit(limit + 1).all()
    items = list(reversed(rows[:limit]))
    return {'items': items, 'next_cursor': rows[limit - 1].id if len(rows) > limit else None} if paginated else items


@router.post('/work-tasks/{work_id}/comments')
def comment(work_id: int, req: Comment, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = work.get_work(db, work_id, user)
    work.require(work.participant(row, user))
    work.change(db, row, user, req.version, {}, 'comment')
    db.add(WorkComment(work_task_id=work_id, author_id=user.id, body=req.body))
    return saved(db, row, user)
