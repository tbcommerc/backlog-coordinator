"""
DMB Backlog - SQLAlchemy Models (normalized)
"""
from sqlalchemy import (
    Column, Integer, String, Text, Boolean, DateTime, Date,
    ForeignKey, Enum, DECIMAL, JSON, Float
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base
import enum


class PriorityEnum(str, enum.Enum):
    HIGH = "ВЫСОКИЙ"
    MEDIUM = "СРЕДНИЙ"
    LOW = "НИЗКИЙ"


class StatusEnum(str, enum.Enum):
    NEW = "НОВАЯ ЗАДАЧА"
    TEAM_ASSIGNED = "НАЗНАЧЕНА КОМАНДА"
    COLLECT = "СБОР ТРЕБОВАНИЙ"
    CHECK_REQUIREMENTS = "ПРОВЕРКА ТРЕБОВАНИЙ"
    CLARIFY_REQUIREMENTS = "УТОЧНЕНИЕ ТРЕБОВАНИЙ"
    ESTIMATE = "ЭКСПРЕСС-ОЦЕНКА"
    DECISION = "ПРИНЯТИЕ РЕШЕНИЯ"
    WORK = "ПРИНЯТА В РАБОТУ"
    REJECTED = "ОТКЛОНЕНА"
    NOT_RELEVANT = "НЕ АКТУАЛЬНА"
    DONE = "ВЫПОЛНЕНА"
    ESCALATION = "ЭСКАЛАЦИЯ НА ЛТ"
    HOLD = "ХОЛД"


class RoleStatusEnum(str, enum.Enum):
    ACTIVE = "active"
    IN_DEV = "in_dev"
    ARCHIVED = "archived"


# ==================== LOOKUP TABLES ====================

class Channel(Base):
    __tablename__ = "channels"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(50), unique=True, nullable=False)
    name = Column(String(100), nullable=False)


class Deadline(Base):
    __tablename__ = "deadlines"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(50), unique=True, nullable=False)
    name = Column(String(100), nullable=False)


class Department(Base):
    __tablename__ = "departments"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(50), unique=True, nullable=False)
    name = Column(String(255), nullable=False)


class Priority(Base):
    __tablename__ = "priorities"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), nullable=False)
    sla_multiplier = Column(Float, nullable=True)


class TaskType(Base):
    __tablename__ = "task_types"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(50), unique=True, nullable=False)
    name = Column(String(100), nullable=False)
    dod_required = Column(Boolean, default=False)
    financial_value_required = Column(Boolean, default=False)


class TeamType(Base):
    __tablename__ = "team_types"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(50), unique=True, nullable=False)
    name = Column(String(100), nullable=False)


class ProjectStatus(Base):
    __tablename__ = "project_statuses"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(50), unique=True, nullable=False)
    name = Column(String(100), nullable=False)


class BusinessCustomer(Base):
    __tablename__ = "business_customers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    department = relationship("Department")


class TaskStatus(Base):
    __tablename__ = "statuses"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(50), unique=True, nullable=False)
    name = Column(String(100), nullable=False)
    group = Column(String(50), nullable=True)
    sla_hours = Column(Integer, nullable=True)
    sort_order = Column(Integer, default=0)
    color = Column(String(20), nullable=True)


# ==================== CORE TABLES ====================

class Team(Base):
    __tablename__ = "teams"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False)
    team_type_id = Column(Integer, ForeignKey("team_types.id"), nullable=True)
    color = Column(String(20), default="indigo")
    domain = Column(String(200), nullable=True)
    description = Column(Text, nullable=True)
    pl = Column(String(100), nullable=True)
    po = Column(String(100), nullable=True)
    cl = Column(String(100), nullable=True)
    it_pl = Column(String(100), nullable=True)
    pl_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    po_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    cl_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    it_pl_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    abbr = Column(String(10), nullable=True)
    members = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    team_type = relationship("TeamType")
    tasks = relationship("Task", back_populates="team")
    users = relationship("User", back_populates="team_rel", foreign_keys="User.team_id")
    pl_user = relationship("User", foreign_keys=[pl_id], post_update=True)
    po_user = relationship("User", foreign_keys=[po_id], post_update=True)
    cl_user = relationship("User", foreign_keys=[cl_id], post_update=True)
    it_pl_user = relationship("User", foreign_keys=[it_pl_id], post_update=True)


