from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List
from datetime import datetime, date


# ==================== AUTH ====================

class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: dict


class RefreshRequest(BaseModel):
    refresh_token: str


# ==================== USER ====================

class UserBase(BaseModel):
    login: Optional[str] = Field(None, max_length=50)
    email: EmailStr
    name: str = Field(max_length=100)
    position: Optional[str] = Field(None, max_length=100)
    team_id: Optional[int] = None
    role_id: Optional[int] = None
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
    business_customer: Optional[str] = Field(None, max_length=200)
    business_customer_id: Optional[int] = None
    department_id: Optional[int] = None
    project_id: Optional[int] = None
    task_type_id: Optional[int] = None
    involved_teams: Optional[str] = Field(None, max_length=1000)
    priority_id: Optional[int] = None
    status_id: Optional[int] = None
    deadline_id: Optional[int] = None
    deadline_po_id: Optional[int] = None
    effort_days: Optional[int] = Field(None, ge=0, le=10000)
    effort_rub: Optional[float] = Field(None, ge=0)
    effort_ba: Optional[float] = None
    effort_sa: Optional[float] = None
    effort_fe: Optional[float] = None
    effort_be: Optional[float] = None
    effort_test: Optional[float] = None
    effort_design: Optional[float] = None
    financial_effect: Optional[float] = Field(None, ge=0)
    ice_score: Optional[float] = Field(None)
    progress: int = Field(default=0, ge=0, le=100)
    what_if: Optional[str] = Field(None, max_length=10000)
    dod: Optional[str] = Field(None, max_length=10000)
    link_mockups: Optional[str] = Field(None, max_length=500)
    link_jira: Optional[str] = Field(None, max_length=500)
    rejection_reason: Optional[str] = Field(None, max_length=5000)
    comment: Optional[str] = Field(None, max_length=5000)
    status_comment: Optional[str] = Field(None, max_length=5000)
    owner_id: Optional[int] = None
    responsible_po_id: Optional[int] = None
    business_analyst_id: Optional[int] = None
    it_product_lead_id: Optional[int] = None
    key_project: bool = False
    key_project_status: Optional[str] = Field(None, max_length=50)
    directorate_status: Optional[str] = Field(None, max_length=50)
    did_status: Optional[str] = Field(None, max_length=50)
    is_from_leadership: bool = False
    is_regular: bool = False


class TaskCreate(TaskBase):
    pass


class TaskUpdate(BaseModel):
    team_id: Optional[int] = None
    title: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = Field(None, max_length=10000)
    date_received: Optional[date] = None
    channel_id: Optional[int] = None
    business_customer: Optional[str] = Field(None, max_length=200)
    business_customer_id: Optional[int] = None
    department_id: Optional[int] = None
    project_id: Optional[int] = None
    task_type_id: Optional[int] = None
    involved_teams: Optional[str] = Field(None, max_length=1000)
    priority_id: Optional[int] = None
    status_id: Optional[int] = None
    deadline_id: Optional[int] = None
    deadline_po_id: Optional[int] = None
    effort_days: Optional[int] = Field(None, ge=0, le=10000)
    effort_rub: Optional[float] = Field(None, ge=0)
    effort_ba: Optional[float] = None
    effort_sa: Optional[float] = None
    effort_fe: Optional[float] = None
    effort_be: Optional[float] = None
    effort_test: Optional[float] = None
    effort_design: Optional[float] = None
    financial_effect: Optional[float] = Field(None, ge=0)
    ice_score: Optional[float] = Field(None)
    progress: Optional[int] = Field(None, ge=0, le=100)
    what_if: Optional[str] = Field(None, max_length=10000)
    dod: Optional[str] = Field(None, max_length=10000)
    link_mockups: Optional[str] = Field(None, max_length=500)
    link_jira: Optional[str] = Field(None, max_length=500)
    rejection_reason: Optional[str] = Field(None, max_length=5000)
    comment: Optional[str] = Field(None, max_length=5000)
    status_comment: Optional[str] = Field(None, max_length=5000)
    owner_id: Optional[int] = None
    responsible_po_id: Optional[int] = None
    business_analyst_id: Optional[int] = None
    it_product_lead_id: Optional[int] = None
    key_project: Optional[bool] = None
    key_project_status: Optional[str] = Field(None, max_length=50)
    directorate_status: Optional[str] = Field(None, max_length=50)
    did_status: Optional[str] = Field(None, max_length=50)
    is_from_leadership: Optional[bool] = None
    is_regular: Optional[bool] = None


