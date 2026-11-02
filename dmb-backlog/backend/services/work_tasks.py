"""Work policy and transactional commands. Never writes Task or reference data."""
from datetime import datetime, timezone
from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from sqlalchemy import or_, false, true
from auth import can_access_task, get_task_action_scope, is_customer_portal_only, check_permission
from models import WorkTask, WorkHistory, EventOutbox, Task, Project, User, Team


def editor(user, team_id):
    scope = get_task_action_scope(user, "edit")
    return not is_customer_portal_only(user) and (scope == "all" or (
        scope == "team" and user.team_id is not None and user.team_id == team_id))


def read_scope(user):
    if is_customer_portal_only(user):
        return false()
    if check_permission(user, "backlog_dmb", "read"):
        return true()
    return or_(WorkTask.requester_id == user.id, WorkTask.assignee_id == user.id,
               WorkTask.acceptor_id == user.id,
               WorkTask.execution_team_id == user.team_id if user.team_id else false())


def get_work(db, work_id, user):
    row = db.query(WorkTask).filter(WorkTask.id == work_id, WorkTask.is_deleted.is_(False), read_scope(user)).first()
    if not row:
        raise HTTPException(404, "Рабочая задача недоступна")
    return row


def require(allowed):
    if not allowed:
        raise HTTPException(403, "Действие недоступно")


def participant(row, user):
    return user.id in (row.requester_id, row.assignee_id, row.acceptor_id) or editor(user, row.execution_team_id)


def validate_person(db, user_id, team_id=None):
    if user_id is None:
        return
    person = db.get(User, user_id)
    if not person or not person.is_active or is_customer_portal_only(person) or (team_id is not None and person.team_id != team_id):
        raise HTTPException(422, "Выберите активного внутреннего пользователя команды")


def validate_context(db, user, values):
    if values.get("major_task_id"):
        task = db.get(Task, values["major_task_id"])
        if not task or task.is_deleted or not can_access_task("read", task, user) or not can_access_task("edit", task, user):
            raise HTTPException(404, "Контекст недоступен для размещения")
    if values.get("direct_project_id") and not db.get(Project, values["direct_project_id"]):
        raise HTTPException(404, "Проект недоступен")


def state(row):
    return jsonable_encoder({column.name: getattr(row, column.name) for column in WorkTask.__table__.columns})


WORK_ACTION_TYPES = ("work.acceptance.required", "work.assignment.required", "work.execution.required", "work.rework.required", "work.reassignment.required")


def notification_intent(row, recipient, action, before):
    if row.status not in {"done", "cancelled"}:
        if row.assignment_state == "proposed" and editor(recipient, row.execution_team_id):
            return "work.assignment.required", "Принять назначение команды"
        if row.assignment_state == "declined" and recipient.id == row.requester_id:
            return "work.reassignment.required", "Уточнить поручение после отказа команды"
        if row.status == "in_acceptance" and recipient.id == row.acceptor_id:
            return "work.acceptance.required", "Принять результат"
        if row.status == "ready" and recipient.id == row.assignee_id:
            return "work.execution.required", "Начать работу"
        if row.status == "in_progress" and before.get("status") == "in_acceptance" and recipient.id == row.assignee_id:
            return "work.rework.required", "Доработать результат"
    label = {"created": "Создана задача", "comment": "Добавлен комментарий", "attachment": "Добавлен файл",
             "placement": "Изменено размещение", "reassignment": "Предложено другой команде"}.get(action, "Изменена задача")
    if action == "transition":
        label = {"done": "Результат принят" if before.get("status") == "in_acceptance" else "Задача выполнена",
                 "cancelled": "Задача отменена", "in_acceptance": "Результат передан на приёмку",
                 "in_progress": "Возвращено на доработку" if before.get("status") == "in_acceptance" else "Работа начата",
                 "ready": "Задача переоткрыта" if before.get("status") == "done" else "Передано исполнителю"}.get(row.status, label)
    elif action == "assignment":
        label = "Команда приняла поручение" if row.assignment_state == "accepted" else "Команда отклонила поручение"
    return "work.changed", label


