"""
DMB Backlog - Admin Router (CRUD for roles, teams, users, dictionaries)
"""
import json
import logging
import re
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import case as sql_case, desc, or_, func
from typing import List, Optional
from datetime import datetime, timezone, timedelta


logger = logging.getLogger("dmb_backlog.admin")

from database import get_db
from models import Role, Team, User, Task, DictionaryItem, DisplaySetting, ColumnLabel, FieldLabel, Project, BusinessCustomer, Department, AuditLog, CompetencyCostHistory, Tag, IssueTag, ProjectTag, RefreshSession, Report, NotificationTemplate
from schemas import (
    RoleCreate, RoleUpdate, RoleResponse,
    TeamCreate, TeamUpdate, TeamResponse,
    UserCreate, UserUpdate, UserResponse,
    DictionaryItemCreate, DictionaryItemUpdate, DictionaryItemResponse,
    DictionaryBatchUpdate,
    DictLockResponse,
    CompetencyCostHistoryCreate, CompetencyCostHistoryUpdate, CompetencyCostHistoryResponse,
    CompetencyCostBatchUpdate,
    DisplaySettingUpdate, DisplaySettingResponse,
    ColumnLabelUpdate, ColumnLabelResponse,
    ProjectCreate, ProjectUpdate, ProjectResponse,
    BusinessCustomerCreate, BusinessCustomerUpdate, BusinessCustomerResponse,
    TagCreate, TagResponse,
    NotificationTemplateCreate, NotificationTemplateUpdate, NotificationTemplateResponse,
)
from auth import get_current_user, require_permission, get_password_hash
from routers.tasks_router import recalculate_effort_rub_for_all

router = APIRouter(tags=["admin"])

NOTIFICATION_TEMPLATE_VARIABLES = {
    "task_id", "title", "status", "deadline", "owner", "team", "project", "days_left",
}


def _notification_template_payload(template: NotificationTemplate) -> dict:
    try:
        recipients = json.loads(template.recipients or "[]")
    except (TypeError, ValueError):
        recipients = []
    return {
        "id": template.id, "name": template.name, "event_type": template.event_type,
        "text": template.text, "recipients": recipients,
        "deadline_days": template.deadline_days, "repeat_frequency": template.repeat_frequency,
        "repeat_day": template.repeat_day, "is_active": bool(template.is_active),
        "created_at": template.created_at, "updated_at": template.updated_at,
    }


def _validate_notification_template_policy(values: dict) -> None:
    variables = set(re.findall(r"\{([a-z_][a-z0-9_]*)\}", values.get("text") or ""))
    unknown = sorted(variables - NOTIFICATION_TEMPLATE_VARIABLES)
    if unknown:
        raise HTTPException(status_code=422, detail=[{
            "loc": ["body", "text"], "msg": f"Недопустимые переменные: {', '.join(unknown)}", "type": "value_error.template_variable",
        }])
    frequency = values.get("repeat_frequency")
    repeat_day = values.get("repeat_day")
    if frequency == "daily" and repeat_day is not None:
        raise HTTPException(status_code=422, detail=[{
            "loc": ["body", "repeat_day"], "msg": "Для ежедневного повтора день не указывается", "type": "value_error.repeat_day",
        }])
    if frequency == "weekly" and repeat_day is not None and repeat_day > 7:
        raise HTTPException(status_code=422, detail=[{
            "loc": ["body", "repeat_day"], "msg": "Для еженедельного повтора укажите день от 1 до 7", "type": "value_error.repeat_day",
        }])


@router.get("/notification-templates", response_model=List[NotificationTemplateResponse])
def get_notification_templates(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "read")),
):
    return [_notification_template_payload(item) for item in db.query(NotificationTemplate).order_by(NotificationTemplate.name).all()]


@router.post("/notification-templates", response_model=NotificationTemplateResponse, status_code=status.HTTP_201_CREATED)
def create_notification_template(
    data: NotificationTemplateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial")),
):
    values = data.model_dump()
    _validate_notification_template_policy(values)
    if db.query(NotificationTemplate).filter(func.lower(NotificationTemplate.name) == values["name"].strip().lower()).first():
        raise HTTPException(status_code=400, detail="Шаблон с таким названием уже существует")
    values["name"] = values["name"].strip()
    values["text"] = values["text"].strip()
    values["recipients"] = json.dumps(values["recipients"], ensure_ascii=False)
    template = NotificationTemplate(**values)
    db.add(template)
    db.commit()
    db.refresh(template)
    return _notification_template_payload(template)


