from pydantic import AliasChoices, BaseModel, EmailStr, Field, field_validator, model_validator
from typing import Optional, List, Dict, Any, ClassVar, Literal
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
    model_config = {"extra": "forbid"}
    login: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=128)


class TokenResponse(BaseModel):
    session_expires_at: Optional[datetime] = None
    last_activity_at: Optional[datetime] = None
    idle_timeout_seconds: Optional[int] = None
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: dict


# ==================== USER ====================

class UserBase(BaseModel):
    login: Optional[str] = Field(None, max_length=254)
    email: Optional[str] = None
    name: str = Field(max_length=100)
    position: Optional[str] = Field(None, max_length=100)
    team_id: Optional[int] = None
    role_id: Optional[int] = None
    business_customer_id: Optional[int] = None
    is_active: bool = True


class UserCreate(UserBase):
    model_config = {"extra": "forbid"}
    login: str = Field(min_length=3, max_length=254)
    reauth_token: str = Field(max_length=128)
    can_edit: bool = True
    can_delete: bool = False
    can_export: bool = True


class UserUpdate(BaseModel):
    model_config = {"extra": "forbid"}
    reauth_token: str = Field(max_length=128)
    name: Optional[str] = Field(None, max_length=100)
    login: Optional[str] = Field(None, max_length=254)
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
    login: Optional[str] = Field(None, validation_alias=AliasChoices("login_normalized", "login"))
    credential_state: str = "invited"
    password_changed_at: Optional[datetime] = None
    id: int
    last_login: Optional[datetime] = None
    created_at: datetime
    role_name: Optional[str] = None
    team_name: Optional[str] = None
    business_customer_name: Optional[str] = None
    can_edit: bool = True
    can_delete: bool = False
    can_export: bool = True
    permissions: Optional[Dict[str, str]] = None

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
    customer_portal_only: Optional[bool] = None
    review_access: Optional[str] = Field(None, pattern="^(none|team|all)$")
    task_edit_scope: Optional[str] = Field(None, pattern="^(none|team|all)$")
    task_comment_scope: Optional[str] = Field(None, pattern="^(none|team|all)$")
    task_delete_scope: Optional[str] = Field(None, pattern="^(none|team|all)$")
    pip_decision_access: Optional[bool] = None
    can_edit_tasks: bool = True
    can_delete_tasks: bool = False
    can_export: bool = True


class RoleCreate(RoleBase):
    pass


class RoleUpdate(BaseModel):
    model_config = {"extra": "forbid"}
    reauth_token: str = Field(max_length=128)
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
    customer_portal_only: Optional[bool] = None
    review_access: Optional[str] = Field(None, pattern="^(none|team|all)$")
    task_edit_scope: Optional[str] = Field(None, pattern="^(none|team|all)$")
    task_comment_scope: Optional[str] = Field(None, pattern="^(none|team|all)$")
    task_delete_scope: Optional[str] = Field(None, pattern="^(none|team|all)$")
    pip_decision_access: Optional[bool] = None
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
    did_client_group_id: Optional[int] = None
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
    effort_designee: Optional[float] = Field(None, ge=0)
    effort_analytics: Optional[float] = Field(None, ge=0)
    effort_be: Optional[float] = Field(None, ge=0)
    effort_python_be: Optional[float] = Field(None, ge=0)
    effort_fe: Optional[float] = Field(None, ge=0)
    effort_test: Optional[float] = Field(None, ge=0)
    effort_test_auto: Optional[float] = Field(None, ge=0)
    effort_delivery: Optional[float] = Field(None, ge=0)
    actual_effort_days: Optional[float] = None
    actual_effort_designee: Optional[float] = Field(None, ge=0)
    actual_effort_analytics: Optional[float] = Field(None, ge=0)
    actual_effort_be: Optional[float] = Field(None, ge=0)
    actual_effort_python_be: Optional[float] = Field(None, ge=0)
    actual_effort_fe: Optional[float] = Field(None, ge=0)
    actual_effort_test: Optional[float] = Field(None, ge=0)
    actual_effort_test_auto: Optional[float] = Field(None, ge=0)
    actual_effort_delivery: Optional[float] = Field(None, ge=0)
    financial_effect: Optional[float] = Field(None, ge=0)
    financial_effect_justification: Optional[str] = Field(None, max_length=10000)
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
    client_request_id: Optional[str] = Field(None, min_length=8, max_length=64)
    title: str = Field(min_length=1, max_length=255)
    team_id: int
    task_type_id: int
    channel_id: int
    date_received: date
    priority_id: Optional[int] = None
    description: Optional[str] = Field(None, max_length=10000)

    @model_validator(mode='before')
    @classmethod
    def _reject_agent_managed_fields(cls, values):
        if not isinstance(values, dict):
            return values
        forbidden = {
            'financial_effect_ai',
            'financial_effect_ai_justification',
            'priority_score',
            'priority_justification',
        } & set(values)
        if forbidden:
            raise ValueError(
                'Поля результата агента нельзя задавать при создании задачи: '
                + ', '.join(sorted(forbidden))
            )
        return values

    @field_validator('title')
    @classmethod
    def _validate_create_title(cls, value):
        value = value.strip()
        if not value:
            raise ValueError('Введите название задачи')
        return value