class TaskResponse(TaskBase):
    id: int
    cv: Optional[float] = None
    ice_score: Optional[float] = None
    last_updated: Optional[date] = None
    created_by: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    team_name: Optional[str] = None
    channel_name: Optional[str] = None
    department_name: Optional[str] = None
    project_name: Optional[str] = None
    priority_name: Optional[str] = None
    status_name: Optional[str] = None
    deadline_name: Optional[str] = None
    deadline_po_name: Optional[str] = None
    owner_name: Optional[str] = None
    responsible_po_name: Optional[str] = None
    business_analyst_name: Optional[str] = None
    it_product_lead_name: Optional[str] = None
    business_customer_name: Optional[str] = None

    class Config:
        from_attributes = True


class TaskListResponse(BaseModel):
    items: List[TaskResponse]
    total: int
    page: int
    per_page: int
    pages: int


class BulkActionRequest(BaseModel):
    action: str = Field(max_length=50)
    task_ids: List[int] = Field(max_length=500)


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


# ==================== REPORT ====================

class ReportBase(BaseModel):
    name: str = Field(max_length=200)
    description: Optional[str] = Field(None, max_length=2000)
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
    type: str
    message: str
    is_read: bool
    created_at: datetime

    class Config:
        from_attributes = True


# ==================== ANALYTICS ====================

class DashboardStats(BaseModel):
    total_tasks: int
    active_tasks: int
    at_risk_tasks: int
    key_projects: int
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

    class Config:
        from_attributes = True


# ==================== NOTIFICATION TEMPLATE ====================

class NotificationTemplateBase(BaseModel):
    name: str = Field(max_length=200)
    text: str = Field(max_length=5000)
    recipients: Optional[str] = Field(None, max_length=500)
    deadline_days: Optional[int] = None
    repeat_frequency: Optional[str] = Field(None, max_length=50)
    repeat_day: Optional[int] = None
    is_active: bool = True


class NotificationTemplateCreate(NotificationTemplateBase):
    pass


class NotificationTemplateUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=200)
    text: Optional[str] = Field(None, max_length=5000)
    recipients: Optional[str] = Field(None, max_length=500)
    deadline_days: Optional[int] = None
    repeat_frequency: Optional[str] = Field(None, max_length=50)
    repeat_day: Optional[int] = None
    is_active: Optional[bool] = None


class NotificationTemplateResponse(NotificationTemplateBase):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


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
    sla_multiplier: Optional[float] = None


class PriorityCreate(PriorityBase):
    pass


class PriorityResponse(PriorityBase):
    id: int

    class Config:
        from_attributes = True


class TaskTypeBase(BaseModel):
    code: str = Field(max_length=50)
    name: str = Field(max_length=100)
    dod_required: bool = False
    financial_value_required: bool = False


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
    group: Optional[str] = Field(None, max_length=50)
    sla_hours: Optional[int] = None
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


# ==================== EPIC & STORY (Экспресс-оценка) ====================

class EffortFields(BaseModel):
    effort_ba: Optional[float] = None
    effort_sa: Optional[float] = None
    effort_fe: Optional[float] = None
    effort_be: Optional[float] = None
    effort_test: Optional[float] = None
    effort_design: Optional[float] = None


class EpicCreate(EffortFields):
    task_id: int
    title: str = Field(max_length=255)
    description: Optional[str] = Field(None, max_length=10000)


class EpicUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = Field(None, max_length=10000)
    effort_ba: Optional[float] = None
    effort_sa: Optional[float] = None
    effort_fe: Optional[float] = None
    effort_be: Optional[float] = None
    effort_test: Optional[float] = None
    effort_design: Optional[float] = None


class StoryCreate(EffortFields):
    epic_id: int
    title: str = Field(max_length=255)
    description: Optional[str] = Field(None, max_length=10000)


class StoryUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = Field(None, max_length=10000)
    effort_ba: Optional[float] = None
    effort_sa: Optional[float] = None
    effort_fe: Optional[float] = None
    effort_be: Optional[float] = None
    effort_test: Optional[float] = None
    effort_design: Optional[float] = None


class EpicResponse(EffortFields):
    id: int
    task_id: int
    title: str
    description: Optional[str] = None
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


class QuickEstimateTaskResponse(TaskResponse):
    """Task with nested epics and stories for the quick estimate page"""
    epics: List[EpicResponse] = []

    class Config:
        from_attributes = True


class QuickEstimateResponse(BaseModel):
    tasks: List[QuickEstimateTaskResponse]
    total: int
