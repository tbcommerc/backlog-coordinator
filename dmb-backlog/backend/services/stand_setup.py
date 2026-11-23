"""Explicit first-install operations. Never called from application startup."""
from fastapi import HTTPException
from sqlalchemy import text

from models import User, Role, Team, Task, Project, DictionaryItem, LoginReservation
from services import auth_sessions as sessions, auth_challenges as challenges
from services.credentials import normalize_login
from services.reference_catalog import REFERENCE_MODELS, synchronize_references, lock_catalog
from config import settings


ADMIN_PERMISSIONS = {
    "backlog_dmb_access": "read_write", "backlog_team_access": "write_all",
    "reports_access": "read_write", "analytics_access": "read_write",
    "customer_access": "read_write", "settings_access": "available", "admin_access": "full",
    "customer_portal_only": False, "review_access": "all", "task_edit_scope": "all",
    "task_comment_scope": "all", "task_delete_scope": "all", "pip_decision_access": True,
    "can_edit_tasks": True, "can_delete_tasks": True, "can_export": True,
}

# A small, reviewable demonstration dataset; no private snapshot or legacy seed.
# Workflow codes remain compatible with task transitions.
DEMO_DICTIONARIES = {
    "priority": [("ВЫСОКИЙ", "high"), ("СРЕДНИЙ", "medium"), ("НИЗКИЙ", "low")],
    "status": [("НОВАЯ ЗАДАЧА", "new"), ("НАЗНАЧЕНА КОМАНДА", "team_assigned"),
        ("СБОР ТРЕБОВАНИЙ", "requirements"), ("ПРОВЕРКА ТРЕБОВАНИЙ", "check_requirements"),
        ("УТОЧНЕНИЕ ТРЕБОВАНИЙ", "clarify_requirements"),
        ("ЭКСПРЕСС-ОЦЕНКА", "quick_estimate"), ("ПРИНЯТИЕ РЕШЕНИЯ", "decision"),
        ("ПРИНЯТА В РАБОТУ", "in_progress"), ("ВЫПОЛНЕНА", "done"),
        ("ОТКЛОНЕНА", "rejected"), ("НЕ АКТУАЛЬНА", "irrelevant"),
        ("ЭСКАЛАЦИЯ НА ЛТ", "escalation"), ("ХОЛД", "hold")],
    "task_type": [("AD-HOC", "adhoc"), ("ТЕХДОЛГ", "tech_debt"), ("ИССЛЕДОВАНИЕ", "research"),
        ("КВАРТАЛЬНАЯ/ГОДОВАЯ ЦЕЛЬ", "quarterly_goal"), ("МЕТРИЧЕСКИЕ KR", "metric_kr")],
    "channel": [("Встреча/Звонок", "meeting_call"), ("Почта", "email")],
    "deadline": [("БЕЗ СРОКА", "no_deadline")],
    "team_type": [("С разработкой", "with_dev")],
    "project_status": [("Активен", "active")],
}


def bootstrap_admin(db, login, name, reason, demo_data=False):
    """Create the FIRST account and return a one-time activation code.

    Refuse populated user databases, including partial/manual deployments. This
    command cannot become a way to grant additional administrative accounts.
    The caller must commit before showing the activation code.
    """
    login = normalize_login(login)
    name = (name or "").strip()
    if not name or len(name) > 100:
        raise HTTPException(422, "ADMIN_NAME_INVALID")
    if not reason or not reason.strip():
        raise HTTPException(422, "OPERATOR_REASON_REQUIRED")
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(761204120)"))
        db.execute(text("LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE"))
    if db.query(User).count() or db.query(LoginReservation).count():
        raise HTTPException(409, "FIRST_ADMIN_REQUIRES_EMPTY_USERS")
    role_name = "Администратор стенда"
    if db.query(Role).filter_by(name=role_name).first():
        raise HTTPException(409, "BOOTSTRAP_ROLE_ALREADY_EXISTS")
    if demo_data:
        lock_catalog(db)
        tables = [Team, Task, Project, DictionaryItem, *REFERENCE_MODELS.values()]
        if any(db.query(model).count() for model in tables):
            raise HTTPException(409, "DEMO_DATA_REQUIRES_EMPTY_CATALOG_AND_WORKSPACE")
    role = Role(name=role_name, description="Первоначальная настройка стенда", **ADMIN_PERMISSIONS)
    db.add(role)
    db.flush()
    user = User(name=name, login=login, login_normalized=login, role_id=role.id,
        credential_state="invited", is_active=True, auth_version=1,
        can_edit=True, can_delete=True, can_export=True)
    db.add(user)
    db.flush()
    db.add(LoginReservation(login_normalized=login, user_id=user.id))
    if demo_data:
        _demo_data(db, user)
    result = challenges.issue(db, user, "invitation", settings.AUTH_INVITE_MINUTES)
    sessions.event(db, "bootstrap_admin", subject=user.id, reason=reason)
    return user, result


def _demo_data(db, user):
    for dict_type, values in DEMO_DICTIONARIES.items():
        for order, (name, code) in enumerate(values):
            db.add(DictionaryItem(dict_type=dict_type, name=name, code=code,
                sort_order=order, is_active=True))
        synchronize_references(db, dict_type)
    def ref(kind, code):
        return db.query(DictionaryItem).filter_by(dict_type=kind, code=code).one().reference_id
    team = Team(name="Демонстрационная команда", team_type_id=ref("team_type", "with_dev"))
    db.add(team)
    db.flush()
    user.team_id = team.id
    project = Project(code="DEMO", name="Демонстрационный проект", status_id=ref("project_status", "active"))
    db.add(project)
    db.flush()
    db.add(Task(title="Пример задачи для демонстрации", description="Синтетические данные. Можно изменить или создать свою задачу.",
        team_id=team.id, project_id=project.id, priority_id=ref("priority", "medium"),
        status_id=ref("status", "new"), task_type_id=ref("task_type", "adhoc"),
        channel_id=ref("channel", "meeting_call"), deadline_id=ref("deadline", "no_deadline"), created_by=user.id))
    db.flush()


def configure_admin_access(db, user_id, reason):
    """Explicit operator grant to ONE approved account; never edit a shared role."""
    if not reason or not reason.strip():
        raise HTTPException(422, "OPERATOR_REASON_REQUIRED")
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(761204120)"))
    user = sessions.lock_user(db, user_id)
    if user is None or not user.is_active:
        raise HTTPException(409, "ACTIVE_EXISTING_USER_REQUIRED")
    role_name = f"Администратор стенда {user.id}"
    role = db.query(Role).filter_by(name=role_name).first()
    if role is not None and any(getattr(role, key) != value for key, value in ADMIN_PERMISSIONS.items()):
        raise HTTPException(409, "OPERATOR_ADMIN_ROLE_CONFLICT")
    if role is None:
        role = Role(name=role_name, description="Явно назначенные оператором полномочия", **ADMIN_PERMISSIONS)
        db.add(role)
        db.flush()
    user.role = role
    user.can_edit = user.can_delete = user.can_export = True
    sessions.invalidate(db, user, "operator_admin_access")
    sessions.event(db, "configure_admin_access", subject=user.id, reason=reason)
    return user