class TaskUpdate(BaseModel):
    did_client_group_id: Optional[int] = None
    agent_managed_fields_allowed: ClassVar[bool] = False

    client_request_id: Optional[str] = Field(None, min_length=8, max_length=64)
    version: int = Field(ge=0, description='Обязательная версия задачи для optimistic lock')
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
    effort_designee: Optional[float] = Field(None, ge=0)
    effort_analytics: Optional[float] = Field(None, ge=0)
    effort_be: Optional[float] = Field(None, ge=0)
    effort_python_be: Optional[float] = Field(None, ge=0)
    effort_fe: Optional[float] = Field(None, ge=0)
    effort_test: Optional[float] = Field(None, ge=0)
    effort_test_auto: Optional[float] = Field(None, ge=0)
    effort_delivery: Optional[float] = Field(None, ge=0)
    actual_effort_days: Optional[float] = None
    actual_effort_designee: Optional[float] = Field(None, ge=0)
    actual_effort_analytics: Optional[float] = Field(None, ge=0)
    actual_effort_be: Optional[float] = Field(None, ge=0)
    actual_effort_python_be: Optional[float] = Field(None, ge=0)
    actual_effort_fe: Optional[float] = Field(None, ge=0)
    actual_effort_test: Optional[float] = Field(None, ge=0)
    actual_effort_test_auto: Optional[float] = Field(None, ge=0)
    actual_effort_delivery: Optional[float] = Field(None, ge=0)
    financial_effect: Optional[float] = Field(None, ge=0)
    financial_effect_justification: Optional[str] = Field(None, max_length=10000)
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

    @model_validator(mode='before')
    @classmethod
    def _reject_agent_managed_fields(cls, values):
        if cls.agent_managed_fields_allowed or not isinstance(values, dict):
            return values
        forbidden = {
            'financial_effect_ai',
            'financial_effect_ai_justification',
            'priority_score',
            'priority_justification',
        } & set(values)
        if forbidden:
            raise ValueError(
                'Поля результата агента изменяются только через endpoint prioritiser: '
                + ', '.join(sorted(forbidden))
            )
        return values

    @field_validator('title')
    @classmethod
    def _validate_update_title(cls, value):
        if value is None or not value.strip():
            raise ValueError('Введите название задачи')
        return value.strip()

    @field_validator('team_id', 'task_type_id', 'channel_id', 'date_received')
    @classmethod
    def _validate_required_update_fields(cls, value):
        if value is None:
            raise ValueError('Обязательное поле не может быть пустым')
        return value
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


class PrioritiserTaskUpdate(TaskUpdate):
    """Поля, которые разрешено записывать только интеграции prioritiser."""

    agent_managed_fields_allowed: ClassVar[bool] = True
    priority_score: Optional[int] = Field(None, ge=0, le=100)
    priority_justification: Optional[str] = Field(None, min_length=1, max_length=10000)


class PipDecisionRequest(BaseModel):
    decision: Literal["reject", "accept", "rework"]
    version: int = Field(ge=0)
    reason: Optional[str] = Field(None, max_length=2000)

    @model_validator(mode="after")
    def validate_reason(self):
        self.reason = (self.reason or "").strip() or None
        if self.decision in {"reject", "rework"} and not self.reason:
            raise ValueError("Укажите причину возврата или отклонения задачи")
        return self


