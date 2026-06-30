from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import List

from database import get_db
from models import Team, User
from schemas import TeamCreate, TeamUpdate, TeamResponse
from auth import get_current_user, require_permission

router = APIRouter()


@router.get("/")
async def get_teams(
    page: int = Query(1, ge=1),
    per_page: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all teams with pagination"""
    query = db.query(Team)
    total = query.count()
    teams = query.offset((page - 1) * per_page).limit(per_page).all()
    result = []
    for team in teams:
        members = team.members.split(",") if team.members else []
        result.append(TeamResponse(
            id=team.id,
            name=team.name,
            color=team.color,
            domain=team.domain,
            description=team.description,
            pl=team.pl,
            po=team.po,
            cl=team.cl,
            members=team.members,
            created_at=team.created_at,
            member_count=len([m for m in members if m.strip()]) if members else 0
        ))
    return {"items": result, "total": total, "page": page, "per_page": per_page}


@router.get("/{team_id}", response_model=TeamResponse)
async def get_team(team_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Get team by ID"""
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    members = team.members.split(",") if team.members else []
    return TeamResponse(
        id=team.id,
        name=team.name,
        color=team.color,
        domain=team.domain,
        description=team.description,
        pl=team.pl,
        po=team.po,
        cl=team.cl,
        members=team.members,
        created_at=team.created_at,
        member_count=len([m for m in members if m.strip()]) if members else 0
    )


@router.post("/", response_model=TeamResponse, status_code=status.HTTP_201_CREATED)
async def create_team(
    team_data: TeamCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    """Create new team"""
    team = Team(**team_data.model_dump())
    db.add(team)
    db.commit()
    db.refresh(team)

    return TeamResponse(
        id=team.id,
        name=team.name,
        color=team.color,
        domain=team.domain,
        description=team.description,
        pl=team.pl,
        po=team.po,
        cl=team.cl,
        members=team.members,
        created_at=team.created_at,
        member_count=0
    )


@router.put("/{team_id}", response_model=TeamResponse)
async def update_team(
    team_id: int,
    team_data: TeamUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    """Update team"""
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    for field, value in team_data.model_dump(exclude_unset=True).items():
        setattr(team, field, value)

    db.commit()
    db.refresh(team)

    members = team.members.split(",") if team.members else []
    return TeamResponse(
        id=team.id,
        name=team.name,
        color=team.color,
        domain=team.domain,
        description=team.description,
        pl=team.pl,
        po=team.po,
        cl=team.cl,
        members=team.members,
        created_at=team.created_at,
        member_count=len([m for m in members if m.strip()]) if members else 0
    )


@router.delete("/{team_id}")
async def delete_team(
    team_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "full"))
):
    """Delete team"""
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    db.delete(team)
    db.commit()
    return {"message": "Team deleted"}
