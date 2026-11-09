"""Metric KR storage. Reference rows and legacy tasks are never deleted."""
from sqlalchemy import Column, Integer, String, Text, Boolean, Date, DateTime, Numeric, JSON, ForeignKey, CheckConstraint, UniqueConstraint, Index
from sqlalchemy.sql import func
from database import Base


class Metric(Base):
    __tablename__ = 'kr_metrics'
    id = Column(Integer, primary_key=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=False, default='', server_default='')
    team_id = Column(Integer, ForeignKey('teams.id'), nullable=False, index=True)
    owner_id = Column(Integer, ForeignKey('users.id'))
    project_id = Column(Integer, ForeignKey('projects.id'), index=True)
    unit = Column(String(50), nullable=False, default='', server_default='')
    method = Column(Text, nullable=False, default='', server_default='')
    source = Column(Text, nullable=False, default='', server_default='')
    involved_team_ids = Column(JSON, nullable=False, default=list, server_default='[]')
    tags = Column(JSON, nullable=False, default=list, server_default='[]')
    priority_id = Column(Integer, ForeignKey('priorities.id'))
    business_customer_id = Column(Integer, ForeignKey('business_customers.id'))
    department_id = Column(Integer, ForeignKey('departments.id'))
    did_client_group_id = Column(Integer, ForeignKey('did_client_groups.id'))
    legacy_task_id = Column(Integer, ForeignKey('tasks.id'), unique=True)
    legacy_snapshot = Column(JSON)
    is_archived = Column(Boolean, nullable=False, default=False, server_default='false')
    version = Column(Integer, nullable=False, default=1, server_default='1')
    model_version = Column(String(16), nullable=False, default='legacy_v1', server_default='legacy_v1')
    lifecycle_state = Column(String(16), nullable=False, default='draft', server_default='draft')
    preferred_result_type = Column(String(16))
    default_direction = Column(String(10))
    annual_aggregation = Column(String(10), nullable=False, default='none', server_default='none')
    aggregation_scale = Column(Integer, nullable=False, default=100, server_default='100')
    display_precision = Column(Integer, nullable=False, default=2, server_default='2')
    created_by = Column(Integer, ForeignKey('users.id'))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (CheckConstraint('version > 0', name='ck_kr_metric_version'),)


class MetricPeriod(Base):
    __tablename__ = 'kr_periods'
    id = Column(Integer, primary_key=True)
    metric_id = Column(Integer, ForeignKey('kr_metrics.id'), nullable=False, index=True)
    label = Column(String(120), nullable=False)
    start_date = Column(Date, nullable=False, index=True)
    end_date = Column(Date, nullable=False, index=True)
    state = Column(String(16), nullable=False, default='draft', server_default='draft')
    direction = Column(String(10))
    baseline = Column(Numeric(30, 10))
    baseline_date = Column(Date)
    target = Column(Numeric(30, 10))
    upper = Column(Numeric(30, 10))
    cadence = Column(String(16), nullable=False, default='weekly', server_default='weekly')
    interval_days = Column(Integer)
    first_due_date = Column(Date)
    weight = Column(Numeric(6, 2))
    forecast = Column(Numeric(6, 2))
    method_snapshot = Column(Text)
    source_snapshot = Column(Text)
    unit_snapshot = Column(String(50))
    outcome = Column(String(32))
    closing_note = Column(Text)
    closed_at = Column(DateTime(timezone=True))
    legacy_fact = Column(Numeric(30, 10))
    model_version = Column(String(16), nullable=False, default='legacy_v1', server_default='legacy_v1')
    calendar_year = Column(Integer)
    quarter = Column(Integer)
    result_type = Column(String(16))
    current_plan_revision_id = Column(Integer)
    current_fact_revision_id = Column(Integer)
    closure_revision_id = Column(Integer)
    __table_args__ = (
        CheckConstraint('start_date <= end_date', name='ck_kr_period_dates'),
        CheckConstraint("state IN ('draft','active','completed','cancelled')", name='ck_kr_period_state'),
        CheckConstraint("direction IS NULL OR direction IN ('up','down','range')", name='ck_kr_period_direction'),
        CheckConstraint("cadence IN ('none','daily','weekly','monthly','quarterly','interval')", name='ck_kr_period_cadence'),
        CheckConstraint("interval_days IS NULL OR interval_days BETWEEN 1 AND 366", name='ck_kr_period_interval'),
        UniqueConstraint('metric_id', 'start_date', 'end_date', name='uq_kr_period_dates'),
        UniqueConstraint('metric_id', 'calendar_year', 'quarter', name='uq_kr_period_quarter'),
    )


