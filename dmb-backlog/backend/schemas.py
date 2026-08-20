from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import Optional, List, Dict, Any, Literal
from datetime import datetime, date
from urllib.parse import urlsplit


def _validate_external_url(value: Optional[str]) -> Optional[str]:
    """Разрешить только абсолютные HTTP(S) URL."""
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    parsed = urlsplit(value)
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Ссылка должна быть абсолютным URL с протоколом http:// или https://")
    return value


def _validate_external_url_list(values: Optional[List[str]]) -> Optional[List[str]]:
    if values is None:
        return None
    return [_validate_external_url(value) for value in values]


# ==================== AUTH ====================

class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: dict


# ==================== USER ====================

class UserBase(BaseModel):
    login: Optional[str] = Field(None, max_length=50)
    email: EmailStr
    name: str = Field(max_length=100)
    position: Optional[str] = Field(None, max_length=100)
    team_id: Optional[int] = None
    role_id: Optional[int] = None
    business_customer_id: Optional[int] = None
    is_active: bool = True


class UserCreate(UserBase):
    password: str = Field(default="dmb2026", max_length=128)
    can_edit: bool = True
    can_delete: bool = False
    can_export: bool = True


class UserUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=100)
    login: Optional[str] = Field(None, max_length=50)
    email: Optional[str] = None
    position: Optional[str] = Field(None, max_length=100)
    team_id: Optional[int] = None
    role_id: Optional[int] = None
    business_customer_id: Optional[int] = None
    is_active: Optional[bool] = None
    can_edit: Optional[bool] = None
    can_delete: Optional[bool] = None
    can_export: Optional[bool] = None


class UserResponse(UserBase):
    id: int
    last_login: Optional[datetime] = None
    created_at: datetime
    role_name: Optional[str] = None
    team_name: Optional[str] = None
    business_customer_name: Optional[str] = None
    can_edit: bool = True
    can_delete: bool = False
    can_export: bool = True

    class Config:
        from_attributes = True


# ==================== TEAM ====================

class TeamBase(BaseModel):
    name: str = Field(max_length=100)
    team_type_id: Optional[int] = None
    color: str = Field(default="indigo", max_length=20)
    domain: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = Field(None, max_length=2000)
    pl: Optional[str] = Field(None, max_length=100)
    po: Optional[str] = Field(None, max_length=100)
    cl: Optional[str] = Field(None, max_length=100)
    it_pl: Optional[str] = Field(None, max_length=100)
    pl_id: Optional[int] = None
    po_id: Optional[int] = None
    cl_id: Optional[int] = None
    it_pl_id: Optional[int] = None
    abbr: Optional[str] = Field(None, max_length=10)
    members: Optional[str] = Field(None, max_length=5000)


class TeamCreate(TeamBase):
    pass


class TeamUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=100)
    team_type_id: Optional[int] = None
    color: Optional[str] = Field(None, max_length=20)
    domain: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = Field(None, max_length=2000)
    pl: Optional[str] = Field(None, max_length=100)
    po: Optional[str] = Field(None, max_length=100)
    cl: Optional[str] = Field(None, max_length=100)
    it_pl: Optional[str] = Field(None, max_length=100)
    pl_id: Optional[int] = None
    po_id: Optional[int] = None
    cl_id: Optional[int] = None
    it_pl_id: Optional[int] = None
    abbr: Optional[str] = Field(None, max_length=10)
    members: Optional[str] = Field(None, max_length=5000)


class TeamResponse(TeamBase):
    id: int
    created_at: datetime
    member_count: int = 0

    class Config:
        from_attributes = True


# ==================== ROLE ====================

class RoleBase(BaseModel):
    name: str = Field(max_length=50)
    status: str = Field(default="active", max_length=20)
    description: Optional[str] = Field(None, max_length=2000)
    backlog_dmb_access: str = Field(default="read", max_length=20)
    backlog_team_access: str = Field(default="read_own", max_length=20)
    reports_access: str = Field(default="read", max_length=20)
    analytics_access: str = Field(default="read", max_length=20)
    customer_access: str = Field(default="read", max_length=20)
    settings_access: str = Field(default="available", max_length=20)
    admin_access: str = Field(default="none", max_length=20)
    can_edit_tasks: bool = True
    can_delete_tasks: bool = False
    can_export: bool = True


class RoleCreate(RoleBase):
    pass


class RoleUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=50)
    status: Optional[str] = Field(None, max_length=20)
    description: Optional[str] = Field(None, max_length=2000)
    backlog_dmb_access: Optional[str] = Field(None, max_length=20)
    backlog_team_access: Optional[str] = Field(None, max_length=20)
    reports_access: Optional[str] = Field(None, max_length=20)
    analytics_access: Optional[str] = Field(None, max_length=20)
    customer_access: Optional[str] = Field(None, max_length=20)
    settings_access: Optional[str] = Field(None, max_length=20)
    admin_access: Optional[str] = Field(None, max_length=20)
    can_edit_tasks: Optional[bool] = None
    can_delete_tasks: Optional[bool] = None
    can_export: Optional[bool] = None


class RoleResponse(RoleBase):
    id: int
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ==================== TASK ====================

class TaskBase(BaseModel):
    team_id: int
    title: str = Field(max_length=255)
    description: Optional[str] = Field(None, max_length=10000)
    date_received: Optional[date] = None
    channel_id: Optional[int] = None
    business_customer_id: Optional[int] = None
    department_id: Optional[int] = None
    project_id: Optional[int] = None
    task_type_id: Optional[int] = None
    involved_teams: Optional[List[int]] = Field(None, description='Другие вовлечённые команды (массив id команд)')
    priority_id: Optional[int] = None
    status_id: Optional[int] = None
    deadline_id: Optional[int] = None
    effort_days: Optional[int] = Field(None, ge=0, le=10000)
    effort_rub: Optional[float] = Field(None, ge=0)
    effort_designee: Optional[float] = None
    effort_analytics: Optional[float] = None
    effort_be: Optional[float] = None
    effort_python_be: Optional[float] = None
    effort_fe: Optional[float] = None
    effort_test: Optional[float] = None
    effort_test_auto: Optional[float] = None
    effort_delivery: Optional[float] = None
    actual_effort_days: Optional[float] = None
    actual_effort_designee: Optional[float] = None
    actual_effort_analytics: Optional[float] = None
    actual_effort_be: Optional[float] = None
    actual_effort_python_be: Optional[float] = None
    actual_effort_fe: Optional[float] = None
    actual_effort_test: Optional[float] = None
    actual_effort_test_auto: Optional[float] = None
    actual_effort_delivery: Optional[float] = None
    financial_effect: Optional[float] = Field(None, ge=0)
    financial_effect_justification: Optional[str] = Field(None, max_length=10000)
    financial_effect_ai: Optional[float] = Field(None, ge=0, description='AI-расчёт финансового эффекта (руб)')
    financial_effect_ai_justification: Optional[str] = Field(None, max_length=10000, description='Обоснование AI-расчёта финансового эффекта')
    priority_score: Optional[int] = Field(None, ge=0, le=100, description='Priority Score (рейтинг 0-100)')
    priority_justification: Optional[str] = Field(None, max_length=10000, description='Обоснование Priority Score')
    assessment_weight: Optional[float] = Field(None, ge=0, le=100, description='Вес оценки (%)')
    completion_forecast: Optional[float] = Field(None, ge=0, le=100, description='Прогноз выполнения (%)')
    hard_score: Optional[str] = Field(None, max_length=1, pattern='^[A-E]$', description='Оценка за завершенность (Hard)')
    soft_score: Optional[str] = Field(None, max_length=1, pattern='^[A-E]$', description='Оценка за взаимодействие (Soft)')
    progress: int = Field(default=0, ge=0, le=100)
    link_mockups: Optional[str] = Field(None, max_length=500)
    link_jira: Optional[List[str]] = Field(None, description='Ссылки на Jira (массив)')
    link_requirements: Optional[List[str]] = Field(None, description='Ссылки на бизнес-требования (массив)')
    rejection_reason: Optional[str] = Field(None, max_length=5000)
    comment: Optional[str] = Field(None, max_length=5000)
    owner_id: Optional[int] = None
    key_project_status: Optional[str] = None
    key_project_status_updated_at: Optional[datetime] = None
    prev_key_project_status: Optional[str] = None
    directorate_status: Optional[str] = Field(None, max_length=1000)
    directorate_status_updated_at: Optional[datetime] = None
    prev_directorate_status: Optional[str] = None
    did_status: Optional[str] = Field(None, max_length=1000)
    did_status_updated_at: Optional[datetime] = None
    prev_did_status: Optional[str] = None
    metric_kr_plan: Optional[float] = None
    metric_kr_fact: Optional[float] = None
    metric_kr_unit: Optional[str] = Field(None, max_length=50, description='Единица измерения Метрического KR')
    did_demo: bool = False
    tags: Optional[List[str]] = Field(None, description='Метки (теги) — имена тегов')

    @field_validator('link_jira', mode='before')
    @classmethod
    def _normalize_link_jira(cls, v):
        if v is None:
            return None
        if isinstance(v, str):
            parts = [p.strip() for p in v.replace('\n', ',').split(',') if p.strip()]
            v = parts or None
        return _validate_external_url_list(v)

    @field_validator('link_requirements', mode='before')
    @classmethod
    def _normalize_link_requirements(cls, v):
        if v is None:
            return None
        if isinstance(v, str):
            parts = [p.strip() for p in v.replace('\n', ',').split(',') if p.strip()]
            v = parts or None
        return _validate_external_url_list(v)

    @field_validator('link_mockups')
    @classmethod
    def _validate_link_mockups(cls, v):
        return _validate_external_url(v)


