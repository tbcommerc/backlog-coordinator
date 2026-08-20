"""
DMB Backlog - Admin Router (CRUD for roles, teams, users, dictionaries)
"""
import json
import logging
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import case as sql_case, desc
from typing import List, Optional
from datetime import datetime, timezone, timedelta


logger = logging.getLogger("dmb_backlog.admin")

from database import get_db
from models import Role, Team, User, Task, DictionaryItem, DisplaySetting, ColumnLabel, FieldLabel, Project, BusinessCustomer, Department, AuditLog, CompetencyCostHistory, Tag, IssueTag, ProjectTag
from schemas import (
    RoleCreate, RoleUpdate, RoleResponse,
    TeamCreate, TeamUpdate, TeamResponse,
    UserCreate, UserUpdate, UserResponse,
    DictionaryItemCreate, DictionaryItemUpdate, DictionaryItemResponse,
    DictLockResponse,
    CompetencyCostHistoryCreate, CompetencyCostHistoryUpdate, CompetencyCostHistoryResponse,
    DisplaySettingUpdate, DisplaySettingResponse,
    ColumnLabelUpdate, ColumnLabelResponse,
    ProjectCreate, ProjectUpdate, ProjectResponse,
    BusinessCustomerCreate, BusinessCustomerUpdate, BusinessCustomerResponse,
    TagCreate, TagResponse,
)
from auth import get_current_user, require_permission, get_password_hash
from routers.tasks_router import recalculate_effort_rub_for_all

router = APIRouter(tags=["admin"])


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
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "read"))
):
    query = db.query(AuditLog)

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
    current_user: User = Depends(require_permission("admin", "read"))
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
    current_user: User = Depends(get_current_user)
):
    roles = db.query(Role).all()
    return roles


@router.get("/roles/{role_id}", response_model=RoleResponse)
def get_role(
    role_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    return role


@router.post("/roles", response_model=RoleResponse, status_code=status.HTTP_201_CREATED)
def create_role(
    role_data: RoleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    existing = db.query(Role).filter(Role.name == role_data.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Role name already exists")
    role = Role(**role_data.model_dump())
    db.add(role)
    db.commit()
    db.refresh(role)
    return role


@router.put("/roles/{role_id}", response_model=RoleResponse)
def update_role(
    role_id: int,
    role_data: RoleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")

    update = role_data.model_dump(exclude_unset=True)
    if current_user.role_id == role_id and update.get("admin_access") == "none":
        raise HTTPException(status_code=400, detail="Cannot revoke your own admin access")

    for field, value in update.items():
        setattr(role, field, value)
    db.commit()
    db.refresh(role)
    return role


@router.delete("/roles/{role_id}")
def delete_role(
    role_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
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
    current_user: User = Depends(require_permission("admin", "partial"))
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
    current_user: User = Depends(require_permission("admin", "partial"))
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

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

    for field, value in user_data.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/users/{user_id}")
def admin_delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(user)
    db.commit()
    return {"message": "User deleted"}


# ==================== DICTIONARIES CRUD ====================

DICT_LOCK_MINUTES = 15

VALID_DICT_TYPES = [
    "priority", "status", "task_type", "channel", "deadline",
    "department", "team_type", "project_status", "competency_cost",
]


def _dict_items_for_lock(dict_type: str, db: Session):
    """Return active items for a dictionary type. Department is stored in the
    dedicated `departments` table, other dictionaries in `dictionary_items`."""
    if dict_type == "department":
        return db.query(Department).filter(Department.is_active == True).all()
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
    current_user: User = Depends(get_current_user),
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
    current_user: User = Depends(get_current_user),
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


def _check_dict_lock(dict_type: str, user: User, db: Session):
    """Check if dictionary is locked by another user; raise 423 if so."""
    info = _get_dict_lock_info(dict_type, db)
    if info["locked"] and not info.get("is_mine", False) and info["lock_owner_id"] != user.id:
        raise HTTPException(
            status_code=423,
            detail=f"Справочник редактируется администратором {info['lock_owner_name']}. Доступен просмотр.",
        )


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
    db.delete(customer)
    db.commit()
    return {"message": "Business customer deleted"}


# ==================== TAGS ====================

@router.get("/tags", response_model=List[TagResponse])
def get_tags(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return db.query(Tag).order_by(Tag.name).all()


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
    db.query(IssueTag).filter(IssueTag.tag_id == tag_id).delete()
    db.query(ProjectTag).filter(ProjectTag.tag_id == tag_id).delete()
    db.delete(tag)
    db.commit()
    return {"message": "Tag deleted"}
