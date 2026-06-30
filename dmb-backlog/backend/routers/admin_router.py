"""
DMB Backlog - Admin Router (CRUD for roles, teams, users, dictionaries)
"""
import json
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import case as sql_case
from typing import List, Optional

from database import get_db
from models import Role, Team, User, Task, DictionaryItem, NotificationTemplate, DisplaySetting, ColumnLabel, Project, BusinessCustomer, Department
from schemas import (
    RoleCreate, RoleUpdate, RoleResponse,
    TeamCreate, TeamUpdate, TeamResponse,
    UserCreate, UserUpdate, UserResponse,
    DictionaryItemCreate, DictionaryItemUpdate, DictionaryItemResponse,
    NotificationTemplateCreate, NotificationTemplateUpdate, NotificationTemplateResponse,
    DisplaySettingUpdate, DisplaySettingResponse,
    ColumnLabelUpdate, ColumnLabelResponse,
    ProjectCreate, ProjectUpdate, ProjectResponse,
    BusinessCustomerCreate, BusinessCustomerUpdate, BusinessCustomerResponse,
)
from auth import get_current_user, require_permission, get_password_hash

router = APIRouter(tags=["admin"])


# ==================== ROLES CRUD ====================

@router.get("/roles", response_model=List[RoleResponse])
async def get_roles(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    roles = db.query(Role).all()
    return roles


@router.get("/roles/{role_id}", response_model=RoleResponse)
async def get_role(
    role_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    return role


@router.post("/roles", response_model=RoleResponse, status_code=status.HTTP_201_CREATED)
async def create_role(
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
async def update_role(
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
async def delete_role(
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
async def admin_get_teams(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "read"))
):
    teams = db.query(Team).all()
    result = []
    for team in teams:
        members = team.members.split(",") if team.members else []
        result.append(TeamResponse(
            id=team.id, name=team.name, team_type_id=team.team_type_id, abbr=team.abbr, color=team.color,
            domain=team.domain, description=team.description,
            pl=team.pl, po=team.po, cl=team.cl, it_pl=team.it_pl,
            members=team.members, created_at=team.created_at,
            member_count=len([m for m in members if m.strip()]) if members else 0
        ))
    return result


@router.post("/teams", response_model=TeamResponse, status_code=status.HTTP_201_CREATED)
async def admin_create_team(
    team_data: TeamCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    team = Team(**team_data.model_dump())
    db.add(team)
    db.commit()
    db.refresh(team)
    members = team.members.split(",") if team.members else []
    return TeamResponse(
        id=team.id, name=team.name, team_type_id=team.team_type_id, abbr=team.abbr, color=team.color,
        domain=team.domain, description=team.description,
        pl=team.pl, po=team.po, cl=team.cl, it_pl=team.it_pl,
        members=team.members, created_at=team.created_at,
        member_count=len([m for m in members if m.strip()]) if members else 0
    )


@router.put("/teams/{team_id}", response_model=TeamResponse)
async def admin_update_team(
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
    return TeamResponse(
        id=team.id, name=team.name, team_type_id=team.team_type_id, abbr=team.abbr, color=team.color,
        domain=team.domain, description=team.description,
        pl=team.pl, po=team.po, cl=team.cl, it_pl=team.it_pl,
        members=team.members, created_at=team.created_at,
        member_count=len([m for m in members if m.strip()]) if members else 0
    )


@router.delete("/teams/{team_id}")
async def admin_delete_team(
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
async def admin_get_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "read"))
):
    ordering = None
    users = db.query(User).outerjoin(User.role).order_by(User.role_id, User.name).all()
    return users


@router.post("/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def admin_create_user(
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

    password = user_data.password or "dmb2026"
    user = User(
        email=user_data.email,
        login=user_data.login,
        password_hash=get_password_hash(password),
        name=user_data.name,
        position=user_data.position,
        team_id=user_data.team_id,
        role_id=user_data.role_id,
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
async def admin_update_user(
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

    for field, value in user_data.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/users/{user_id}")
async def admin_delete_user(
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

def get_dict_items(dict_type: str, db: Session):
    items = db.query(DictionaryItem).filter(
        DictionaryItem.dict_type == dict_type,
        DictionaryItem.is_active == True
    ).order_by(DictionaryItem.sort_order).all()
    return items


@router.get("/priorities", response_model=List[DictionaryItemResponse])
async def get_priorities(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return get_dict_items("priority", db)


@router.get("/statuses", response_model=List[DictionaryItemResponse])
async def get_statuses(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return get_dict_items("status", db)


@router.get("/task-types", response_model=List[DictionaryItemResponse])
async def get_task_types(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return get_dict_items("task_type", db)


@router.get("/business-customers", response_model=List[BusinessCustomerResponse])
async def get_business_customers(
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
async def create_priority(
    data: DictionaryItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = DictionaryItem(dict_type="priority", **data.model_dump(exclude={"dict_type"}))
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.post("/statuses", response_model=DictionaryItemResponse, status_code=status.HTTP_201_CREATED)
async def create_status(
    data: DictionaryItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = DictionaryItem(dict_type="status", **data.model_dump(exclude={"dict_type"}))
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.post("/task-types", response_model=DictionaryItemResponse, status_code=status.HTTP_201_CREATED)
async def create_task_type(
    data: DictionaryItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = DictionaryItem(dict_type="task_type", **data.model_dump(exclude={"dict_type"}))
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.put("/priorities/{item_id}", response_model=DictionaryItemResponse)
async def update_priority(
    item_id: int,
    data: DictionaryItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = db.query(DictionaryItem).filter(DictionaryItem.id == item_id, DictionaryItem.dict_type == "priority").first()
    if not item:
        raise HTTPException(status_code=404, detail="Priority not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    db.commit()
    db.refresh(item)
    return item


@router.put("/statuses/{item_id}", response_model=DictionaryItemResponse)
async def update_status(
    item_id: int,
    data: DictionaryItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = db.query(DictionaryItem).filter(DictionaryItem.id == item_id, DictionaryItem.dict_type == "status").first()
    if not item:
        raise HTTPException(status_code=404, detail="Status not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    db.commit()
    db.refresh(item)
    return item


@router.put("/task-types/{item_id}", response_model=DictionaryItemResponse)
async def update_task_type(
    item_id: int,
    data: DictionaryItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = db.query(DictionaryItem).filter(DictionaryItem.id == item_id, DictionaryItem.dict_type == "task_type").first()
    if not item:
        raise HTTPException(status_code=404, detail="Task type not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/priorities/{item_id}")
async def delete_priority(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = db.query(DictionaryItem).filter(DictionaryItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Priority not found")
    item.is_active = False
    db.commit()
    return {"message": "Priority deleted"}


@router.delete("/statuses/{item_id}")
async def delete_status(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = db.query(DictionaryItem).filter(DictionaryItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Status not found")
    item.is_active = False
    db.commit()
    return {"message": "Status deleted"}


@router.delete("/task-types/{item_id}")
async def delete_task_type(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = db.query(DictionaryItem).filter(DictionaryItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Task type not found")
    item.is_active = False
    db.commit()
    return {"message": "Task type deleted"}


@router.post("/business-customers", response_model=BusinessCustomerResponse, status_code=status.HTTP_201_CREATED)
async def create_business_customer(
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
async def update_business_customer(
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
async def get_channels(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return get_dict_items("channel", db)


@router.post("/channels", response_model=DictionaryItemResponse, status_code=status.HTTP_201_CREATED)
async def create_channel(
    data: DictionaryItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = DictionaryItem(dict_type="channel", **data.model_dump(exclude={"dict_type"}))
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.put("/channels/{item_id}", response_model=DictionaryItemResponse)
async def update_channel(
    item_id: int,
    data: DictionaryItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = db.query(DictionaryItem).filter(DictionaryItem.id == item_id, DictionaryItem.dict_type == "channel").first()
    if not item:
        raise HTTPException(status_code=404, detail="Channel not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/channels/{item_id}")
async def delete_channel(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = db.query(DictionaryItem).filter(DictionaryItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Channel not found")
    item.is_active = False
    db.commit()
    return {"message": "Channel deleted"}


@router.get("/deadlines", response_model=List[DictionaryItemResponse])
async def get_deadlines(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return get_dict_items("deadline", db)


@router.post("/deadlines", response_model=DictionaryItemResponse, status_code=status.HTTP_201_CREATED)
async def create_deadline(
    data: DictionaryItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = DictionaryItem(dict_type="deadline", **data.model_dump(exclude={"dict_type"}))
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.put("/deadlines/{item_id}", response_model=DictionaryItemResponse)
async def update_deadline(
    item_id: int,
    data: DictionaryItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = db.query(DictionaryItem).filter(DictionaryItem.id == item_id, DictionaryItem.dict_type == "deadline").first()
    if not item:
        raise HTTPException(status_code=404, detail="Deadline not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/deadlines/{item_id}")
async def delete_deadline(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = db.query(DictionaryItem).filter(DictionaryItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Deadline not found")
    item.is_active = False
    db.commit()
    return {"message": "Deadline deleted"}


@router.get("/departments", response_model=List[DictionaryItemResponse])
async def get_departments(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return get_dict_items("department", db)


@router.post("/departments", response_model=DictionaryItemResponse, status_code=status.HTTP_201_CREATED)
async def create_department(
    data: DictionaryItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = DictionaryItem(dict_type="department", **data.model_dump(exclude={"dict_type"}))
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.put("/departments/{item_id}", response_model=DictionaryItemResponse)
async def update_department(
    item_id: int,
    data: DictionaryItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = db.query(DictionaryItem).filter(DictionaryItem.id == item_id, DictionaryItem.dict_type == "department").first()
    if not item:
        raise HTTPException(status_code=404, detail="Department not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/departments/{item_id}")
async def delete_department(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = db.query(DictionaryItem).filter(DictionaryItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Department not found")
    item.is_active = False
    db.commit()
    return {"message": "Department deleted"}


@router.get("/team-types", response_model=List[DictionaryItemResponse])
async def get_team_types(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return get_dict_items("team_type", db)


@router.post("/team-types", response_model=DictionaryItemResponse, status_code=status.HTTP_201_CREATED)
async def create_team_type(
    data: DictionaryItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = DictionaryItem(dict_type="team_type", **data.model_dump(exclude={"dict_type"}))
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.put("/team-types/{item_id}", response_model=DictionaryItemResponse)
async def update_team_type(
    item_id: int,
    data: DictionaryItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = db.query(DictionaryItem).filter(DictionaryItem.id == item_id, DictionaryItem.dict_type == "team_type").first()
    if not item:
        raise HTTPException(status_code=404, detail="Team type not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/team-types/{item_id}")
async def delete_team_type(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = db.query(DictionaryItem).filter(DictionaryItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Team type not found")
    item.is_active = False
    db.commit()
    return {"message": "Team type deleted"}


@router.get("/project-statuses", response_model=List[DictionaryItemResponse])
async def get_project_statuses(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return get_dict_items("project_status", db)


@router.post("/project-statuses", response_model=DictionaryItemResponse, status_code=status.HTTP_201_CREATED)
async def create_project_status(
    data: DictionaryItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = DictionaryItem(dict_type="project_status", **data.model_dump(exclude={"dict_type"}))
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.put("/project-statuses/{item_id}", response_model=DictionaryItemResponse)
async def update_project_status(
    item_id: int,
    data: DictionaryItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = db.query(DictionaryItem).filter(DictionaryItem.id == item_id, DictionaryItem.dict_type == "project_status").first()
    if not item:
        raise HTTPException(status_code=404, detail="Project status not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/project-statuses/{item_id}")
async def delete_project_status(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    item = db.query(DictionaryItem).filter(DictionaryItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Project status not found")
    item.is_active = False
    db.commit()
    return {"message": "Project status deleted"}


# ==================== PROJECTS CRUD ====================

@router.get("/projects", response_model=List[ProjectResponse])
async def get_projects(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "read"))
):
    projects = db.query(Project).order_by(Project.created_at.desc()).all()
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
async def create_project(
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
async def update_project(
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
async def delete_project(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    project = db.query(Project).filter(Project.id == item_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    db.delete(project)
    db.commit()
    return {"message": "Project deleted"}


# ==================== NORMALIZED LOOKUP ENDPOINTS ====================

from models import TeamType as TeamTypeModel

@router.get("/team-types-ref")
async def get_team_types_ref(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    types = db.query(TeamTypeModel).order_by(TeamTypeModel.id).all()
    return [{"id": t.id, "code": t.code, "name": t.name} for t in types]


# ==================== DISPLAY SETTINGS ====================

@router.get("/display-settings", response_model=List[DisplaySettingResponse])
async def get_display_settings(
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
async def get_display_setting(
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
async def update_display_setting(
    page: str,
    data: DisplaySettingUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    pages_to_save = ['backlog_dmb', 'team_backlog'] if page == 'shared' else [page]
    saved = None
    for p in pages_to_save:
        setting = db.query(DisplaySetting).filter(DisplaySetting.page == p).first()
        if not setting:
            setting = DisplaySetting(page=p, settings=json.dumps(data.settings, ensure_ascii=False))
            db.add(setting)
            db.commit()
            db.refresh(setting)
        else:
            setting.settings = json.dumps(data.settings, ensure_ascii=False)
            db.commit()
            db.refresh(setting)
        if p == page or page == 'shared':
            saved = setting
    return DisplaySettingResponse(
        id=saved.id,
        page=page,
        settings=json.loads(saved.settings) if isinstance(saved.settings, str) else saved.settings,
        created_at=saved.created_at,
        updated_at=saved.updated_at,
    )


# ==================== COLUMN LABELS ====================

@router.get("/column-labels")
async def get_column_labels(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    labels = db.query(ColumnLabel).all()
    return {item.key: item.label for item in labels}


@router.put("/column-labels")
async def update_column_labels(
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


# ==================== NOTIFICATION TEMPLATES CRUD ====================

@router.get("/notification-templates", response_model=List[NotificationTemplateResponse])
async def get_notification_templates(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "read"))
):
    templates = db.query(NotificationTemplate).order_by(NotificationTemplate.created_at.desc()).all()
    return templates


@router.post("/notification-templates", response_model=NotificationTemplateResponse, status_code=status.HTTP_201_CREATED)
async def create_notification_template(
    data: NotificationTemplateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    template = NotificationTemplate(**data.model_dump())
    db.add(template)
    db.commit()
    db.refresh(template)
    return template


@router.put("/notification-templates/{template_id}", response_model=NotificationTemplateResponse)
async def update_notification_template(
    template_id: int,
    data: NotificationTemplateUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    template = db.query(NotificationTemplate).filter(NotificationTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Notification template not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(template, field, value)
    db.commit()
    db.refresh(template)
    return template


@router.delete("/notification-templates/{template_id}")
async def delete_notification_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    template = db.query(NotificationTemplate).filter(NotificationTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Notification template not found")
    db.delete(template)
    db.commit()
    return {"message": "Notification template deleted"}


@router.delete("/business-customers/{item_id}")
async def delete_business_customer(
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


# ==================== PROJECTS CRUD ====================

@router.get("/projects", response_model=List[ProjectResponse])
async def get_projects(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    projects = db.query(Project).order_by(Project.name).all()
    result = []
    for p in projects:
        status_name = p.status.name if p.status else None
        pl_name = p.pl.name if p.pl else None
        result.append(ProjectResponse(
            id=p.id,
            code=p.code,
            name=p.name,
            description=p.description,
            status_id=p.status_id,
            responsible_pl=p.responsible_pl,
            created_at=p.created_at,
            status_name=status_name,
            pl_name=pl_name,
        ))
    return result


@router.post("/projects", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    data: ProjectCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    existing = db.query(Project).filter(Project.code == data.code).first()
    if existing:
        raise HTTPException(status_code=400, detail="Project code already exists")
    project = Project(**data.model_dump())
    db.add(project)
    db.commit()
    db.refresh(project)
    status_name = project.status.name if project.status else None
    pl_name = project.pl.name if project.pl else None
    return ProjectResponse(
        id=project.id,
        code=project.code,
        name=project.name,
        description=project.description,
        status_id=project.status_id,
        responsible_pl=project.responsible_pl,
        created_at=project.created_at,
        status_name=status_name,
        pl_name=pl_name,
    )


@router.put("/projects/{item_id}", response_model=ProjectResponse)
async def update_project(
    item_id: int,
    data: ProjectUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    project = db.query(Project).filter(Project.id == item_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    for key, val in data.model_dump(exclude_unset=True).items():
        setattr(project, key, val)
    db.commit()
    db.refresh(project)
    status_name = project.status.name if project.status else None
    pl_name = project.pl.name if project.pl else None
    return ProjectResponse(
        id=project.id,
        code=project.code,
        name=project.name,
        description=project.description,
        status_id=project.status_id,
        responsible_pl=project.responsible_pl,
        created_at=project.created_at,
        status_name=status_name,
        pl_name=pl_name,
    )


@router.delete("/projects/{item_id}")
async def delete_project(
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