class TaskCreate(TaskBase):
    title: str = Field(min_length=1, max_length=255)
    team_id: int
    priority_id: int
    description: Optional[str] = Field(None, max_length=10000)


class TaskUpdate(BaseModel):
    team_id: Optional[int] = None
    title: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = Field(None, max_length=10000)
    date_received: Optional[date] = None
    channel_id: Optional[int] = None
    business_customer_id: Optional[int] = None
    department_id: Optional[int] = None
    project_id: Optional[int] = None
    task_type_id: Optional[int] = None
    involved_teams: Optional[List[int]] = Field(None, description='Другие вовлечённые команды (массив id команд)')
    priority_id: Optional[int] = None
    status_id: Optional[int] = None
    deadline_id: Optional[int] = None
    effort_days: Optional[int] = Field(None, ge=0, le=10000)
    effort_rub: Optional[float] = Field(None, ge=0)
    effort_designee: Optional[float] = None
    effort_analytics: Optional[float] = None
    effort_be: Optional[float] = None
    effort_python_be: Optional[float] = None
    effort_fe: Optional[float] = None
    effort_test: Optional[float] = None
    effort_test_auto: Optional[float] = None
    effort_delivery: Optional[float] = None
    actual_effort_days: Optional[float] = None
    actual_effort_designee: Optional[float] = None
    actual_effort_analytics: Optional[float] = None
    actual_effort_be: Optional[float] = None
    actual_effort_python_be: Optional[float] = None
    actual_effort_fe: Optional[float] = None
    actual_effort_test: Optional[float] = None
    actual_effort_test_auto: Optional[float] = None
    actual_effort_delivery: Optional[float] = None
    financial_effect: Optional[float] = Field(None, ge=0)
    financial_effect_justification: Optional[str] = Field(None, max_length=10000)
    financial_effect_ai: Optional[float] = Field(None, ge=0, description='AI-расчёт финансового эффекта (руб)')
    financial_effect_ai_justification: Optional[str] = Field(None, max_length=10000, description='Обоснование AI-расчёта финансового эффекта')
    priority_score: Optional[int] = Field(None, ge=0, le=100, description='Priority Score (рейтинг 0-100)')
    priority_justification: Optional[str] = Field(None, max_length=10000, description='Обоснование Priority Score')
    assessment_weight: Optional[float] = Field(None, ge=0, le=100, description='Вес оценки (%)')
    completion_forecast: Optional[float] = Field(None, ge=0, le=100, description='Прогноз выполнения (%)')
    hard_score: Optional[str] = Field(None, max_length=1, pattern='^[A-E]$', description='Оценка за завершенность (Hard)')
    soft_score: Optional[str] = Field(None, max_length=1, pattern='^[A-E]$', description='Оценка за взаимодействие (Soft)')
    progress: Optional[int] = Field(None, ge=0, le=100)
    link_mockups: Optional[str] = Field(None, max_length=500)
    link_jira: Optional[List[str]] = Field(None, description='Ссылки на Jira (массив)')
    link_requirements: Optional[List[str]] = Field(None, description='Ссылки на бизнес-требования (массив)')
    rejection_reason: Optional[str] = Field(None, max_length=5000)
    comment: Optional[str] = Field(None, max_length=5000)
    owner_id: Optional[int] = None
    key_project_status: Optional[str] = None
    key_project_status_updated_at: Optional[datetime] = None
    prev_key_project_status: Optional[str] = None
    directorate_status: Optional[str] = Field(None, max_length=1000)
    prev_directorate_status: Optional[str] = None
    did_status: Optional[str] = Field(None, max_length=1000)
    prev_did_status: Optional[str] = None
    metric_kr_plan: Optional[float] = None
    metric_kr_fact: Optional[float] = None
    metric_kr_unit: Optional[str] = Field(None, max_length=50, description='Единица измерения Метрического KR')
    did_demo: Optional[bool] = None
    tags: Optional[List[str]] = Field(None, description='Метки (теги) — имена тегов')
    version: Optional[int] = Field(None, description='Версия задачи для optimistic lock')

    @field_validator('link_jira', mode='before')
    @classmethod
    def _normalize_link_jira(cls, v):
        if v is None:
            return None
        if isinstance(v, str):
            parts = [p.strip() for p in v.replace('\n', ',').split(',') if p.strip()]
            v = parts or None
        return _validate_external_url_list(v)

    @field_validator('link_requirements', mode='before')
    @classmethod
    def _normalize_link_requirements(cls, v):
        if v is None:
            return None
        if isinstance(v, str):
            parts = [p.strip() for p in v.replace('\n', ',').split(',') if p.strip()]
            v = parts or None
        return _validate_external_url_list(v)

    @field_validator('link_mockups')
    @classmethod
    def _validate_link_mockups(cls, v):
        return _validate_external_url(v)