def notify_work(db, row, actor, action="updated", before=None, reason=""):
    from models import Notification
    from event_outbox import enqueue_user_event
    before = before or {}
    pending = db.query(Notification).filter(Notification.work_task_id == row.id,
        Notification.type.in_(WORK_ACTION_TYPES), Notification.is_resolved.is_(False)).all()
    for item in pending:
        recipient = db.get(User, item.user_id)
        still_required = recipient and (
            (item.type == "work.rework.required" and row.status == "in_progress" and row.assignee_id == recipient.id)
            or notification_intent(row, recipient, action, before)[0] == item.type)
        if not still_required:
            item.is_resolved = True
            item.resolved_at = datetime.now(timezone.utc)
            enqueue_user_event(db, user_id=item.user_id, event_type="notification.resolved",
                               payload={"target": {"kind": "work", "id": row.id}})
    recipients = {row.requester_id, row.assignee_id, row.acceptor_id} - {None, actor.id}
    candidates = db.query(User).filter(User.is_active.is_(True), or_(User.id.in_(recipients),
        User.team_id == row.execution_team_id if row.assignment_state == "proposed" else false()))
    for recipient in candidates:
        if recipient.id == actor.id or (recipient.id not in recipients and not editor(recipient, row.execution_team_id)):
            continue
        try:
            get_work(db, row.id, recipient)
        except HTTPException:
            continue
        event_type, label = notification_intent(row, recipient, action, before)
        if event_type in WORK_ACTION_TYPES and any(n.user_id == recipient.id and n.type == event_type and not n.is_resolved for n in pending):
            continue
        body = row.title + (f"\n{reason}" if reason else "")
        db.add(Notification(user_id=recipient.id, work_task_id=row.id, type=event_type, category="work",
            title=f"{row.public_id}: {label}", body=body, message=body[:500],
            action_url=f"#/work-tasks/{row.id}", importance="high" if event_type in WORK_ACTION_TYPES else "medium",
            group_key=f"work:{row.id}:v{row.version}:{recipient.id}"))
        enqueue_user_event(db, user_id=recipient.id, event_type="notification.created",
                           payload={"target": {"kind": "work", "id": row.id}})


def record(db, row, user, action, before, reason=""):
    db.add(WorkHistory(work_task_id=row.id, actor_id=user.id, action=action, version=row.version,
                       before=before, after=state(row), reason=reason))
    notify_work(db, row, user, action, before, reason)
    if action != 'created':
        from services.request_followup import work_changed
        work_changed(db, row, user, before)
    db.add(EventOutbox(event_type="work.changed", aggregate_type="work", aggregate_id=row.id,
                       aggregate_version=row.version, payload={"target": {"kind": "work", "id": row.id}}))


def change(db, row, user, version, values, action, reason=""):
    before = state(row)
    count = db.query(WorkTask).filter_by(id=row.id, version=version, is_deleted=False).update(
        {**values, "version": version + 1, "updated_at": datetime.now(timezone.utc)}, synchronize_session=False)
    if count != 1:
        db.rollback()
        db.refresh(row)
        raise HTTPException(409, {"message": "Задача изменена. Обновите данные, сохранив черновик.", "version": row.version})
    db.refresh(row)
    record(db, row, user, action, before, reason)
    return row


def create(db, user, req):
    require(editor(user, user.team_id))
    values = req.model_dump()
    validate_context(db, user, values)
    if not db.get(Team, req.execution_team_id):
        raise HTTPException(422, "Команда не найдена")
    cross_team = req.execution_team_id != user.team_id
    if cross_team and req.assignee_id:
        raise HTTPException(422, "Исполнителя назначает принимающая команда")
    validate_person(db, req.assignee_id, req.execution_team_id)
    validate_person(db, req.acceptor_id)
    values["acceptance_required"] = cross_team or req.acceptance_required
    if values["acceptance_required"] and not req.acceptor_id:
        values["acceptor_id"] = user.id
    row = WorkTask(**values, requester_id=user.id, requester_team_id=user.team_id, created_by=user.id,
                   status="new", assignment_state="proposed" if cross_team else "accepted", version=1,
                   result_text="", is_deleted=False)
    db.add(row)
    db.flush()
    record(db, row, user, "created", {})
    return row