class Role(Base):
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), unique=True, nullable=False)
    status = Column(String(20), default="active")
    description = Column(Text, nullable=True)
    backlog_dmb_access = Column(String(20), default="read")
    backlog_team_access = Column(String(20), default="read_own")
    reports_access = Column(String(20), default="read")
    analytics_access = Column(String(20), default="read")
    customer_access = Column(String(20), default="read")
    settings_access = Column(String(20), default="available")
    admin_access = Column(String(20), default="none")
    can_edit_tasks = Column(Boolean, default=True)
    can_delete_tasks = Column(Boolean, default=False)
    can_export = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    users = relationship("User", back_populates="role")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    login = Column(String(50), nullable=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    name = Column(String(100), nullable=False)
    position = Column(String(100), nullable=True)
    team_id = Column(Integer, ForeignKey("teams.id"), nullable=True)
    role_id = Column(Integer, ForeignKey("roles.id"), nullable=True)
    can_edit = Column(Boolean, default=True)
    can_delete = Column(Boolean, default=False)
    can_export = Column(Boolean, default=True)
    is_active = Column(Boolean, default=True)
    last_login = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    role = relationship("Role", back_populates="users")
    team_rel = relationship("Team", back_populates="users", foreign_keys=[team_id])

    @property
    def team_name(self):
        return self.team_rel.name if self.team_rel else None

    @property
    def role_name(self):
        return self.role.name if self.role else None


class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(50), unique=True, nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    status_id = Column(Integer, ForeignKey("project_statuses.id"), nullable=True)
    responsible_pl = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    status = relationship("ProjectStatus")
    pl = relationship("User")


class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    team_id = Column(Integer, ForeignKey("teams.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    date_received = Column(Date, nullable=True)
    channel_id = Column(Integer, ForeignKey("channels.id"), nullable=True)
    business_customer = Column(String(200), nullable=True)
    business_customer_id = Column(Integer, ForeignKey("business_customers.id"), nullable=True)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=True)
    task_type_id = Column(Integer, ForeignKey("task_types.id"), nullable=True)
    involved_teams = Column(JSON, nullable=True, comment='Другие вовлечённые команды (массив id команд)')
    priority_id = Column(Integer, ForeignKey("priorities.id"), nullable=True)
    status_id = Column(Integer, ForeignKey("statuses.id"), nullable=True)
    deadline_id = Column(Integer, ForeignKey("deadlines.id"), nullable=True)
    effort_days = Column(Integer, nullable=True)
    effort_rub = Column(Float, nullable=True)
    effort_designee = Column(Float, nullable=True, comment='Designee (дни)')
    effort_analytics = Column(Float, nullable=True, comment='Аналитика (дни)')
    effort_be = Column(Float, nullable=True, comment='Разработка BE (дни)')
    effort_python_be = Column(Float, nullable=True, comment='Разработка python BE (дни)')
    effort_fe = Column(Float, nullable=True, comment='Разработка FE (дни)')
    effort_test = Column(Float, nullable=True, comment='Tester (дни)')
    effort_test_auto = Column(Float, nullable=True, comment='Tester Auto (дни)')
    effort_delivery = Column(Float, nullable=True, comment='Delivery (дни)')
    actual_effort_days = Column(Float, nullable=True, comment='Фактические трудозатраты (ч/д)')
    actual_effort_designee = Column(Float, nullable=True, comment='Designee (ФТЗ)')
    actual_effort_analytics = Column(Float, nullable=True, comment='Аналитика (ФТЗ)')
    actual_effort_be = Column(Float, nullable=True, comment='Разработка BE (ФТЗ)')
    actual_effort_fe = Column(Float, nullable=True, comment='Разработка FE (ФТЗ)')
    actual_effort_test = Column(Float, nullable=True, comment='Test (ФТЗ)')
    actual_effort_test_auto = Column(Float, nullable=True, comment='Test Auto (ФТЗ)')
    financial_effect_justification = Column(Text, nullable=True, comment='Обоснование по расчету финансового эффекта')
    financial_effect = Column(Float, nullable=True)
    cv = Column(Float, nullable=True)
    ice_score = Column(Float, nullable=True)
    ice_impact = Column(Float, nullable=True, comment='ICE: Impact (1-10)')
    ice_confidence = Column(Float, nullable=True, comment='ICE: Confidence (1-10)')
    ice_ease = Column(Float, nullable=True, comment='ICE: Ease (1-10)')
    progress = Column(Integer, default=0)
    what_if = Column(Text, nullable=True)
    dod = Column(Text, nullable=True)
    link_mockups = Column(String(500), nullable=True)
    link_jira = Column(JSON, nullable=True, comment='Ссылки на Jira (массив ссылок)')
    rejection_reason = Column(Text, nullable=True)
    comment = Column(Text, nullable=True)
    status_comment = Column(Text, nullable=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    responsible_po_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    business_analyst_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    it_product_lead_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    key_project = Column(Boolean, default=False, index=True)
    key_project_status = Column(String(50), nullable=True)
    key_project_status_updated_at = Column(DateTime(timezone=True), nullable=True, comment='Дата изменения статуса для встречи по ключевым проектам')
    directorate_status = Column(Text, nullable=True)
    directorate_status_updated_at = Column(DateTime(timezone=True), nullable=True)
    did_status = Column(Text, nullable=True)
    did_status_updated_at = Column(DateTime(timezone=True), nullable=True)
    did_demo = Column(Boolean, default=False, comment='Демо для ДИД')
    metric_kr_plan = Column(Float, nullable=True, comment='Значение для метрического KR (план)')
    metric_kr_fact = Column(Float, nullable=True, comment='Значение для метрического KR (факт)')
    is_from_leadership = Column(Boolean, default=False)
    is_regular = Column(Boolean, default=False)
    last_updated = Column(Date, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    is_deleted = Column(Boolean, default=False, index=True)
    version = Column(Integer, default=0, comment='Версия задачи (optimistic lock)')
    lock_owner_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    lock_until = Column(DateTime(timezone=True), nullable=True)

    team = relationship("Team", back_populates="tasks")
    channel = relationship("Channel")
    business_customer_rel = relationship("BusinessCustomer")
    department = relationship("Department")
    project = relationship("Project")
    task_type = relationship("TaskType")
    priority = relationship("Priority")
    status = relationship("TaskStatus")
    deadline = relationship("Deadline", foreign_keys=[deadline_id])
    owner = relationship("User", foreign_keys=[owner_id])
    responsible_po = relationship("User", foreign_keys=[responsible_po_id])
    business_analyst = relationship("User", foreign_keys=[business_analyst_id])
    it_product_lead = relationship("User", foreign_keys=[it_product_lead_id])
    lock_owner = relationship("User", foreign_keys=[lock_owner_id])
    creator = relationship("User", foreign_keys=[created_by])
    history = relationship("TaskHistory", back_populates="task")
    comments = relationship("TaskComment", back_populates="task", cascade="all, delete-orphan")
    attachments = relationship("TaskAttachment", back_populates="task", cascade="all, delete-orphan")
    epics = relationship("Epic", back_populates="task", cascade="all, delete-orphan")


class Epic(Base):
    __tablename__ = "epics"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    priority = Column(String(50), nullable=True, comment='Приоритет эпика')
    effort_designee = Column(Float, nullable=True, comment='Designee (дни)')
    effort_analytics = Column(Float, nullable=True, comment='Аналитика (дни)')
    effort_be = Column(Float, nullable=True, comment='Разработка BE (дни)')
    effort_python_be = Column(Float, nullable=True, comment='Разработка python BE (дни)')
    effort_fe = Column(Float, nullable=True, comment='Разработка FE (дни)')
    effort_test = Column(Float, nullable=True, comment='Tester (дни)')
    effort_test_auto = Column(Float, nullable=True, comment='Tester Auto (дни)')
    effort_delivery = Column(Float, nullable=True, comment='Delivery (дни)')
    sort_order = Column(Integer, default=0, comment='Порядок сортировки')
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    task = relationship("Task", back_populates="epics")
    stories = relationship("Story", back_populates="epic", cascade="all, delete-orphan")


class Story(Base):
    __tablename__ = "stories"

    id = Column(Integer, primary_key=True, index=True)
    epic_id = Column(Integer, ForeignKey("epics.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    progress = Column(Integer, default=0, comment='Прогресс: 0, 50, 100')
    effort_designee = Column(Float, nullable=True, comment='Designee (дни)')
    effort_analytics = Column(Float, nullable=True, comment='Аналитика (дни)')
    effort_be = Column(Float, nullable=True, comment='Разработка BE (дни)')
    effort_python_be = Column(Float, nullable=True, comment='Разработка python BE (дни)')
    effort_fe = Column(Float, nullable=True, comment='Разработка FE (дни)')
    effort_test = Column(Float, nullable=True, comment='Tester (дни)')
    effort_test_auto = Column(Float, nullable=True, comment='Tester Auto (дни)')
    effort_delivery = Column(Float, nullable=True, comment='Delivery (дни)')
    sort_order = Column(Integer, default=0, comment='Порядок сортировки')
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    epic = relationship("Epic", back_populates="stories")


class DisplaySetting(Base):
    __tablename__ = "display_settings"

    id = Column(Integer, primary_key=True, index=True)
    page = Column(String(50), unique=True, nullable=False)
    settings = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ColumnLabel(Base):
    __tablename__ = "column_labels"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(50), unique=True, nullable=False, index=True)
    label = Column(String(200), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class FieldLabel(Base):
    __tablename__ = "field_labels"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(50), unique=True, nullable=False, index=True)
    label = Column(String(200), nullable=False, comment='Точное русское название поля для отображения на фронте')
    group = Column(String(50), nullable=True, comment='Группа полей (основные/трудозатраты/статусы/прочее)')
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class TaskHistory(Base):
    __tablename__ = "task_history"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=False)
    changed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    changed_at = Column(DateTime(timezone=True), server_default=func.now())
    field_name = Column(String(50), nullable=False)
    old_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=True)

    task = relationship("Task", back_populates="history")


class TaskViewer(Base):
    __tablename__ = "task_viewers"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    last_seen_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User")
    task = relationship("Task")


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=True)
    category = Column(String(50), nullable=False, default="system")
    title = Column(String(300), nullable=False)
    body = Column(Text, nullable=True)
    importance = Column(String(20), default="medium")
    is_read = Column(Boolean, default=False)
    is_dismissed = Column(Boolean, default=False)
    action_url = Column(String(200), nullable=True)
    group_key = Column(String(100), nullable=True)
    group_count = Column(Integer, default=1)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    read_at = Column(DateTime(timezone=True), nullable=True)

    user = relationship("User")


class Report(Base):
    __tablename__ = "reports"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    type = Column(String(20), default="custom")
    key = Column(String(100), nullable=True, index=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    filters = Column(Text, nullable=True)
    fields = Column(Text, nullable=True)
    group_by = Column(String(50), nullable=True)
    sort_by = Column(String(50), nullable=True)
    sort_order = Column(String(4), default="asc")
    is_public = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class DictionaryItem(Base):
    __tablename__ = "dictionary_items"

    id = Column(Integer, primary_key=True, index=True)
    dict_type = Column(String(50), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    code = Column(String(50), nullable=True)
    color = Column(String(20), nullable=True)
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    version = Column(Integer, default=0, comment='Версия справочника (optimistic lock)')
    lock_owner_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    lock_until = Column(DateTime(timezone=True), nullable=True)

    lock_owner = relationship("User", foreign_keys=[lock_owner_id])


class UserNotificationPreference(Base):
    __tablename__ = "user_notification_preferences"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    preferences = Column(Text, nullable=False, default='{}')
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class TaskComment(Base):
    __tablename__ = "task_comments"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    parent_id = Column(Integer, ForeignKey("task_comments.id"), nullable=True, index=True)
    text = Column(Text, nullable=False)
    mentioned_user_ids = Column(Text, nullable=True, comment='JSON array of mentioned user IDs')
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    task = relationship("Task", back_populates="comments")
    user = relationship("User")
    parent = relationship("TaskComment", remote_side="TaskComment.id", back_populates="replies")
    replies = relationship("TaskComment", back_populates="parent", cascade="all, delete-orphan")


class TaskAttachment(Base):
    __tablename__ = "task_attachments"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    filename = Column(String(255), nullable=False)
    original_name = Column(String(255), nullable=False)
    mime_type = Column(String(100), nullable=True)
    file_size = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    task = relationship("Task", back_populates="attachments")
    user = relationship("User")


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    action = Column(String(50), nullable=False)
    entity_type = Column(String(50), nullable=False)
    entity_id = Column(Integer, nullable=True)
    details = Column(Text, nullable=True)
    ip_address = Column(String(45), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# ==================== JUNCTION TABLES ====================

class Tag(Base):
    __tablename__ = "tags"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    color = Column(String(20), nullable=True)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    creator = Column(Integer, ForeignKey("users.id"), nullable=True)


class IssueTag(Base):
    __tablename__ = "issue_tags"

    id = Column(Integer, primary_key=True, index=True)
    issue_id = Column(Integer, ForeignKey("tasks.id"), nullable=False)
    tag_id = Column(Integer, ForeignKey("tags.id"), nullable=False)


class ProjectTag(Base):
    __tablename__ = "project_tags"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    tag_id = Column(Integer, ForeignKey("tags.id"), nullable=False)


class TeamCompetencyResource(Base):
    __tablename__ = "team_competency_resources"

    id = Column(Integer, primary_key=True, index=True)
    team_id = Column(Integer, ForeignKey("teams.id"), nullable=False, index=True)
    competency = Column(String(50), nullable=False, comment='Компетенция')
    senior_count = Column(Integer, default=0, comment='Кол-во Senior')
    middle_count = Column(Integer, default=0, comment='Кол-во Middle')
    junior_count = Column(Integer, default=0, comment='Кол-во Junior')
    vacation_days = Column(Integer, default=0, comment='Дни отпуска')
    working_days = Column(Integer, default=66, comment='Рабочие дни в квартале')
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class TimelineEvent(Base):
    __tablename__ = "timeline_events"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(300), nullable=False)
    description = Column(Text, nullable=True)
    event_type = Column(String(50), default="event")
    color = Column(String(20), default="#6366f1")
    date = Column(Date, nullable=False)
    quarter = Column(Integer, nullable=True)
    month = Column(Integer, nullable=True)
    year = Column(Integer, nullable=False)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=True)
    is_recurring = Column(Boolean, default=False)
    recurring_interval = Column(String(20), nullable=True)
    visibility_level = Column(String(20), default="team")
    creator_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    project = relationship("Project")
    creator = relationship("User", foreign_keys=[creator_id])
