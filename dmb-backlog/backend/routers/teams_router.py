from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import List

from database import get_db
from models import Team, User, TeamCompetencyResource, DictionaryItem, CompetencyCostHistory
from schemas import TeamCreate, TeamUpdate, TeamResponse, TeamCompetencyResourceResponse, CompetencyCostResponse
from auth import get_current_user, require_permission

router = APIRouter()


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
        names = _resolve_team_names(team, db)
        result.append(TeamResponse(
            id=team.id,
            name=team.name,
            color=team.color,
            domain=team.domain,
            description=team.description,
            pl=names["pl"],
            po=names["po"],
            cl=names["cl"],
            it_pl=names["it_pl"],
            pl_id=team.pl_id,
            po_id=team.po_id,
            cl_id=team.cl_id,
            it_pl_id=team.it_pl_id,
            members=team.members,
            created_at=team.created_at,
            member_count=len([m for m in members if m.strip()]) if members else 0
        ))
    return {"items": result, "total": total, "page": page, "per_page": per_page}


# ==================== TEAM RESOURCES (Экспресс-оценка) ====================

COMPETENCIES = ['Designee', 'Аналитика', 'Разработка BE', 'Разработка FE', 'Tester', 'Tester Auto']
COMPETENCY_FIELD_MAP = {
    'Designee': 'effort_designee',
    'Аналитика': 'effort_analytics',
    'Разработка BE': 'effort_be',
    'Разработка FE': 'effort_fe',
    'Tester': 'effort_test',
    'Tester Auto': 'effort_test_auto',
}


def calc_capacity(senior: int, middle: int, junior: int, working_days: int, vacation: int) -> float:
    """Calculate available capacity per competency."""
    return (
        senior * working_days * 1.3 * 0.95 +
        middle * working_days * 1.0 * 0.95 +
        junior * working_days * 0.8 * 0.95
    ) - vacation


@router.get("/competency-costs", response_model=List[CompetencyCostResponse])
async def get_competency_costs(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get current (latest-year) competency costs per day from history table."""
    items = db.query(CompetencyCostHistory).filter(
        CompetencyCostHistory.is_active == True
    ).all()
    costs = {}
    for item in items:
        costs.setdefault(item.competency, {})[item.year] = float(item.rate or 0)
    current = {comp: rates[max(rates)] for comp, rates in costs.items() if rates}
    return [CompetencyCostResponse(competency=comp, cost_per_day=current.get(comp, 0)) for comp in COMPETENCIES]


@router.get("/{team_id}", response_model=TeamResponse)
async def get_team(team_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Get team by ID"""
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    members = team.members.split(",") if team.members else []
    names = _resolve_team_names(team, db)
    return TeamResponse(
        id=team.id,
        name=team.name,
        color=team.color,
        domain=team.domain,
        description=team.description,
        pl=names["pl"],
        po=names["po"],
        cl=names["cl"],
        it_pl=names["it_pl"],
        pl_id=team.pl_id,
        po_id=team.po_id,
        cl_id=team.cl_id,
        it_pl_id=team.it_pl_id,
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

    names = _resolve_team_names(team, db)
    return TeamResponse(
        id=team.id,
        name=team.name,
        color=team.color,
        domain=team.domain,
        description=team.description,
        pl=names["pl"],
        po=names["po"],
        cl=names["cl"],
        it_pl=names["it_pl"],
        pl_id=team.pl_id,
        po_id=team.po_id,
        cl_id=team.cl_id,
        it_pl_id=team.it_pl_id,
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
    names = _resolve_team_names(team, db)
    return TeamResponse(
        id=team.id,
        name=team.name,
        color=team.color,
        domain=team.domain,
        description=team.description,
        pl=names["pl"],
        po=names["po"],
        cl=names["cl"],
        it_pl=names["it_pl"],
        pl_id=team.pl_id,
        po_id=team.po_id,
        cl_id=team.cl_id,
        it_pl_id=team.it_pl_id,
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


@router.get("/{team_id}/resources", response_model=List[TeamCompetencyResourceResponse])
async def get_team_resources(
    team_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get available team resources by competency for express estimation."""
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    results = []
    for comp in COMPETENCIES:
        res = db.query(TeamCompetencyResource).filter(
            TeamCompetencyResource.team_id == team_id,
            TeamCompetencyResource.competency == comp
        ).first()

        if res:
            capacity = calc_capacity(res.senior_count, res.middle_count, res.junior_count, res.working_days, res.vacation_days)
            results.append(TeamCompetencyResourceResponse(
                competency=comp,
                capacity=round(capacity, 1),
                senior_count=res.senior_count,
                middle_count=res.middle_count,
                junior_count=res.junior_count,
                vacation_days=res.vacation_days,
                working_days=res.working_days,
            ))
        else:
            results.append(TeamCompetencyResourceResponse(
                competency=comp,
                capacity=0,
                senior_count=0,
                middle_count=0,
                junior_count=0,
                vacation_days=0,
                working_days=66,
            ))

    return results


@router.put("/{team_id}/resources", response_model=List[TeamCompetencyResourceResponse])
async def update_team_resources(
    team_id: int,
    resources: List[dict],
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    """Update team resources by competency."""
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    for res_data in resources:
        comp = res_data.get('competency')
        if comp not in COMPETENCIES:
            continue

        existing = db.query(TeamCompetencyResource).filter(
            TeamCompetencyResource.team_id == team_id,
            TeamCompetencyResource.competency == comp
        ).first()

        if existing:
            existing.senior_count = res_data.get('senior_count', existing.senior_count)
            existing.middle_count = res_data.get('middle_count', existing.middle_count)
            existing.junior_count = res_data.get('junior_count', existing.junior_count)
            existing.vacation_days = res_data.get('vacation_days', existing.vacation_days)
            existing.working_days = res_data.get('working_days', existing.working_days)
        else:
            new_res = TeamCompetencyResource(
                team_id=team_id,
                competency=comp,
                senior_count=res_data.get('senior_count', 0),
                middle_count=res_data.get('middle_count', 0),
                junior_count=res_data.get('junior_count', 0),
                vacation_days=res_data.get('vacation_days', 0),
                working_days=res_data.get('working_days', 66),
            )
            db.add(new_res)

    db.commit()

    # Return updated resources
    return await get_team_resources(team_id, db, current_user)