@router.put("/notification-templates/{template_id}", response_model=NotificationTemplateResponse)
def update_notification_template(
    template_id: int,
    data: NotificationTemplateUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial")),
):
    template = db.query(NotificationTemplate).filter(NotificationTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Шаблон уведомления не найден")
    update = data.model_dump(exclude_unset=True)
    merged = _notification_template_payload(template)
    merged.update(update)
    _validate_notification_template_policy(merged)
    if "name" in update:
        duplicate = db.query(NotificationTemplate).filter(
            func.lower(NotificationTemplate.name) == update["name"].strip().lower(), NotificationTemplate.id != template_id,
        ).first()
        if duplicate:
            raise HTTPException(status_code=400, detail="Шаблон с таким названием уже существует")
        update["name"] = update["name"].strip()
    if "text" in update:
        update["text"] = update["text"].strip()
    if "recipients" in update:
        update["recipients"] = json.dumps(update["recipients"], ensure_ascii=False)
    for field, value in update.items():
        setattr(template, field, value)
    db.commit()
    db.refresh(template)
    return _notification_template_payload(template)


@router.delete("/notification-templates/{template_id}")
def delete_notification_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial")),
):
    template = db.query(NotificationTemplate).filter(NotificationTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Шаблон уведомления не найден")
    db.delete(template)
    db.commit()
    return {"message": "Notification template deleted"}


def _validate_role_policy(values: dict) -> None:
    """Reject combinations that cannot produce a safe, coherent interface."""
    errors = []
    portal_only = bool(values.get("customer_portal_only"))
    if portal_only and values.get("customer_access", "none") == "none":
        errors.append({"loc": ["body", "customer_access"], "msg": "Для режима бизнес-заказчика разрешите доступ к порталу", "type": "value_error.role_policy"})
    incompatible = {
        "admin_access": ("none", "В режиме бизнес-заказчика административный доступ должен быть запрещён"),
        "review_access": ("none", "В режиме бизнес-заказчика ревью запросов должно быть запрещено"),
        "task_edit_scope": ("none", "В режиме бизнес-заказчика редактирование задач должно быть запрещено"),
        "task_comment_scope": ("none", "В режиме бизнес-заказчика комментирование задач должно быть запрещено"),
        "task_delete_scope": ("none", "В режиме бизнес-заказчика удаление задач должно быть запрещено"),
        "pip_decision_access": (False, "В режиме бизнес-заказчика PIP-решения должны быть запрещены"),
    }
    if portal_only:
        for field, (expected, message) in incompatible.items():
            if values.get(field, expected) != expected:
                errors.append({"loc": ["body", field], "msg": message, "type": "value_error.role_policy"})
    scope_rank = {"none": 0, "team": 1, "all": 2}
    if scope_rank.get(values.get("task_delete_scope") or "none", 0) > scope_rank.get(values.get("task_edit_scope") or "none", 0):
        errors.append({"loc": ["body", "task_delete_scope"], "msg": "Область удаления не может быть шире области редактирования", "type": "value_error.role_policy"})
    if values.get("pip_decision_access") and values.get("reports_access", "none") == "none":
        errors.append({"loc": ["body", "pip_decision_access"], "msg": "Для PIP-решений нужен доступ к разделу статусов для встреч", "type": "value_error.role_policy"})
    if errors:
        raise HTTPException(status_code=422, detail=errors)


def _active_full_admin_count(db: Session, exclude_user_id: Optional[int] = None) -> int:
    query = db.query(User).join(Role).filter(User.is_active == True, Role.admin_access == "full")
    if exclude_user_id is not None:
        query = query.filter(User.id != exclude_user_id)
    return query.count()


def _protect_admin_identity_change(db: Session, actor: User, target: User, *, next_active=None, next_role_id=None) -> None:
    """Prevent self-deactivation and removal of the last active full admin."""
    if next_active is False and actor.id == target.id:
        raise HTTPException(status_code=400, detail="Нельзя деактивировать собственную учётную запись")
    current_is_full = bool(target.role and target.role.admin_access == "full" and target.is_active)
    next_role = target.role if next_role_id is None else db.query(Role).filter(Role.id == next_role_id).first()
    will_be_active = target.is_active if next_active is None else next_active
    will_be_full = bool(next_role and next_role.admin_access == "full" and will_be_active)
    if current_is_full and not will_be_full and _active_full_admin_count(db, target.id) == 0:
        raise HTTPException(status_code=400, detail="В системе должен остаться хотя бы один активный полный администратор")


# ==================== AUDIT LOG ====================

@router.get("/audit-log")
def get_audit_log(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    user_id: Optional[int] = Query(None),
    action: Optional[str] = Query(None),
    entity_type: Optional[str] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    search: Optional[str] = Query(None, max_length=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "full"))
):
    query = db.query(AuditLog).outerjoin(User, AuditLog.user_id == User.id)

    if user_id is not None:
        query = query.filter(AuditLog.user_id == user_id)
    if action:
        query = query.filter(AuditLog.action == action)
    if entity_type:
        query = query.filter(AuditLog.entity_type == entity_type)
    if date_from:
        query = query.filter(AuditLog.created_at >= date_from)
    if date_to:
        from datetime import datetime, timedelta
        query = query.filter(AuditLog.created_at < datetime.combine(date_to, datetime.max.time()))
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        query = query.filter(or_(User.name.ilike(pattern), AuditLog.action.ilike(pattern), AuditLog.entity_type.ilike(pattern), AuditLog.details.ilike(pattern), AuditLog.ip_address.ilike(pattern)))

    total = query.count()
    items = query.order_by(desc(AuditLog.created_at)).offset((page - 1) * per_page).limit(per_page).all()

    user_ids = list({item.user_id for item in items if item.user_id})
    users_map = {}
    if user_ids:
        users = db.query(User).filter(User.id.in_(user_ids)).all()
        users_map = {u.id: u.name for u in users}

    result = []
    for item in items:
        result.append({
            "id": item.id,
            "user_id": item.user_id,
            "user_name": users_map.get(item.user_id) if item.user_id else None,
            "action": item.action,
            "entity_type": item.entity_type,
            "entity_id": item.entity_id,
            "details": item.details,
            "ip_address": item.ip_address,
            "created_at": item.created_at.isoformat() if item.created_at else None,
        })

    return {
        "items": result,
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page,
    }


# ==================== AUDIT LOG FILTER VALUES ====================

@router.get("/audit-log/filters")
def get_audit_log_filters(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "full"))
):
    actions = db.query(AuditLog.action).distinct().all()
    entity_types = db.query(AuditLog.entity_type).distinct().all()
    users = db.query(User.id, User.name).distinct().join(
        AuditLog, AuditLog.user_id == User.id
    ).all()

    return {
        "actions": [a[0] for a in actions if a[0]],
        "entity_types": [e[0] for e in entity_types if e[0]],
        "users": [{"id": u[0], "name": u[1]} for u in users],
    }


def _resolve_team_names(team, db: Session) -> dict:
    """Resolve pl/po/cl/it_pl display names from FK user references."""
    pl_name = team.pl
    po_name = team.po
    cl_name = team.cl
    it_pl_name = team.it_pl
    if team.pl_id:
        u = db.query(User).filter(User.id == team.pl_id).first()
        if u:
            pl_name = u.name
    if team.po_id:
        u = db.query(User).filter(User.id == team.po_id).first()
        if u:
            po_name = u.name
    if team.cl_id:
        u = db.query(User).filter(User.id == team.cl_id).first()
        if u:
            cl_name = u.name
    if team.it_pl_id:
        u = db.query(User).filter(User.id == team.it_pl_id).first()
        if u:
            it_pl_name = u.name
    return {"pl": pl_name, "po": po_name, "cl": cl_name, "it_pl": it_pl_name}


# ==================== ROLES CRUD ====================

@router.get("/roles", response_model=List[RoleResponse])
def get_roles(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "read"))
):
    roles = db.query(Role).all()
    return roles


@router.get("/deletion-impact/{entity_type}/{entity_id}")
def get_deletion_impact(
    entity_type: str,
    entity_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "read")),
):
    """Read-only dependency preview used before destructive admin actions."""
    dependencies = []
    recommendations = []
    action = "delete"

    def dependency(key: str, label: str, count: int, blocking: bool = True):
        dependencies.append({"key": key, "label": label, "count": int(count or 0), "blocking": blocking})

    if entity_type == "team":
        target = db.query(Team).filter(Team.id == entity_id).first()
        if not target:
            raise HTTPException(status_code=404, detail="Team not found")
        dependency("users", "Пользователи команды", db.query(User).filter(User.team_id == entity_id).count())
        dependency("tasks", "Задачи команды", db.query(Task).filter(Task.team_id == entity_id).count())
        recommendations.append("Переназначьте пользователей и задачи в другую команду.")
    elif entity_type == "role":
        target = db.query(Role).filter(Role.id == entity_id).first()
        if not target:
            raise HTTPException(status_code=404, detail="Role not found")
        dependency("users", "Пользователи с этой ролью", db.query(User).filter(User.role_id == entity_id).count())
        recommendations.append("Назначьте пользователям другую роль.")
    elif entity_type == "project":
        target = db.query(Project).filter(Project.id == entity_id).first()
        if not target:
            raise HTTPException(status_code=404, detail="Project not found")
        dependency("tasks", "Задачи проекта", db.query(Task).filter(Task.project_id == entity_id).count())
        recommendations.append("Перенесите задачи в другой проект или снимите привязку к проекту.")
    elif entity_type == "bc":
        target = db.query(BusinessCustomer).filter(BusinessCustomer.id == entity_id).first()
        if not target:
            raise HTTPException(status_code=404, detail="Business customer not found")
        dependency("tasks", "Задачи заказчика", db.query(Task).filter(Task.business_customer_id == entity_id).count())
        dependency("users", "Пользователи заказчика", db.query(User).filter(User.business_customer_id == entity_id).count())
        recommendations.append("Переназначьте связанные задачи и пользователей другому заказчику.")
    elif entity_type == "user":
        target = db.query(User).filter(User.id == entity_id).first()
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        action = "deactivate"
        dependency("owned_tasks", "Задачи во владении", db.query(Task).filter(Task.owner_id == entity_id).count(), False)
        dependency("created_tasks", "Созданные задачи", db.query(Task).filter(Task.created_by == entity_id).count(), False)
        dependency("projects", "Проекты под ответственностью", db.query(Project).filter(Project.responsible_pl == entity_id).count(), False)
        dependency("reports", "Созданные отчёты", db.query(Report).filter(Report.created_by == entity_id).count(), False)
        lead_count = db.query(Team).filter(or_(Team.pl_id == entity_id, Team.po_id == entity_id, Team.cl_id == entity_id, Team.it_pl_id == entity_id)).count()
        dependency("team_leadership", "Команды, где пользователь руководитель", lead_count, False)
        recommendations.append("Деактивация сохранит историю и связи. При необходимости заранее назначьте новых владельцев и руководителей.")
        blocked_reason = None
        try:
            _protect_admin_identity_change(db, current_user, target, next_active=False)
        except HTTPException as error:
            blocked_reason = str(error.detail)
    else:
        raise HTTPException(status_code=400, detail="Unsupported entity type")

    blocking_count = sum(item["count"] for item in dependencies if item["blocking"])
    blocked_reason = locals().get("blocked_reason")
    if blocking_count:
        blocked_reason = "Сущность используется и не может быть удалена, пока существуют обязательные связи."
    return {
        "entity_type": entity_type,
        "entity_id": entity_id,
        "name": target.name,
        "action": action,
        "can_proceed": not blocked_reason,
        "blocked_reason": blocked_reason,
        "dependencies": dependencies,
        "recommendations": recommendations,
    }