def update(db, row, user, req):
    values = req.model_dump(exclude_unset=True, exclude={"version"})
    reason = values.pop('reason', '')
    execution = editor(user, row.execution_team_id)
    require(execution or (row.requester_id == user.id and row.status == "new") or (
        row.assignee_id == user.id and set(values) <= {"blocked_reason"}))
    if row.status in {"done", "cancelled"}:
        raise HTTPException(422, "Сначала переоткройте задачу")
    changed_terms = any(key in values and values[key] != getattr(row, key) for key in ('description', 'acceptor_id'))
    if changed_terms and row.status in {'in_progress', 'in_acceptance'}:
        if not reason:
            raise HTTPException(422, 'Укажите причину изменения условий или приёмщика')
        # A result submitted against old expectations must be presented again.
        if row.status == 'in_acceptance': values['status'] = 'in_progress'
        values['result_revision'] = (getattr(row, 'result_revision', None) or 1) + 1
    if "assignee_id" in values:
        require(execution)
        if row.assignment_state != "accepted":
            raise HTTPException(422, "Сначала примите назначение")
        validate_person(db, values["assignee_id"], row.execution_team_id)
    if "acceptor_id" in values:
        validate_person(db, values["acceptor_id"])
        if row.acceptance_required and not values["acceptor_id"]:
            raise HTTPException(422, "Укажите приёмщика")
    if row.status != "new":
        for field in ("description", "assignee_id", "due_date"):
            if field in values and not values[field]:
                raise HTTPException(422, "Обязательны описание, исполнитель и срок")
    return change(db, row, user, req.version, values, "updated", reason)


def toggle_checklist(db, row, user, item_id, req):
    require(editor(user, row.execution_team_id) or row.assignee_id == user.id or (
        row.requester_id == user.id and row.status == 'new'))
    if row.status in {'done', 'cancelled'}:
        raise HTTPException(422, 'Сначала переоткройте задачу')
    items = [dict(item) for item in (row.checklist or [])]
    item = next((item for item in items if item['id'] == item_id), None)
    if item is None:
        raise HTTPException(404, 'Пункт чек-листа не найден')
    item['completed'] = req.completed
    return change(db, row, user, req.version, {'checklist': items}, 'checklist')


TRANSITIONS = {"new": ("ready", "cancelled"), "ready": ("in_progress", "cancelled"),
               "in_progress": ("in_acceptance", "done", "cancelled"),
               "in_acceptance": ("done", "in_progress", "cancelled"), "done": ("ready",), "cancelled": ("new",)}


def transition_values(row, user, req):
    execution = editor(user, row.execution_team_id)
    actor = execution or row.assignee_id == user.id
    target, source = req.status, row.status
    if target not in TRANSITIONS.get(source, ()):
        raise HTTPException(422, "Недопустимый переход")
    values = {"status": target}
    needs_reason = target == "cancelled" or source in {"done", "cancelled"} or (source == "in_acceptance" and target == "in_progress")
    if needs_reason and not req.reason:
        raise HTTPException(422, "Укажите причину")
    if target == "cancelled":
        require(execution or (source in {"new", "ready"} and row.requester_id == user.id))
    elif source == "cancelled":
        require(execution)
        # Restore into triage: old assignments and readiness must be reviewed.
        values.update(completed_at=None, assignment_state="proposed")
        values["result_revision"] = (getattr(row, "result_revision", None) or 1) + 1
    elif source == "done":
        require(execution or row.acceptor_id == user.id)
        values["completed_at"] = None
        # Reopening revokes the previously confirmed result even if its text is reused.
        values["result_revision"] = (getattr(row, "result_revision", None) or 1) + 1
    elif source == "in_acceptance":
        require(row.acceptor_id == user.id)
    elif target == "ready":
        require(execution)
    else:
        require(actor)
    if target in {"ready", "in_progress", "in_acceptance", "done"}:
        if row.assignment_state != "accepted" or not row.assignee_id or not row.due_date or not row.description.strip():
            raise HTTPException(422, "Нужны принятое назначение, исполнитель, срок и ожидаемый результат")
    if target == "in_acceptance" and (not row.acceptance_required or not row.acceptor_id):
        raise HTTPException(422, "Приёмка не настроена")
    if target == "done" and source != "in_acceptance" and row.acceptance_required:
        raise HTTPException(422, "Требуется приёмка результата")
    if target in {"in_acceptance", "done"}:
        if source == "in_acceptance" and req.result_text and req.result_text != row.result_text:
            raise HTTPException(422, "Приёмка не изменяет результат. Верните задачу исполнителю с замечаниями")
        result = row.result_text if source == "in_acceptance" else req.result_text
        if not result.strip():
            raise HTTPException(422, "Укажите фактический результат")
        values["result_text"] = result
        if result != row.result_text:
            values["result_revision"] = (getattr(row, "result_revision", None) or 1) + 1
    if target == "done":
        values["completed_at"] = datetime.now(timezone.utc)
    return values


def available_actions(row, user):
    from work_contract import Transition
    actions = []
    for target in ("new", "ready", "in_progress", "in_acceptance", "done", "cancelled"):
        try:
            transition_values(row, user, Transition(version=row.version, status=target, reason="reason", result_text=row.result_text if row.status == "in_acceptance" else "result"))
            actions.append(target)
        except HTTPException:
            pass
    return actions