class PipDecisionRequest(BaseModel):
    decision: Literal["reject", "accept"]


class TaskResponse(TaskBase):
    id: int
    cv: Optional[float] = None
    created_by: Optional[int] = None
    created_by_name: Optional[str] = None
    involved_team_names: Optional[List[str]] = None
    created_at: datetime
    updated_at: datetime
    version: int = 0
    lock_owner_id: Optional[int] = None
    lock_owner_name: Optional[str] = None
    lock_until: Optional[datetime] = None
    task_type_name: Optional[str] = None
    team_name: Optional[str] = None
    channel_name: Optional[str] = None
    department_name: Optional[str] = None
    project_name: Optional[str] = None
    priority_name: Optional[str] = None
    status_name: Optional[str] = None
    deadline_name: Optional[str] = None
    owner_name: Optional[str] = None
    business_customer_name: Optional[str] = None
    did_demo: bool = False
    tags: Optional[List['TagResponse']] = None

    class Config:
        from_attributes = True


class TaskListResponse(BaseModel):
    items: List[TaskResponse]
    total: int
    page: int
    per_page: int
    pages: int


# ==================== TASK COMMENT ====================

class CommentCreate(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    mentioned_user_ids: Optional[List[int]] = None
    parent_id: Optional[int] = None


class CommentResponse(BaseModel):
    id: int
    task_id: int
    user_id: int
    user_name: Optional[str] = None
    text: str
    mentioned_user_ids: Optional[List[int]] = None
    parent_id: Optional[int] = None
    replies: List['CommentResponse'] = []
    created_at: datetime

    class Config:
        from_attributes = True


class CommentListResponse(BaseModel):
    items: List[CommentResponse]
    total: int


class AttachmentResponse(BaseModel):
    id: int
    task_id: int
    user_id: int
    user_name: Optional[str] = None
    filename: str
    original_name: str
    mime_type: Optional[str] = None
    file_size: Optional[int] = None
    download_url: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class AttachmentListResponse(BaseModel):
    items: List[AttachmentResponse]
    total: int


class TaskLinkUpdate(BaseModel):
    link_mockups: Optional[str] = None
    link_jira: Optional[str] = None

    @field_validator('link_mockups', 'link_jira')
    @classmethod
    def _validate_links(cls, v):
        return _validate_external_url(v)


class BulkActionRequest(BaseModel):
    action: str = Field(max_length=50)
    task_ids: List[int] = Field(max_length=500)
    fields: Optional[Dict[str, Any]] = None
    updates: Optional[Dict[str, Any]] = None  # deprecated, use fields instead


class TaskHistoryResponse(BaseModel):
    id: int
    task_id: int
    changed_by: Optional[int] = None
    changed_by_name: Optional[str] = None
    changed_at: datetime
    field_name: str
    field_label: Optional[str] = None
    old_value: Optional[str] = None
    new_value: Optional[str] = None

    class Config:
        from_attributes = True


# ==================== TASK LOCK ====================

class TaskLockResponse(BaseModel):
    locked: bool
    lock_owner_id: Optional[int] = None
    lock_owner_name: Optional[str] = None
    lock_until: Optional[datetime] = None
    is_mine: bool = False
    version: Optional[int] = None


# ==================== TASK VIEWERS ====================

class TaskViewerResponse(BaseModel):
    user_id: int
    user_name: Optional[str] = None
    last_seen_at: datetime

    class Config:
        from_attributes = True


class TaskViewersListResponse(BaseModel):
    viewers: List[TaskViewerResponse]


# ==================== REPORT ====================

class ReportBase(BaseModel):
    name: str = Field(max_length=200)
    description: Optional[str] = Field(None, max_length=2000)
    key: Optional[str] = Field(None, max_length=100)
    filters: Optional[str] = Field(None, max_length=5000)
    fields: Optional[str] = Field(None, max_length=2000)
    group_by: Optional[str] = Field(None, max_length=50)
    sort_by: Optional[str] = Field(None, max_length=50)
    sort_order: str = Field(default="asc", max_length=4)
    is_public: bool = False


class ReportCreate(ReportBase):
    pass


class ReportResponse(ReportBase):
    id: int
    type: str = "custom"
    created_by: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ==================== NOTIFICATION ====================

class NotificationResponse(BaseModel):
    id: int
    task_id: Optional[int] = None
    category: str
    title: str
    body: Optional[str] = None
    importance: str
    is_read: bool
    is_dismissed: bool
    is_resolved: bool = False
    action_url: Optional[str] = None
    group_key: Optional[str] = None
    group_count: int = 1
    created_at: datetime
    read_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class NotificationListResponse(BaseModel):
    items: List[NotificationResponse]
    total: int
    page: int
    per_page: int


class UnreadCountResponse(BaseModel):
    count: int


class NotificationPreferencesResponse(BaseModel):
    preferences: dict


class NotificationPreferencesUpdate(BaseModel):
    preferences: dict


# ==================== ANALYTICS ====================

class DashboardStats(BaseModel):
    total_tasks: int
    active_tasks: int
    at_risk_tasks: int
    team_progress: List[dict]


class ValueTask(BaseModel):
    id: int
    title: str
    team_name: str
    financial_effect: Optional[float]
    effort_rub: Optional[float]
    cv: Optional[float]


# ==================== DICTIONARY ====================

class DictionaryItemBase(BaseModel):
    dict_type: str = Field(max_length=50)
    name: str = Field(max_length=100)
    code: Optional[str] = Field(None, max_length=50)
    color: Optional[str] = Field(None, max_length=20)
    sort_order: int = Field(default=0, ge=0)
    is_active: bool = True


class DictionaryItemCreate(DictionaryItemBase):
    pass


class DictionaryItemUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=100)
    code: Optional[str] = Field(None, max_length=50)
    color: Optional[str] = Field(None, max_length=20)
    sort_order: Optional[int] = Field(None, ge=0)
    is_active: Optional[bool] = None