@router.get("/roles/{role_id}", response_model=RoleResponse)
def get_role(
    role_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "read"))
):
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    return role


@router.post("/roles", response_model=RoleResponse, status_code=status.HTTP_201_CREATED)
def create_role(
    role_data: RoleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "full"))
):
    values = role_data.model_dump()
    _validate_role_policy(values)
    existing = db.query(Role).filter(Role.name == role_data.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Role name already exists")
    role = Role(**values)
    db.add(role)
    db.commit()
    db.refresh(role)
    return role


@router.put("/roles/{role_id}", response_model=RoleResponse)
def update_role(
    role_id: int,
    role_data: RoleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "full"))
):
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")

    update = role_data.model_dump(exclude_unset=True)
    merged = {column.name: getattr(role, column.name) for column in Role.__table__.columns}
    merged.update(update)
    _validate_role_policy(merged)
    if current_user.role_id == role_id and update.get("admin_access") == "none":
        raise HTTPException(status_code=400, detail="Cannot revoke your own admin access")
    if role.admin_access == "full" and update.get("admin_access") not in (None, "full"):
        other_admins = db.query(User).join(Role).filter(
            User.is_active == True, Role.admin_access == "full", User.role_id != role_id
        ).count()
        users_on_role = db.query(User).filter(User.is_active == True, User.role_id == role_id).count()
        if users_on_role and other_admins == 0:
            raise HTTPException(status_code=400, detail="Нельзя понизить роль последнего активного полного администратора")

    for field, value in update.items():
        setattr(role, field, value)
    db.commit()
    db.refresh(role)
    return role


@router.delete("/roles/{role_id}")
def delete_role(
    role_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "full"))
):
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    users_with_role = db.query(User).filter(User.role_id == role_id).count()
    if users_with_role > 0:
        raise HTTPException(status_code=400, detail="Cannot delete role assigned to users")
    db.delete(role)
    db.commit()
    return {"message": "Role deleted"}


# ==================== TEAMS CRUD ====================

@router.get("/teams", response_model=List[TeamResponse])
def admin_get_teams(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "read"))
):
    teams = db.query(Team).all()
    result = []
    for team in teams:
        members = team.members.split(",") if team.members else []
        names = _resolve_team_names(team, db)
        result.append(TeamResponse(
            id=team.id, name=team.name, team_type_id=team.team_type_id, abbr=team.abbr, color=team.color,
            domain=team.domain, description=team.description,
            pl=names["pl"], po=names["po"], cl=names["cl"], it_pl=names["it_pl"],
            pl_id=team.pl_id, po_id=team.po_id, cl_id=team.cl_id, it_pl_id=team.it_pl_id,
            members=team.members, created_at=team.created_at,
            member_count=len([m for m in members if m.strip()]) if members else 0
        ))
    return result


@router.post("/teams", response_model=TeamResponse, status_code=status.HTTP_201_CREATED)
def admin_create_team(
    team_data: TeamCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    team = Team(**team_data.model_dump())
    db.add(team)
    db.commit()
    db.refresh(team)
    members = team.members.split(",") if team.members else []
    names = _resolve_team_names(team, db)
    return TeamResponse(
        id=team.id, name=team.name, team_type_id=team.team_type_id, abbr=team.abbr, color=team.color,
        domain=team.domain, description=team.description,
        pl=names["pl"], po=names["po"], cl=names["cl"], it_pl=names["it_pl"],
        pl_id=team.pl_id, po_id=team.po_id, cl_id=team.cl_id, it_pl_id=team.it_pl_id,
        members=team.members, created_at=team.created_at,
        member_count=len([m for m in members if m.strip()]) if members else 0
    )


@router.put("/teams/{team_id}", response_model=TeamResponse)
def admin_update_team(
    team_id: int,
    team_data: TeamCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    for field, value in team_data.model_dump(exclude_unset=True).items():
        setattr(team, field, value)
    db.commit()
    db.refresh(team)
    members = team.members.split(",") if team.members else []
    names = _resolve_team_names(team, db)
    return TeamResponse(
        id=team.id, name=team.name, team_type_id=team.team_type_id, abbr=team.abbr, color=team.color,
        domain=team.domain, description=team.description,
        pl=names["pl"], po=names["po"], cl=names["cl"], it_pl=names["it_pl"],
        pl_id=team.pl_id, po_id=team.po_id, cl_id=team.cl_id, it_pl_id=team.it_pl_id,
        members=team.members, created_at=team.created_at,
        member_count=len([m for m in members if m.strip()]) if members else 0
    )


@router.delete("/teams/{team_id}")
def admin_delete_team(
    team_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    users_count = db.query(User).filter(User.team_id == team_id).count()
    if users_count > 0:
        raise HTTPException(status_code=400, detail=f"Cannot delete team with {users_count} existing users")
    tasks_count = db.query(Task).filter(Task.team_id == team_id).count()
    if tasks_count > 0:
        raise HTTPException(status_code=400, detail=f"Cannot delete team with {tasks_count} existing tasks")
    db.delete(team)
    db.commit()
    return {"message": "Team deleted"}


# ==================== USERS CRUD ====================

@router.get("/users", response_model=List[UserResponse])
def admin_get_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "read"))
):
    ordering = None
    users = db.query(User).outerjoin(User.role).order_by(User.role_id, User.name).all()
    return users