def response(db, row, user):
    from services.work_presentation import next_step, readiness
    data = state(row)
    data["public_id"] = row.public_id
    data["effective_project_id"] = row.direct_project_id
    data["context"] = None
    if row.major_task_id:
        parent = db.get(Task, row.major_task_id)
        if parent and not parent.is_deleted and can_access_task("read", parent, user):
            data["effective_project_id"] = parent.project_id
            data["context"] = {"kind": "major", "id": parent.id, "title": parent.title}
        else:
            data["major_task_id"] = None
            data["context"] = {"kind": "unavailable", "title": "Контекст недоступен"}
    elif row.direct_project_id:
        project = db.get(Project, row.direct_project_id)
        data["context"] = {"kind": "project", "id": project.id, "title": project.name} if project else None
    data["available_actions"] = available_actions(row, user)
    data["can_edit"] = editor(user, row.execution_team_id) or (row.requester_id == user.id and row.status == "new")
    data["can_collaborate"] = participant(row, user)
    data["can_block"] = row.status not in {"done", "cancelled"} and (data["can_edit"] or row.assignee_id == user.id)
    data['can_check'] = data['can_block']
    data['priority'] = row.priority or 'normal'
    data['checklist'] = row.checklist or []
    data['checklist_progress'] = {'done': sum(bool(x['completed']) for x in data['checklist']), 'total': len(data['checklist'])}
    data["can_decide_assignment"] = row.status == "new" and row.assignment_state == "proposed" and editor(user, row.execution_team_id)
    data["can_place"] = editor(user, row.execution_team_id)
    data["can_reassign"] = row.status not in {"done", "cancelled"} and (editor(user, row.execution_team_id) or (
        row.requester_id == user.id and editor(user, user.team_id)))
    person = db.get(User, row.assignee_id) if row.assignee_id else None
    data["assignee_name"] = person.name if person else None
    acceptor = db.get(User, row.acceptor_id) if row.acceptor_id else None
    data['acceptor_name'] = acceptor.name if acceptor else None
    data['readiness'] = readiness(row)
    data['next_step'] = next_step(row, data, {row.assignee_id: data['assignee_name'], row.acceptor_id: data['acceptor_name']})
    return data


def history_item(db, item, user):
    """Allowlisted changes: do not expose inaccessible context snapshots."""
    labels = {"title": "Название", "description": "Ожидаемый результат", "status": "Статус",
              "due_date": "Срок", "assignee_id": "Исполнитель", "acceptor_id": "Приёмщик",
              "execution_team_id": "Команда", "blocked_reason": "Препятствие", "assignment_state": "Назначение",
              "result_text": "Фактический результат", "priority": "Приоритет", "checklist": "Чек-лист"}
    actor = db.get(User, item.actor_id) if item.actor_id else None
    def display(key, value):
        if value is None or value == "": return "Не указано"
        if key == 'priority':
            return {'low': 'Низкий', 'normal': 'Обычный', 'high': 'Высокий', 'urgent': 'Срочный'}.get(value, value)
        if key == 'checklist':
            return '; '.join(('Выполнено: ' if x['completed'] else 'Не выполнено: ') + x['title'] for x in value) or 'Нет пунктов'
        if key in {"assignee_id", "acceptor_id", "execution_team_id"}:
            obj = db.get(Team if key == "execution_team_id" else User, value)
            return obj.name if obj else "Участник недоступен"
        return str(value)
    changes = [{"field": key, "label": label, "before": display(key, item.before.get(key)),
                "after": display(key, item.after.get(key))}
               for key, label in labels.items() if item.before.get(key) != item.after.get(key)]
    if item.action == "placement":
        def context(snapshot):
            if snapshot.get("major_task_id"):
                target = db.get(Task, snapshot["major_task_id"])
                return target.title if target and not target.is_deleted and can_access_task("read", target, user) else "Контекст недоступен"
            target = db.get(Project, snapshot["direct_project_id"]) if snapshot.get("direct_project_id") else None
            return target.name if target else "Самостоятельная задача"
        changes.append({"field": "context", "label": "Размещение", "before": context(item.before), "after": context(item.after)})
    return {"id": item.id, "action": item.action, "version": item.version, "reason": item.reason,
            "created_at": item.created_at, "actor_name": actor.name if actor else "Участник",
            "changes": changes, "previous_result": item.before.get("result_text"), "result": item.after.get("result_text")}