class MetricMeasurement(Base):
    __tablename__ = 'kr_measurements'
    id = Column(Integer, primary_key=True)
    period_id = Column(Integer, ForeignKey('kr_periods.id'), nullable=False, index=True)
    measured_on = Column(Date, nullable=False)
    value = Column(Numeric(30, 10), nullable=False)
    source = Column(Text, nullable=False)
    comment = Column(Text, nullable=False, default='', server_default='')
    author_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (UniqueConstraint('period_id', 'measured_on', name='uq_kr_measurement_date'),)


class MetricHistory(Base):
    __tablename__ = 'kr_history'
    id = Column(Integer, primary_key=True)
    metric_id = Column(Integer, ForeignKey('kr_metrics.id'), nullable=False, index=True)
    period_id = Column(Integer, ForeignKey('kr_periods.id'))
    actor_id = Column(Integer, ForeignKey('users.id'))
    action = Column(String(40), nullable=False)
    before = Column(JSON, nullable=False, default=dict, server_default='{}')
    after = Column(JSON, nullable=False, default=dict, server_default='{}')
    reason = Column(Text, nullable=False, default='', server_default='')
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class MetricComment(Base):
    __tablename__ = 'kr_comments'
    id = Column(Integer, primary_key=True)
    metric_id = Column(Integer, ForeignKey('kr_metrics.id'), nullable=False, index=True)
    period_id = Column(Integer, ForeignKey('kr_periods.id'))
    author_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    text = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class MetricLink(Base):
    __tablename__ = 'kr_links'
    id = Column(Integer, primary_key=True)
    metric_id = Column(Integer, ForeignKey('kr_metrics.id'), nullable=False, index=True)
    task_id = Column(Integer, ForeignKey('tasks.id'))
    work_task_id = Column(Integer, ForeignKey('work_tasks.id'))
    created_by = Column(Integer, ForeignKey('users.id'), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        CheckConstraint('(task_id IS NULL) <> (work_task_id IS NULL)', name='ck_kr_link_target'),
        UniqueConstraint('metric_id', 'task_id', name='uq_kr_link_task'),
        UniqueConstraint('metric_id', 'work_task_id', name='uq_kr_link_work'),
    )


class MetricFile(Base):
    __tablename__ = 'kr_files'
    id = Column(Integer, primary_key=True)
    metric_id = Column(Integer, ForeignKey('kr_metrics.id'), nullable=False, index=True)
    measurement_id = Column(Integer, ForeignKey('kr_measurements.id'))
    period_id = Column(Integer, ForeignKey('kr_periods.id'))
    author_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    filename = Column(String(255), nullable=False)
    storage_key = Column(String(80), nullable=False, unique=True)
    size = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    is_deleted = Column(Boolean, nullable=False, default=False, server_default='false')


class MetricReportingStatus(Base):
    __tablename__ = 'kr_reporting_statuses'
    id = Column(Integer, primary_key=True)
    metric_id = Column(Integer, ForeignKey('kr_metrics.id'), nullable=False, index=True)
    period_id = Column(Integer, ForeignKey('kr_periods.id'), nullable=False)
    meeting_id = Column(Integer, ForeignKey('reporting_meetings.id'), nullable=False)
    text = Column(Text, nullable=False)
    snapshot = Column(JSON, nullable=False)
    author_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (UniqueConstraint('period_id', 'meeting_id', name='uq_kr_reporting_period_meeting'),)