@router.post("/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def admin_create_user(
    user_data: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "full"))
):
    existing_email = db.query(User).filter(User.email == user_data.email).first()
    if existing_email:
        raise HTTPException(status_code=400, detail="Email already registered")
    existing_name = db.query(User).filter(User.name == user_data.name).first()
    if existing_name:
        raise HTTPException(status_code=400, detail="User with this name already exists")
    if user_data.business_customer_id is not None and not db.query(BusinessCustomer).filter(
        BusinessCustomer.id == user_data.business_customer_id
    ).first():
        raise HTTPException(status_code=422, detail="Business customer not found")

    password = user_data.password or "dmb2026"
    user = User(
        email=user_data.email,
        login=user_data.login,
        password_hash=get_password_hash(password),
        name=user_data.name,
        position=user_data.position,
        team_id=user_data.team_id,
        role_id=user_data.role_id,
        business_customer_id=user_data.business_customer_id,
        is_active=user_data.is_active if user_data.is_active is not None else True,
        can_edit=user_data.can_edit if user_data.can_edit is not None else True,
        can_delete=user_data.can_delete if user_data.can_delete is not None else False,
        can_export=user_data.can_export if user_data.can_export is not None else True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.put("/users/{user_id}", response_model=UserResponse)
def admin_update_user(
    user_id: int,
    user_data: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "full"))
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    _protect_admin_identity_change(
        db, current_user, user,
        next_active=user_data.is_active,
        next_role_id=user_data.role_id if "role_id" in user_data.model_fields_set else None,
    )

    if user_data.name is not None and user_data.name != user.name:
        existing_name = db.query(User).filter(User.name == user_data.name, User.id != user_id).first()
        if existing_name:
            raise HTTPException(status_code=400, detail="User with this name already exists")

    if user_data.email is not None and user_data.email != user.email:
        existing_email = db.query(User).filter(User.email == user_data.email, User.id != user_id).first()
        if existing_email:
            raise HTTPException(status_code=400, detail="Email already registered")

    if "business_customer_id" in user_data.model_fields_set and user_data.business_customer_id is not None:
        if not db.query(BusinessCustomer).filter(BusinessCustomer.id == user_data.business_customer_id).first():
            raise HTTPException(status_code=422, detail="Business customer not found")

    was_active = user.is_active
    for field, value in user_data.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    if was_active and not user.is_active:
        db.query(RefreshSession).filter(
            RefreshSession.user_id == user.id,
            RefreshSession.revoked_at.is_(None),
        ).update({"revoked_at": datetime.now(timezone.utc)}, synchronize_session=False)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/users/{user_id}")
def admin_delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "full"))
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    _protect_admin_identity_change(db, current_user, user, next_active=False)
    user.is_active = False
    db.query(RefreshSession).filter(
        RefreshSession.user_id == user.id,
        RefreshSession.revoked_at.is_(None),
    ).update({"revoked_at": datetime.now(timezone.utc)}, synchronize_session=False)
    db.commit()
    return {"message": "User deactivated", "id": user.id, "is_active": False}


# ==================== DICTIONARIES CRUD ====================

DICT_LOCK_MINUTES = 15

VALID_DICT_TYPES = [
    "priority", "status", "task_type", "channel", "deadline",
    "department", "team_type", "project_status", "competency_cost", "tag",
]


def _dict_items_for_lock(dict_type: str, db: Session):
    """Return active items for a dictionary type. Department is stored in the
    dedicated `departments` table, other dictionaries in `dictionary_items`."""
    if dict_type == "department":
        return db.query(Department).filter(Department.is_active == True).all()
    if dict_type == "tag":
        return db.query(Tag).filter(Tag.is_active == True).all()
    return db.query(DictionaryItem).filter(
        DictionaryItem.dict_type == dict_type,
        DictionaryItem.is_active == True,
    ).all()


def _is_dict_lock_active(item) -> bool:
    if not getattr(item, "lock_owner_id", None) or not getattr(item, "lock_until", None):
        return False
    return item.lock_until.replace(tzinfo=None) > datetime.now(timezone.utc).replace(tzinfo=None)


def _get_dict_lock_info(dict_type: str, db: Session) -> dict:
    """Get lock status for a dictionary type from its first active item."""
    items = _dict_items_for_lock(dict_type, db)
    item = items[0] if items else None
    if item and _is_dict_lock_active(item):
        owner = db.query(User).filter(User.id == item.lock_owner_id).first()
        return {
            "locked": True,
            "lock_owner_id": item.lock_owner_id,
            "lock_owner_name": owner.name if owner else None,
            "lock_until": item.lock_until,
            "version": item.version or 0,
        }
    return {"locked": False, "version": item.version if item else 0}


def _acquire_dict_lock(dict_type: str, user: User, db: Session) -> DictLockResponse:
    """Acquire or extend a lock on a dictionary type for all its active items."""
    items = _dict_items_for_lock(dict_type, db)
    if not items:
        raise HTTPException(status_code=404, detail="Dictionary not found")

    now = datetime.now(timezone.utc)
    new_until = now + timedelta(minutes=DICT_LOCK_MINUTES)
    first = items[0]

    if _is_dict_lock_active(first):
        if first.lock_owner_id == user.id:
            for item in items:
                item.lock_until = new_until
            db.commit()
            return DictLockResponse(
                locked=True, lock_owner_id=user.id, lock_owner_name=user.name,
                lock_until=new_until, is_mine=True, version=first.version or 0,
            )
        else:
            owner = db.query(User).filter(User.id == first.lock_owner_id).first()
            raise HTTPException(
                status_code=423,
                detail=f"Справочник редактируется администратором {owner.name if owner else 'Неизвестный'}. Доступен просмотр.",
            )

    for item in items:
        item.lock_owner_id = user.id
        item.lock_until = new_until
        item.version = (item.version or 0) + 1
    db.commit()
    return DictLockResponse(
        locked=True, lock_owner_id=user.id, lock_owner_name=user.name,
        lock_until=new_until, is_mine=True, version=first.version or 0,
    )


def _release_dict_lock(dict_type: str, user: User, db: Session) -> DictLockResponse:
    """Release lock on a dictionary type for all its active items."""
    items = _dict_items_for_lock(dict_type, db)
    for item in items:
        if item.lock_owner_id == user.id or not _is_dict_lock_active(item):
            item.lock_owner_id = None
            item.lock_until = None
    db.commit()
    return DictLockResponse(locked=False, is_mine=False, version=0)


@router.get("/dict-locks")
def get_all_dict_locks(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "read")),
):
    """Get lock status for all dictionary types (for card indicators)."""
    result = {}
    for dt in VALID_DICT_TYPES:
        result[dt] = _get_dict_lock_info(dt, db)
    return result


@router.get("/{dict_type}/lock")
def get_dict_lock(
    dict_type: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "read")),
):
    """Check lock status for a specific dictionary type."""
    if dict_type not in VALID_DICT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid dictionary type")
    info = _get_dict_lock_info(dict_type, db)
    info["is_mine"] = info.get("lock_owner_id") == current_user.id if info.get("locked") else False
    return DictLockResponse(**info)


@router.post("/{dict_type}/lock")
def acquire_dict_lock(
    dict_type: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial")),
):
    """Acquire lock on a dictionary type for editing."""
    if dict_type not in VALID_DICT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid dictionary type")
    return _acquire_dict_lock(dict_type, current_user, db)


@router.delete("/{dict_type}/lock")
def release_dict_lock(
    dict_type: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial")),
):
    """Release lock on a dictionary type."""
    if dict_type not in VALID_DICT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid dictionary type")
    return _release_dict_lock(dict_type, current_user, db)

def get_dict_items(dict_type: str, db: Session):
    items = db.query(DictionaryItem).filter(
        DictionaryItem.dict_type == dict_type,
        DictionaryItem.is_active == True
    ).order_by(DictionaryItem.sort_order).all()
    return items


def _dictionary_usage_count(dict_type: str, item_id: int, db: Session) -> int:
    task_fields = {
        "priority": [Task.priority_id], "status": [Task.status_id, Task.previous_status_id],
        "task_type": [Task.task_type_id], "channel": [Task.channel_id], "deadline": [Task.deadline_id],
    }
    if dict_type in task_fields:
        return db.query(func.count(Task.id)).filter(or_(*[field == item_id for field in task_fields[dict_type]])).scalar() or 0
    if dict_type == "department":
        tasks = db.query(func.count(Task.id)).filter(Task.department_id == item_id).scalar() or 0
        customers = db.query(func.count(BusinessCustomer.id)).filter(BusinessCustomer.department_id == item_id).scalar() or 0
        return tasks + customers
    if dict_type == "team_type":
        return db.query(func.count(Team.id)).filter(Team.team_type_id == item_id).scalar() or 0
    if dict_type == "project_status":
        return db.query(func.count(Project.id)).filter(Project.status_id == item_id).scalar() or 0
    if dict_type == "tag":
        issues = db.query(func.count(IssueTag.id)).filter(IssueTag.tag_id == item_id).scalar() or 0
        projects = db.query(func.count(ProjectTag.id)).filter(ProjectTag.tag_id == item_id).scalar() or 0
        return issues + projects
    return 0