class PipDecisionContext(BaseModel):
    """Latest structured PI decision exposed for cross-stage navigation."""

    decision: Literal["reject", "accept", "rework"]
    reason: Optional[str] = None
    decided_at: Optional[datetime] = None
    decided_by_name: Optional[str] = None


class TaskResponse(TaskBase):
    metric_id: Optional[int] = None
    did_client_group_name: Optional[str] = None
    id: int
    public_id: str = Field(pattern=r'^TASK-\d{3}-\d{3}$')
    cv: Optional[float] = None
    created_by: Optional[int] = None
    created_by_name: Optional[str] = None
    involved_team_names: Optional[List[str]] = None
    created_at: datetime
    updated_at: datetime
    version: int = 0
    # Legacy AI-поля остаются только в ответе для совместимости со схемой БД.
    # Карточка их не отображает и не использует как замену реального результата.
    financial_effect_ai: Optional[float] = None
    financial_effect_ai_justification: Optional[str] = None
    priority_score: Optional[int] = Field(None, ge=0, le=100)
    priority_justification: Optional[str] = None
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
    latest_pip_decision: Optional[PipDecisionContext] = None

    class Config:
        from_attributes = True


class CustomerTaskResponse(BaseModel):
    """Read-only customer projection without internal planning and lock fields."""

    id: int
    public_id: str = Field(pattern=r'^TASK-\d{3}-\d{3}$')
    title: str
    description: Optional[str] = None
    progress: int = Field(default=0, ge=0, le=100)
    created_at: datetime
    updated_at: datetime
    team_name: Optional[str] = None
    status_name: Optional[str] = None
    deadline_name: Optional[str] = None

    class Config:
        from_attributes = True


class CustomerTaskListResponse(BaseModel):
    """Paginated list whose items are restricted to the customer projection."""

    items: List[CustomerTaskResponse]
    total: int
    page: int
    per_page: int
    pages: int


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
    client_request_id: Optional[str] = Field(None, min_length=8, max_length=64)


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
    version: int = Field(ge=0)
    link_mockups: Optional[str] = None
    link_jira: Optional[str] = None

    @field_validator('link_mockups', 'link_jira')
    @classmethod
    def _validate_links(cls, v):
        return _validate_external_url(v)


class BulkTaskFields(TaskUpdate):
    """Reuse single-task constraints before any bulk preview or mutation."""
    model_config = {'extra': 'forbid', 'allow_inf_nan': False}
    version: int = 0
    tags_add: List[str] = Field(default_factory=list, max_length=50)
    tags_remove: List[str] = Field(default_factory=list, max_length=50)

    @field_validator('progress', mode='before')
    @classmethod
    def _bulk_progress(cls, value):
        if value is None or isinstance(value, bool):
            raise ValueError('Прогресс должен быть целым числом от 0 до 100')
        try:
            number = float(value)
        except (ValueError, TypeError):
            raise ValueError('Прогресс должен быть целым числом от 0 до 100')
        if not number.is_integer() or not 0 <= number <= 100:
            raise ValueError('Прогресс должен быть целым числом от 0 до 100')
        return value

    @field_validator('tags_add', 'tags_remove')
    @classmethod
    def _bulk_tags(cls, values):
        if any(len(value.strip()) > 100 for value in values):
            raise ValueError('Название тега не должно превышать 100 символов')
        return values


class BulkActionRequest(BaseModel):
    action: str = Field(max_length=50)
    task_ids: List[int] = Field(min_length=1)
    versions: Dict[int, int] = Field(default_factory=dict)
    fields: Optional[Dict[str, Any]] = None
    updates: Optional[Dict[str, Any]] = None  # deprecated, use fields instead

    @model_validator(mode='after')
    def _validate_bulk_fields(self):
        if self.action == 'update':
            if self.fields is not None and self.updates is not None:
                raise ValueError('Передайте только fields или updates')
            raw = self.fields if self.fields is not None else self.updates or {}
            normalized = BulkTaskFields.model_validate(raw).model_dump(
                exclude_unset=True, exclude={'version'}, mode='python')
            # Keep unsupported names visible to the router allowlist.
            if 'version' in raw:
                normalized['version'] = raw['version']
            self.fields = normalized
            self.updates = None
        return self


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
    client_request_id: Optional[str] = Field(None, min_length=8, max_length=64)