class DictionaryItemResponse(DictionaryItemBase):
    id: int
    created_at: Optional[datetime] = None
    version: Optional[int] = 0
    lock_owner_id: Optional[int] = None
    lock_owner_name: Optional[str] = None
    lock_until: Optional[datetime] = None

    class Config:
        from_attributes = True


# ==================== COMPETENCY COST HISTORY ====================

class CompetencyCostHistoryBase(BaseModel):
    competency: str = Field(max_length=100)
    year: int
    rate: float = Field(default=0, ge=0)


class CompetencyCostHistoryCreate(CompetencyCostHistoryBase):
    pass


class CompetencyCostHistoryUpdate(BaseModel):
    rate: Optional[float] = Field(None, ge=0)
    is_active: Optional[bool] = None


class CompetencyCostHistoryResponse(CompetencyCostHistoryBase):
    id: int
    is_active: bool = True
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ==================== DICTIONARY LOCK ====================

class DictLockResponse(BaseModel):
    locked: bool
    lock_owner_id: Optional[int] = None
    lock_owner_name: Optional[str] = None
    lock_until: Optional[datetime] = None
    is_mine: bool = False
    version: int = 0


# ==================== LOOKUPS ====================

class ChannelBase(BaseModel):
    code: str = Field(max_length=50)
    name: str = Field(max_length=100)


class ChannelCreate(ChannelBase):
    pass