@router.get("/dictionaries/{dict_type}/workspace")
def get_dictionary_workspace(
    dict_type: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "read")),
):
    supported = {"priority", "status", "task_type", "channel", "deadline", "department", "team_type", "project_status", "tag"}
    if dict_type not in supported:
        raise HTTPException(status_code=400, detail="Рабочее представление для этого справочника не поддерживается")
    model = Department if dict_type == "department" else Tag if dict_type == "tag" else DictionaryItem
    query = db.query(model)
    if model is DictionaryItem:
        query = query.filter(DictionaryItem.dict_type == dict_type)
    items = query.order_by(model.is_active.desc(), model.sort_order, model.name).all()
    return {"items": [{
        "id": item.id, "name": item.name, "code": item.code, "color": item.color,
        "sort_order": item.sort_order or 0, "is_active": bool(item.is_active),
        "usage_count": _dictionary_usage_count(dict_type, item.id, db),
    } for item in items]}


def _check_dict_lock(dict_type: str, user: User, db: Session):
    """Check if dictionary is locked by another user; raise 423 if so."""
    info = _get_dict_lock_info(dict_type, db)
    if info["locked"] and not info.get("is_mine", False) and info["lock_owner_id"] != user.id:
        raise HTTPException(
            status_code=423,
            detail=f"Справочник редактируется администратором {info['lock_owner_name']}. Доступен просмотр.",
        )


@router.put("/dictionaries/{dict_type}/batch")
def save_dictionary_batch(
    dict_type: str,
    data: DictionaryBatchUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial")),
):
    """Atomically replace an editable dictionary snapshot.

    Missing rows are archived rather than deleted so existing foreign-key
    references keep their labels. The editor lock and optimistic version are
    checked before any mutation is flushed.
    """
    supported = {"priority", "status", "task_type", "channel", "deadline", "department", "team_type", "project_status", "tag"}
    if dict_type not in supported:
        raise HTTPException(status_code=400, detail="Пакетное сохранение для этого справочника не поддерживается")
    items = _dict_items_for_lock(dict_type, db)
    first = items[0] if items else None
    if not first or not _is_dict_lock_active(first) or first.lock_owner_id != current_user.id:
        raise HTTPException(status_code=423, detail="Требуется активная блокировка редактирования справочника")
    current_version = first.version or 0
    if data.version != current_version:
        raise HTTPException(status_code=409, detail="Справочник был изменён другим администратором")
    if not data.items:
        raise HTTPException(status_code=422, detail="В справочнике должно остаться хотя бы одно активное значение")

    names = [item.name.strip().casefold() for item in data.items]
    codes = [item.code.strip().casefold() for item in data.items if item.code and item.code.strip()]
    if len(names) != len(set(names)):
        raise HTTPException(status_code=422, detail="Названия элементов справочника должны быть уникальными")
    if len(codes) != len(set(codes)):
        raise HTTPException(status_code=422, detail="Коды элементов справочника должны быть уникальными")
    for item in data.items:
        if item.color and not __import__("re").fullmatch(r"#[0-9a-fA-F]{6}", item.color):
            raise HTTPException(status_code=422, detail=f"Некорректный цвет для значения «{item.name}»")

    model = Department if dict_type == "department" else Tag if dict_type == "tag" else DictionaryItem
    existing_query = db.query(model)
    if dict_type not in {"department", "tag"}:
        existing_query = existing_query.filter(DictionaryItem.dict_type == dict_type)
    existing = {item.id: item for item in existing_query.all()}
    submitted_ids = {item.id for item in data.items if item.id is not None}
    unknown_ids = submitted_ids - set(existing)
    if unknown_ids:
        raise HTTPException(status_code=409, detail="Справочник изменился после открытия; обновите данные")

    added = updated = archived = 0
    next_version = current_version + 1
    try:
        for position, payload in enumerate(data.items):
            values = {
                "name": payload.name.strip(), "code": (payload.code or "").strip() or None,
                "color": payload.color, "sort_order": payload.sort_order if payload.sort_order is not None else position,
                "is_active": True, "version": next_version,
                "lock_owner_id": current_user.id, "lock_until": first.lock_until,
            }
            if dict_type == "department" and not values["code"]:
                values["code"] = f"DEPT_{payload.id or ('NEW_' + str(position + 1))}"
            if payload.id is None:
                if dict_type not in {"department", "tag"}:
                    values["dict_type"] = dict_type
                db.add(model(**values))
                added += 1
            else:
                target = existing[payload.id]
                for field, value in values.items():
                    setattr(target, field, value)
                target.is_active = True
                updated += 1
        for item_id, target in existing.items():
            if target.is_active and item_id not in submitted_ids:
                target.is_active = False
                target.version = next_version
                target.lock_owner_id = None
                target.lock_until = None
                archived += 1
        db.flush()
        active = db.query(model).filter(
            model.is_active == True if dict_type in {"department", "tag"} else (
                (DictionaryItem.dict_type == dict_type) & (DictionaryItem.is_active == True)
            )
        ).order_by(model.sort_order, model.name).all()
        db.commit()
    except Exception:
        db.rollback()
        raise

    serialized = []
    for item in active:
        serialized.append({
            "id": item.id, "dict_type": dict_type, "name": item.name, "code": item.code,
            "color": item.color, "sort_order": item.sort_order or 0, "is_active": item.is_active,
            "version": item.version or next_version,
        })
    return {"items": serialized, "version": next_version, "added": added, "updated": updated, "archived": archived}