class ReportUpdate(ReportBase):
    version: int = Field(ge=0)
    client_request_id: Optional[str] = Field(None, min_length=8, max_length=64)


class ReportResponse(ReportBase):
    id: int
    type: str = "custom"
    created_by: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    version: int = 0

    class Config:
        from_attributes = True


# ==================== NOTIFICATION ====================

class NotificationTargetResponse(BaseModel):
    work_task_id: Optional[int] = None
    kind: Literal["work", "task", "task_discussion", "task_reporting", "reporting_statuses", "quarterly_goals_update", "request", "inbox", "meeting_capture"]
    url: str
    task_id: Optional[int] = None
    tab: Optional[Literal["com", "rep"]] = None
    comment_id: Optional[int] = None
    meeting_id: Optional[int] = None
    request_id: Optional[int] = None


class NotificationResponse(BaseModel):
    id: int
    task_id: Optional[int] = None
    type: str
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
    target: Optional[NotificationTargetResponse] = None
    deadline: Optional[date] = None
    days_remaining: Optional[int] = None

    class Config:
        from_attributes = True


class NotificationListResponse(BaseModel):
    items: List[NotificationResponse]
    total: int
    page: int
    per_page: int


class NotificationSummaryResponse(BaseModel):
    unread: int
    requires_action: int
    today: int
    by_category: Dict[str, int]


class NotificationSnapshotResponse(BaseModel):
    revision: int
    summary: NotificationSummaryResponse
    recent_items: List[NotificationResponse]
    recent_total: int
    action_items: List[NotificationResponse]
    action_total: int


class NotificationUxEventRequest(BaseModel):
    event: Literal[
        "notification_opened",
        "notification_primary_action_clicked",
        "notification_target_opened",
        "notification_target_failed",
        "notification_fetch_failed",
        "notification_realtime_lag_detected",
    ]
    surface: Literal["center", "bell", "dashboard", "toast"]
    category: Optional[Literal["assignment", "reporting", "mention", "comment", "request", "meeting_capture"]] = None
    state: Optional[Literal["unread", "read", "resolved"]] = None
    duration_ms: Optional[int] = Field(None, ge=0, le=300_000)


class NotificationIdsRequest(BaseModel):
    ids: List[int] = Field(min_length=1, max_length=5000)


class UnreadCountResponse(BaseModel):
    count: int


class NotificationPreferencesResponse(BaseModel):
    preferences: Dict[Literal["comment"], bool]


class NotificationPreferencesUpdate(BaseModel):
    preferences: Dict[Literal["comment"], bool]


NOTIFICATION_TEMPLATE_EVENTS = {
    "task_deadline", "task_overdue", "task_status_changed", "task_assigned",
    "mention", "review_requested", "periodic_digest",
}
NOTIFICATION_TEMPLATE_FREQUENCIES = {"daily", "weekly", "monthly", "quarterly"}


class NotificationTemplateBase(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    event_type: str
    text: str = Field(min_length=1, max_length=4000)
    recipients: List[str] = Field(min_length=1)
    deadline_days: Optional[int] = Field(None, ge=0, le=365)
    repeat_frequency: Optional[str] = None
    repeat_day: Optional[int] = Field(None, ge=1, le=31)
    is_active: bool = True

    @field_validator("event_type")
    @classmethod
    def validate_event_type(cls, value):
        if value not in NOTIFICATION_TEMPLATE_EVENTS:
            raise ValueError("Неизвестное событие уведомления")
        return value

    @field_validator("repeat_frequency")
    @classmethod
    def validate_repeat_frequency(cls, value):
        if value is not None and value not in NOTIFICATION_TEMPLATE_FREQUENCIES:
            raise ValueError("Неизвестная периодичность")
        return value

    @field_validator("recipients")
    @classmethod
    def validate_recipients(cls, value):
        cleaned = list(dict.fromkeys(item.strip() for item in value if item and item.strip()))
        if not cleaned:
            raise ValueError("Укажите хотя бы одного получателя")
        if any(len(item) > 50 for item in cleaned):
            raise ValueError("Код получателя не должен превышать 50 символов")
        return cleaned


class NotificationTemplateCreate(NotificationTemplateBase):
    pass


class NotificationTemplateUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=150)
    event_type: Optional[str] = None
    text: Optional[str] = Field(None, min_length=1, max_length=4000)
    recipients: Optional[List[str]] = None
    deadline_days: Optional[int] = Field(None, ge=0, le=365)
    repeat_frequency: Optional[str] = None
    repeat_day: Optional[int] = Field(None, ge=1, le=31)
    is_active: Optional[bool] = None

    @field_validator("event_type")
    @classmethod
    def validate_event_type(cls, value):
        if value is not None and value not in NOTIFICATION_TEMPLATE_EVENTS:
            raise ValueError("Неизвестное событие уведомления")
        return value

    @field_validator("repeat_frequency")
    @classmethod
    def validate_repeat_frequency(cls, value):
        if value is not None and value not in NOTIFICATION_TEMPLATE_FREQUENCIES:
            raise ValueError("Неизвестная периодичность")
        return value

    @field_validator("recipients")
    @classmethod
    def validate_recipients(cls, value):
        if value is None:
            return value
        cleaned = list(dict.fromkeys(item.strip() for item in value if item and item.strip()))
        if not cleaned:
            raise ValueError("Укажите хотя бы одного получателя")
        return cleaned