class ChannelResponse(ChannelBase):
    id: int

    class Config:
        from_attributes = True


class DeadlineBase(BaseModel):
    code: str = Field(max_length=50)
    name: str = Field(max_length=100)


class DeadlineCreate(DeadlineBase):
    pass


class DeadlineResponse(DeadlineBase):
    id: int

    class Config:
        from_attributes = True


class DepartmentBase(BaseModel):
    code: str = Field(max_length=50)
    name: str = Field(max_length=255)


class DepartmentCreate(DepartmentBase):
    pass


class DepartmentResponse(DepartmentBase):
    id: int

    class Config:
        from_attributes = True


class PriorityBase(BaseModel):
    name: str = Field(max_length=50)


class PriorityCreate(PriorityBase):
    pass


class PriorityResponse(PriorityBase):
    id: int

    class Config:
        from_attributes = True


class TaskTypeBase(BaseModel):
    code: str = Field(max_length=50)
    name: str = Field(max_length=100)


class TaskTypeCreate(TaskTypeBase):
    pass


class TaskTypeResponse(TaskTypeBase):
    id: int

    class Config:
        from_attributes = True


class TeamTypeBase(BaseModel):
    code: str = Field(max_length=50)
    name: str = Field(max_length=100)


class TeamTypeCreate(TeamTypeBase):
    pass


class TeamTypeResponse(TeamTypeBase):
    id: int

    class Config:
        from_attributes = True


class ProjectStatusBase(BaseModel):
    code: str = Field(max_length=50)
    name: str = Field(max_length=100)


class ProjectStatusCreate(ProjectStatusBase):
    pass


class ProjectStatusResponse(ProjectStatusBase):
    id: int

    class Config:
        from_attributes = True


class TaskStatusBase(BaseModel):
    code: str = Field(max_length=50)
    name: str = Field(max_length=100)
    sort_order: int = 0
    color: Optional[str] = Field(None, max_length=20)


class TaskStatusCreate(TaskStatusBase):
    pass


class TaskStatusResponse(TaskStatusBase):
    id: int

    class Config:
        from_attributes = True


# ==================== PROJECT ====================

class ProjectBase(BaseModel):
    code: str = Field(max_length=50)
    name: str = Field(max_length=255)
    description: Optional[str] = Field(None, max_length=5000)
    status_id: Optional[int] = None
    responsible_pl: Optional[int] = None


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = Field(None, max_length=5000)
    status_id: Optional[int] = None
    responsible_pl: Optional[int] = None


class ProjectResponse(ProjectBase):
    id: int
    created_at: Optional[datetime] = None
    status_name: Optional[str] = None
    pl_name: Optional[str] = None

    class Config:
        from_attributes = True


# ==================== BUSINESS CUSTOMER ====================

class BusinessCustomerBase(BaseModel):
    name: str = Field(max_length=200)
    department_id: Optional[int] = None


class BusinessCustomerCreate(BusinessCustomerBase):
    pass


class BusinessCustomerUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=200)
    department_id: Optional[int] = None


class BusinessCustomerResponse(BusinessCustomerBase):
    id: int
    department_name: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ==================== TAG ====================

class TagBase(BaseModel):
    name: str = Field(max_length=100)
    color: Optional[str] = Field(None, max_length=20)
    description: Optional[str] = Field(None, max_length=5000)


class TagCreate(TagBase):
    pass


class TagResponse(TagBase):
    id: int
    created_at: Optional[datetime] = None
    creator: Optional[int] = None

    class Config:
        from_attributes = True


# ==================== GENERAL ====================

class ErrorResponse(BaseModel):
    detail: str
    code: Optional[str] = None


class SuccessResponse(BaseModel):
    success: bool = True
    detail: Optional[str] = None


# ==================== COLUMN LABELS ====================

class ColumnLabelUpdate(BaseModel):
    labels: dict


class ColumnLabelResponse(BaseModel):
    id: int
    key: str
    label: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ==================== DISPLAY SETTINGS ====================

class DisplaySettingUpdate(BaseModel):
    settings: dict


class DisplaySettingResponse(BaseModel):
    id: int
    page: str
    settings: dict
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ==================== TEAM COMPETENCY RESOURCES ====================

class TeamCompetencyResourceResponse(BaseModel):
    competency: str
    capacity: float
    senior_count: int = 0
    middle_count: int = 0
    junior_count: int = 0
    vacation_days: int = 0
    working_days: int = 66