@router.get("/priorities", response_model=List[DictionaryItemResponse])
def get_priorities(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return get_dict_items("priority", db)


@router.get("/statuses", response_model=List[DictionaryItemResponse])
def get_statuses(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return get_dict_items("status", db)


@router.get("/task-types", response_model=List[DictionaryItemResponse])
def get_task_types(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return get_dict_items("task_type", db)


@router.get("/business-customers", response_model=List[BusinessCustomerResponse])
def get_business_customers(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    customers = db.query(BusinessCustomer).order_by(BusinessCustomer.name).all()
    result = []
    for c in customers:
        result.append(BusinessCustomerResponse(
            id=c.id,
            name=c.name,
            department_id=c.department_id,
            department_name=c.department.name if c.department else None,
            created_at=c.created_at,
        ))
    return result


@router.post("/priorities", response_model=DictionaryItemResponse, status_code=status.HTTP_201_CREATED)
def create_priority(
    data: DictionaryItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    _check_dict_lock("priority", current_user, db)
    item = DictionaryItem(dict_type="priority", **data.model_dump(exclude={"dict_type"}))
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.post("/statuses", response_model=DictionaryItemResponse, status_code=status.HTTP_201_CREATED)
def create_status(
    data: DictionaryItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    _check_dict_lock("status", current_user, db)
    item = DictionaryItem(dict_type="status", **data.model_dump(exclude={"dict_type"}))
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.post("/task-types", response_model=DictionaryItemResponse, status_code=status.HTTP_201_CREATED)
def create_task_type(
    data: DictionaryItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    _check_dict_lock("task_type", current_user, db)
    item = DictionaryItem(dict_type="task_type", **data.model_dump(exclude={"dict_type"}))
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.put("/priorities/{item_id}", response_model=DictionaryItemResponse)
def update_priority(
    item_id: int,
    data: DictionaryItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = db.query(DictionaryItem).filter(DictionaryItem.id == item_id, DictionaryItem.dict_type == "priority").first()
    if not item:
        raise HTTPException(status_code=404, detail="Priority not found")
    _check_dict_lock("priority", current_user, db)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    item.version = (item.version or 0) + 1
    db.commit()
    db.refresh(item)
    return item


@router.put("/statuses/{item_id}", response_model=DictionaryItemResponse)
def update_status(
    item_id: int,
    data: DictionaryItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = db.query(DictionaryItem).filter(DictionaryItem.id == item_id, DictionaryItem.dict_type == "status").first()
    if not item:
        raise HTTPException(status_code=404, detail="Status not found")
    _check_dict_lock("status", current_user, db)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    item.version = (item.version or 0) + 1
    db.commit()
    db.refresh(item)
    return item


@router.put("/task-types/{item_id}", response_model=DictionaryItemResponse)
def update_task_type(
    item_id: int,
    data: DictionaryItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = db.query(DictionaryItem).filter(DictionaryItem.id == item_id, DictionaryItem.dict_type == "task_type").first()
    if not item:
        raise HTTPException(status_code=404, detail="Task type not found")
    _check_dict_lock("task_type", current_user, db)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    item.version = (item.version or 0) + 1
    db.commit()
    db.refresh(item)
    return item


@router.delete("/priorities/{item_id}")
def delete_priority(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = db.query(DictionaryItem).filter(DictionaryItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Priority not found")
    _check_dict_lock("priority", current_user, db)
    item.is_active = False
    db.commit()
    return {"message": "Priority deleted"}


@router.delete("/statuses/{item_id}")
def delete_status(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = db.query(DictionaryItem).filter(DictionaryItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Status not found")
    _check_dict_lock("status", current_user, db)
    item.is_active = False
    db.commit()
    return {"message": "Status deleted"}


@router.delete("/task-types/{item_id}")
def delete_task_type(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = db.query(DictionaryItem).filter(DictionaryItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Task type not found")
    _check_dict_lock("task_type", current_user, db)
    item.is_active = False
    db.commit()
    return {"message": "Task type deleted"}


@router.post("/business-customers", response_model=BusinessCustomerResponse, status_code=status.HTTP_201_CREATED)
def create_business_customer(
    data: BusinessCustomerCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    customer = BusinessCustomer(**data.model_dump())
    db.add(customer)
    db.commit()
    db.refresh(customer)
    return BusinessCustomerResponse(
        id=customer.id,
        name=customer.name,
        department_id=customer.department_id,
        department_name=customer.department.name if customer.department else None,
        created_at=customer.created_at,
    )


@router.put("/business-customers/{item_id}", response_model=BusinessCustomerResponse)
def update_business_customer(
    item_id: int,
    data: BusinessCustomerUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    customer = db.query(BusinessCustomer).filter(BusinessCustomer.id == item_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Business customer not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(customer, field, value)
    db.commit()
    db.refresh(customer)
    return BusinessCustomerResponse(
        id=customer.id,
        name=customer.name,
        department_id=customer.department_id,
        department_name=customer.department.name if customer.department else None,
        created_at=customer.created_at,
    )


# ==================== NEW DICTIONARY TYPES ====================

@router.get("/channels", response_model=List[DictionaryItemResponse])
def get_channels(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return get_dict_items("channel", db)


@router.post("/channels", response_model=DictionaryItemResponse, status_code=status.HTTP_201_CREATED)
def create_channel(
    data: DictionaryItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    _check_dict_lock("channel", current_user, db)
    item = DictionaryItem(dict_type="channel", **data.model_dump(exclude={"dict_type"}))
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.put("/channels/{item_id}", response_model=DictionaryItemResponse)
def update_channel(
    item_id: int,
    data: DictionaryItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = db.query(DictionaryItem).filter(DictionaryItem.id == item_id, DictionaryItem.dict_type == "channel").first()
    if not item:
        raise HTTPException(status_code=404, detail="Channel not found")
    _check_dict_lock("channel", current_user, db)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    item.version = (item.version or 0) + 1
    db.commit()
    db.refresh(item)
    return item


@router.delete("/channels/{item_id}")
def delete_channel(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = db.query(DictionaryItem).filter(DictionaryItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Channel not found")
    _check_dict_lock("channel", current_user, db)
    item.is_active = False
    db.commit()
    return {"message": "Channel deleted"}


@router.get("/deadlines", response_model=List[DictionaryItemResponse])
def get_deadlines(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return get_dict_items("deadline", db)


@router.post("/deadlines", response_model=DictionaryItemResponse, status_code=status.HTTP_201_CREATED)
def create_deadline(
    data: DictionaryItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    _check_dict_lock("deadline", current_user, db)
    item = DictionaryItem(dict_type="deadline", **data.model_dump(exclude={"dict_type"}))
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.put("/deadlines/{item_id}", response_model=DictionaryItemResponse)
def update_deadline(
    item_id: int,
    data: DictionaryItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = db.query(DictionaryItem).filter(DictionaryItem.id == item_id, DictionaryItem.dict_type == "deadline").first()
    if not item:
        raise HTTPException(status_code=404, detail="Deadline not found")
    _check_dict_lock("deadline", current_user, db)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    item.version = (item.version or 0) + 1
    db.commit()
    db.refresh(item)
    return item


@router.delete("/deadlines/{item_id}")
def delete_deadline(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = db.query(DictionaryItem).filter(DictionaryItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Deadline not found")
    _check_dict_lock("deadline", current_user, db)
    item.is_active = False
    db.commit()
    return {"message": "Deadline deleted"}


def _department_to_response(dept: Department, db: Session) -> dict:
    owner_name = None
    if dept.lock_owner_id:
        owner = db.query(User).filter(User.id == dept.lock_owner_id).first()
        owner_name = owner.name if owner else None
    return {
        "dict_type": "department",
        "id": dept.id,
        "name": dept.name,
        "code": dept.code,
        "color": dept.color,
        "sort_order": dept.sort_order,
        "is_active": dept.is_active,
        "created_at": dept.created_at,
        "version": dept.version or 0,
        "lock_owner_id": dept.lock_owner_id,
        "lock_owner_name": owner_name,
        "lock_until": dept.lock_until,
    }


@router.get("/departments", response_model=List[DictionaryItemResponse])
def get_departments(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    depts = db.query(Department).filter(Department.is_active == True).order_by(Department.sort_order, Department.name).all()
    return [_department_to_response(d, db) for d in depts]


@router.post("/departments", response_model=DictionaryItemResponse, status_code=status.HTTP_201_CREATED)
def create_department(
    data: DictionaryItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    _check_dict_lock("department", current_user, db)
    code = (data.code or "").strip()
    if not code:
        existing = db.query(Department).order_by(Department.id.desc()).first()
        code = f"DEPT_{existing.id + 1 if existing else 1}"
    item = Department(
        name=data.name,
        code=code,
        color=data.color or "#6366f1",
        sort_order=data.sort_order,
        is_active=data.is_active,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _department_to_response(item, db)


@router.put("/departments/{item_id}", response_model=DictionaryItemResponse)
def update_department(
    item_id: int,
    data: DictionaryItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = db.query(Department).filter(Department.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Department not found")
    _check_dict_lock("department", current_user, db)
    update = data.model_dump(exclude_unset=True)
    if update.get("code") is not None and not str(update["code"]).strip():
        existing = db.query(Department).order_by(Department.id.desc()).first()
        update["code"] = f"DEPT_{existing.id + 1 if existing else 1}"
    for field, value in update.items():
        setattr(item, field, value)
    item.version = (item.version or 0) + 1
    db.commit()
    db.refresh(item)
    return _department_to_response(item, db)


@router.delete("/departments/{item_id}")
def delete_department(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = db.query(Department).filter(Department.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Department not found")
    _check_dict_lock("department", current_user, db)
    item.is_active = False
    db.commit()
    return {"message": "Department deleted"}


@router.get("/team-types", response_model=List[DictionaryItemResponse])
def get_team_types(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return get_dict_items("team_type", db)


@router.post("/team-types", response_model=DictionaryItemResponse, status_code=status.HTTP_201_CREATED)
def create_team_type(
    data: DictionaryItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    _check_dict_lock("team_type", current_user, db)
    item = DictionaryItem(dict_type="team_type", **data.model_dump(exclude={"dict_type"}))
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.put("/team-types/{item_id}", response_model=DictionaryItemResponse)
def update_team_type(
    item_id: int,
    data: DictionaryItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = db.query(DictionaryItem).filter(DictionaryItem.id == item_id, DictionaryItem.dict_type == "team_type").first()
    if not item:
        raise HTTPException(status_code=404, detail="Team type not found")
    _check_dict_lock("team_type", current_user, db)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    item.version = (item.version or 0) + 1
    db.commit()
    db.refresh(item)
    return item


@router.delete("/team-types/{item_id}")
def delete_team_type(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = db.query(DictionaryItem).filter(DictionaryItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Team type not found")
    _check_dict_lock("team_type", current_user, db)
    item.is_active = False
    db.commit()
    return {"message": "Team type deleted"}


@router.get("/project-statuses", response_model=List[DictionaryItemResponse])
def get_project_statuses(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return get_dict_items("project_status", db)


@router.post("/project-statuses", response_model=DictionaryItemResponse, status_code=status.HTTP_201_CREATED)
def create_project_status(
    data: DictionaryItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    _check_dict_lock("project_status", current_user, db)
    item = DictionaryItem(dict_type="project_status", **data.model_dump(exclude={"dict_type"}))
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.put("/project-statuses/{item_id}", response_model=DictionaryItemResponse)
def update_project_status(
    item_id: int,
    data: DictionaryItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = db.query(DictionaryItem).filter(DictionaryItem.id == item_id, DictionaryItem.dict_type == "project_status").first()
    if not item:
        raise HTTPException(status_code=404, detail="Project status not found")
    _check_dict_lock("project_status", current_user, db)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    item.version = (item.version or 0) + 1
    db.commit()
    db.refresh(item)
    return item


@router.delete("/project-statuses/{item_id}")
def delete_project_status(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = db.query(DictionaryItem).filter(DictionaryItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Project status not found")
    _check_dict_lock("project_status", current_user, db)
    item.is_active = False
    db.commit()
    return {"message": "Project status deleted"}


# ==================== COMPETENCY COSTS (history: competency x year) ====================

@router.put("/competency-costs/batch")
def save_competency_costs_batch(
    data: CompetencyCostBatchUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial")),
):
    lock_items = _dict_items_for_lock("competency_cost", db)
    first = lock_items[0] if lock_items else None
    if not first or not _is_dict_lock_active(first) or first.lock_owner_id != current_user.id:
        raise HTTPException(status_code=423, detail="Требуется активная блокировка редактирования справочника")
    if data.version != (first.version or 0):
        raise HTTPException(status_code=409, detail="Справочник был изменён другим администратором")
    keys = [(item.competency.strip().casefold(), item.year) for item in data.items]
    if len(keys) != len(set(keys)):
        raise HTTPException(status_code=422, detail="Комбинация компетенции и года должна быть уникальной")
    existing = {
        (item.competency.casefold(), item.year): item
        for item in db.query(CompetencyCostHistory).filter(CompetencyCostHistory.is_active == True).all()
    }
    submitted = set(keys)
    added = updated = archived = 0
    try:
        for payload, key in zip(data.items, keys):
            target = existing.get(key)
            if target:
                target.competency = payload.competency.strip()
                target.rate = payload.rate
                updated += 1
            else:
                db.add(CompetencyCostHistory(
                    competency=payload.competency.strip(), year=payload.year,
                    rate=payload.rate, is_active=True,
                ))
                added += 1
        for key, target in existing.items():
            if key not in submitted:
                target.is_active = False
                archived += 1
        next_version = (first.version or 0) + 1
        for lock_item in lock_items:
            lock_item.version = next_version
        recalculate_effort_rub_for_all(db)
        db.commit()
        result = db.query(CompetencyCostHistory).filter(
            CompetencyCostHistory.is_active == True
        ).order_by(CompetencyCostHistory.competency, CompetencyCostHistory.year).all()
    except Exception:
        db.rollback()
        raise
    return {
        "items": [CompetencyCostHistoryResponse.model_validate(item).model_dump(mode="json") for item in result],
        "version": next_version, "added": added, "updated": updated, "archived": archived,
    }


@router.get("/competency-costs", response_model=List[CompetencyCostHistoryResponse])
def get_competency_costs(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Все активные записи ставок компетенций (компетенция x год)."""
    return db.query(CompetencyCostHistory).filter(
        CompetencyCostHistory.is_active == True
    ).order_by(
        CompetencyCostHistory.competency, CompetencyCostHistory.year
    ).all()


@router.post("/competency-costs", response_model=CompetencyCostHistoryResponse, status_code=status.HTTP_201_CREATED)
def create_competency_cost(
    data: CompetencyCostHistoryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    _check_dict_lock("competency_cost", current_user, db)
    existing = db.query(CompetencyCostHistory).filter(
        CompetencyCostHistory.competency == data.competency,
        CompetencyCostHistory.year == data.year,
    ).first()
    if existing:
        existing.is_active = True
        existing.rate = data.rate
        db.commit()
        db.refresh(existing)
        return existing
    item = CompetencyCostHistory(**data.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.put("/competency-costs/{competency}/{year}", response_model=CompetencyCostHistoryResponse)
def update_competency_cost(
    competency: str,
    year: int,
    data: CompetencyCostHistoryUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    _check_dict_lock("competency_cost", current_user, db)
    item = db.query(CompetencyCostHistory).filter(
        CompetencyCostHistory.competency == competency,
        CompetencyCostHistory.year == year,
    ).first()
    if not item:
        item = CompetencyCostHistory(competency=competency, year=year, rate=0)
        db.add(item)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    item.is_active = True
    changed = recalculate_effort_rub_for_all(db)
    db.commit()
    db.refresh(item)
    if changed:
        logger.info("Competency costs changed; recalculated effort_rub for %s tasks", changed)
    return item


@router.delete("/competency-costs/{competency}/{year}")
def delete_competency_cost(
    competency: str,
    year: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = db.query(CompetencyCostHistory).filter(
        CompetencyCostHistory.competency == competency,
        CompetencyCostHistory.year == year,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Competency cost not found")
    _check_dict_lock("competency_cost", current_user, db)
    item.is_active = False
    changed = recalculate_effort_rub_for_all(db)
    db.commit()
    if changed:
        logger.info("Competency costs changed; recalculated effort_rub for %s tasks", changed)
    return {"message": "Competency cost deleted"}


# ==================== PROJECTS CRUD ====================

@router.get("/projects", response_model=List[ProjectResponse])
def get_projects(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "read"))
):
    projects = db.query(Project).order_by(Project.name).all()
    result = []
    for p in projects:
        result.append(ProjectResponse(
            id=p.id,
            code=p.code,
            name=p.name,
            description=p.description,
            status_id=p.status_id,
            responsible_pl=p.responsible_pl,
            created_at=p.created_at,
            status_name=p.status.name if p.status else None,
            pl_name=p.pl.name if p.pl else None,
        ))
    return result


@router.post("/projects", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
def create_project(
    project_data: ProjectCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    existing = db.query(Project).filter(Project.code == project_data.code).first()
    if existing:
        raise HTTPException(status_code=400, detail="Project code already exists")
    project = Project(**project_data.model_dump())
    db.add(project)
    db.commit()
    db.refresh(project)
    return ProjectResponse(
        id=project.id,
        code=project.code,
        name=project.name,
        description=project.description,
        status_id=project.status_id,
        responsible_pl=project.responsible_pl,
        created_at=project.created_at,
        status_name=project.status.name if project.status else None,
        pl_name=project.pl.name if project.pl else None,
    )


@router.put("/projects/{item_id}", response_model=ProjectResponse)
def update_project(
    item_id: int,
    project_data: ProjectUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    project = db.query(Project).filter(Project.id == item_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    for field, value in project_data.model_dump(exclude_unset=True).items():
        setattr(project, field, value)
    db.commit()
    db.refresh(project)
    return ProjectResponse(
        id=project.id,
        code=project.code,
        name=project.name,
        description=project.description,
        status_id=project.status_id,
        responsible_pl=project.responsible_pl,
        created_at=project.created_at,
        status_name=project.status.name if project.status else None,
        pl_name=project.pl.name if project.pl else None,
    )


@router.delete("/projects/{item_id}")
def delete_project(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    project = db.query(Project).filter(Project.id == item_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    tasks_count = db.query(Task).filter(Task.project_id == item_id).count()
    if tasks_count > 0:
        raise HTTPException(status_code=400, detail=f"Cannot delete project linked to {tasks_count} tasks")
    db.delete(project)
    db.commit()
    return {"message": "Project deleted"}


# ==================== NORMALIZED LOOKUP ENDPOINTS ====================

from models import TeamType as TeamTypeModel

@router.get("/team-types-ref")
def get_team_types_ref(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    types = db.query(TeamTypeModel).order_by(TeamTypeModel.id).all()
    return [{"id": t.id, "code": t.code, "name": t.name} for t in types]


# ==================== DISPLAY SETTINGS ====================

@router.get("/display-settings", response_model=List[DisplaySettingResponse])
def get_display_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "read"))
):
    settings = db.query(DisplaySetting).all()
    result = []
    for s in settings:
        result.append(DisplaySettingResponse(
            id=s.id,
            page=s.page,
            settings=json.loads(s.settings) if isinstance(s.settings, str) else s.settings,
            created_at=s.created_at,
            updated_at=s.updated_at,
        ))
    return result


@router.get("/display-settings/{page}", response_model=DisplaySettingResponse)
def get_display_setting(
    page: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    setting = db.query(DisplaySetting).filter(DisplaySetting.page == page).first()
    if not setting:
        raise HTTPException(status_code=404, detail="Display settings not found")
    return DisplaySettingResponse(
        id=setting.id,
        page=setting.page,
        settings=json.loads(setting.settings) if isinstance(setting.settings, str) else setting.settings,
        created_at=setting.created_at,
        updated_at=setting.updated_at,
    )


@router.put("/display-settings/{page}", response_model=DisplaySettingResponse)
def update_display_setting(
    page: str,
    data: DisplaySettingUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    pages_to_save = ['backlog_dmb', 'team_backlog'] if page == 'shared' else [page]
    saved = None
    touched = []
    for p in pages_to_save:
        setting = db.query(DisplaySetting).filter(DisplaySetting.page == p).first()
        if not setting:
            setting = DisplaySetting(page=p, settings=json.dumps(data.settings, ensure_ascii=False))
            db.add(setting)
        else:
            setting.settings = json.dumps(data.settings, ensure_ascii=False)
        db.flush()
        touched.append(setting)
        if p == page or page == 'shared':
            saved = setting
    db.commit()
    for setting in touched:
        db.refresh(setting)
    return DisplaySettingResponse(
        id=saved.id,
        page=page,
        settings=json.loads(saved.settings) if isinstance(saved.settings, str) else saved.settings,
        created_at=saved.created_at,
        updated_at=saved.updated_at,
    )


# ==================== COLUMN LABELS ====================

@router.get("/field-labels")
def get_field_labels(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Точные русские названия полей задачи из реестра field_labels (для отображения на фронте)."""
    labels = db.query(FieldLabel).order_by(FieldLabel.sort_order).all()
    return {item.key: item.label for item in labels}


@router.get("/column-labels")
def get_column_labels(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    labels = db.query(ColumnLabel).all()
    return {item.key: item.label for item in labels}


@router.put("/column-labels")
def update_column_labels(
    data: ColumnLabelUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    for key, label in data.labels.items():
        existing = db.query(ColumnLabel).filter(ColumnLabel.key == key).first()
        if existing:
            existing.label = label
        else:
            db.add(ColumnLabel(key=key, label=label))
    db.commit()
    labels = db.query(ColumnLabel).all()
    return {item.key: item.label for item in labels}


@router.put("/field-labels")
def update_field_labels(
    data: ColumnLabelUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    """Обновляет русские названия полей задачи в реестре field_labels (используется таблицами)."""
    for key, label in data.labels.items():
        existing = db.query(FieldLabel).filter(FieldLabel.key == key).first()
        if existing:
            existing.label = label
        else:
            db.add(FieldLabel(key=key, label=label, group="основные", sort_order=0))
    db.commit()
    labels = db.query(FieldLabel).order_by(FieldLabel.sort_order).all()
    return {item.key: item.label for item in labels}



@router.delete("/business-customers/{item_id}")
def delete_business_customer(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    customer = db.query(BusinessCustomer).filter(BusinessCustomer.id == item_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Business customer not found")
    tasks_count = db.query(Task).filter(Task.business_customer_id == item_id).count()
    users_count = db.query(User).filter(User.business_customer_id == item_id).count()
    if tasks_count or users_count:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete business customer linked to {tasks_count} tasks and {users_count} users",
        )
    db.delete(customer)
    db.commit()
    return {"message": "Business customer deleted"}


# ==================== TAGS ====================

@router.get("/tags", response_model=List[TagResponse])
def get_tags(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return db.query(Tag).filter(Tag.is_active == True).order_by(Tag.sort_order, Tag.name).all()


@router.post("/tags", response_model=TagResponse, status_code=status.HTTP_201_CREATED)
def create_tag(
    data: TagCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    tag = Tag(
        name=data.name,
        color=data.color or "#6366f1",
        description=data.description,
        creator=current_user.id,
    )
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return tag


@router.put("/tags/{tag_id}", response_model=TagResponse)
def update_tag(
    tag_id: int,
    data: TagCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    tag = db.query(Tag).filter(Tag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    tag.name = data.name
    tag.color = data.color or "#6366f1"
    tag.description = data.description
    db.commit()
    db.refresh(tag)
    return tag


@router.delete("/tags/{tag_id}")
def delete_tag(
    tag_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    tag = db.query(Tag).filter(Tag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    tag.is_active = False
    db.commit()
    return {"message": "Tag archived"}