class NotificationTemplateResponse(NotificationTemplateBase):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None


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


class OutboxRequeueRequest(BaseModel):
    expected_attempts: int = Field(ge=1)
    client_request_id: str = Field(min_length=8, max_length=64)


class UserDirectoryResponse(BaseModel):
    """Minimal identity projection safe for ordinary authenticated users."""
    id: int
    name: str
    position: Optional[str] = None
    team_id: Optional[int] = None
    team_name: Optional[str] = None

    class Config:
        from_attributes = True


class DictionaryBatchItem(BaseModel):
    id: Optional[int] = None
    name: str = Field(min_length=1, max_length=100)
    code: Optional[str] = Field(None, max_length=50)
    color: Optional[str] = Field(None, max_length=20)
    sort_order: int = Field(default=0, ge=0)


class DictionaryBatchUpdate(BaseModel):
    version: int = Field(ge=0)
    items: List[DictionaryBatchItem]


class DictionaryBatchResponse(BaseModel):
    items: List[DictionaryItemResponse]
    version: int
    added: int = 0
    updated: int = 0
    archived: int = 0


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


class CompetencyCostBatchUpdate(BaseModel):
    version: int = Field(ge=0)
    items: List[CompetencyCostHistoryBase]


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


class BulkActionResponse(SuccessResponse):
    operation_id: str
    requested_tasks: int
    changed_tasks: int
    unchanged_tasks: int
    applied_changes: int
    skipped_changes: int
    changed_task_ids: List[int] = Field(default_factory=list)
    unchanged_task_ids: List[int] = Field(default_factory=list)
    error_task_ids: List[int] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)


class BulkPreviewResponse(BaseModel):
    requested_tasks: int
    found_tasks: int
    accessible_tasks: int
    inaccessible_tasks: int
    changed_tasks: int
    unchanged_tasks: int
    applied_changes: int
    skipped_changes: int
    notifications: int
    can_apply: bool
    errors: List[str] = Field(default_factory=list)


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


class TaskVersionRequest(BaseModel):
    version: int = Field(ge=0)


class TaskVersionsRequest(BaseModel):
    versions: Dict[int, int]


class QuickEstimateBlocker(BaseModel):
    code: Literal["missing_decomposition", "missing_effort", "invalid_effort"]
    entity_type: Literal["task", "epic", "story"]
    entity_id: int
    entity_title: str
    message: str


class QuickEstimateBlockingTask(BaseModel):
    task_id: int
    public_id: Optional[str] = None
    title: str
    blockers: List[QuickEstimateBlocker] = Field(default_factory=list)


class QuickEstimateReadiness(BaseModel):
    ready: bool
    total_tasks: int
    ready_tasks: int
    total_blockers: int
    blocking_tasks: List[QuickEstimateBlockingTask] = Field(default_factory=list)


class QuickEstimateTaskResponse(TaskResponse):
    """Task with nested epics and stories for the quick estimate page"""
    epics: List[EpicResponse] = []

    class Config:
        from_attributes = True


class QuickEstimateResponse(BaseModel):
    tasks: List[QuickEstimateTaskResponse]
    total: int
    readiness: QuickEstimateReadiness


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