class CompetencyCostResponse(BaseModel):
    competency: str
    cost_per_day: float


# ==================== EPIC & STORY (Экспресс-оценка) ====================

class EffortFields(BaseModel):
    effort_designee: Optional[float] = Field(None, ge=0)
    effort_analytics: Optional[float] = Field(None, ge=0)
    effort_be: Optional[float] = Field(None, ge=0)
    effort_python_be: Optional[float] = Field(None, ge=0)
    effort_fe: Optional[float] = Field(None, ge=0)
    effort_test: Optional[float] = Field(None, ge=0)
    effort_test_auto: Optional[float] = Field(None, ge=0)
    effort_delivery: Optional[float] = Field(None, ge=0)


class EpicCreate(EffortFields):
    task_id: int
    title: str = Field(max_length=255)
    description: Optional[str] = Field(None, max_length=10000)
    priority: Optional[str] = Field(None, max_length=50)


class EpicUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = Field(None, max_length=10000)
    priority: Optional[str] = Field(None, max_length=50)
    effort_designee: Optional[float] = Field(None, ge=0)
    effort_analytics: Optional[float] = Field(None, ge=0)
    effort_be: Optional[float] = Field(None, ge=0)
    effort_python_be: Optional[float] = Field(None, ge=0)
    effort_fe: Optional[float] = Field(None, ge=0)
    effort_test: Optional[float] = Field(None, ge=0)
    effort_test_auto: Optional[float] = Field(None, ge=0)
    effort_delivery: Optional[float] = Field(None, ge=0)


class StoryCreate(EffortFields):
    epic_id: int
    title: str = Field(max_length=255)
    description: Optional[str] = Field(None, max_length=10000)


class StoryUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = Field(None, max_length=10000)
    effort_designee: Optional[float] = None
    effort_analytics: Optional[float] = None
    effort_be: Optional[float] = None
    effort_python_be: Optional[float] = None
    effort_fe: Optional[float] = None
    effort_test: Optional[float] = None
    effort_test_auto: Optional[float] = None
    effort_delivery: Optional[float] = None


class EpicResponse(EffortFields):
    id: int
    task_id: int
    title: str
    description: Optional[str] = None
    priority: Optional[str] = None
    stories: List['StoryResponse'] = []
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class StoryResponse(EffortFields):
    id: int
    epic_id: int
    title: str
    description: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class EpicListResponse(BaseModel):
    items: List[EpicResponse]
    total: int


class StoryListResponse(BaseModel):
    items: List[StoryResponse]
    total: int


class SortItem(BaseModel):
    id: int
    sort_order: int


class SortRequest(BaseModel):
    epics: List[SortItem] = []
    stories: List[SortItem] = []


class QuickEstimateTaskResponse(TaskResponse):
    """Task with nested epics and stories for the quick estimate page"""
    epics: List[EpicResponse] = []

    class Config:
        from_attributes = True


class QuickEstimateResponse(BaseModel):
    tasks: List[QuickEstimateTaskResponse]
    total: int


# ==================== TIMELINE ====================

class TimelineEventBase(BaseModel):
    title: str = Field(max_length=300)
    description: Optional[str] = Field(None, max_length=5000)
    event_type: str = "event"
    color: str = "#6366f1"
    date: date
    quarter: Optional[int] = None
    month: Optional[int] = None
    year: Optional[int] = None
    project_id: Optional[int] = None
    is_recurring: bool = False
    recurring_interval: Optional[str] = None
    visibility_level: str = "team"


class TimelineEventCreate(TimelineEventBase):
    pass


class TimelineEventUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=300)
    description: Optional[str] = Field(None, max_length=5000)
    event_type: Optional[str] = None
    color: Optional[str] = None
    date: Optional[date] = None
    quarter: Optional[int] = None
    month: Optional[int] = None
    year: Optional[int] = None
    project_id: Optional[int] = None
    is_recurring: Optional[bool] = None
    recurring_interval: Optional[str] = None
    visibility_level: Optional[str] = None


class TimelineEventResponse(TimelineEventBase):
    id: int
    creator_id: Optional[int] = None
    creator_name: Optional[str] = None
    project_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class TimelineEventListResponse(BaseModel):
    items: List[TimelineEventResponse]
    total: int


# Resolve forward reference: TaskResponse.tags -> TagResponse (defined after)
TaskResponse.model_rebuild()
