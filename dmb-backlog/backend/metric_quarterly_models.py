"""Append-only quarterly revisions, scopes and pause intervals."""
from sqlalchemy import Column, Integer, String, Text, Date, DateTime, Numeric, JSON, ForeignKey, UniqueConstraint
from sqlalchemy.sql import func
from database import Base


class PlanRevision(Base):
    __tablename__ = 'kr_period_plan_revisions'
    id = Column(Integer, primary_key=True)
    period_id = Column(Integer, ForeignKey('kr_periods.id'), nullable=False)
    revision_no = Column(Integer, nullable=False)
    previous_revision_id = Column(Integer, ForeignKey('kr_period_plan_revisions.id'))
    data = Column(JSON, nullable=False)
    author_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    reason = Column(Text, nullable=False, default='')
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (UniqueConstraint('period_id', 'revision_no', name='uq_kr_plan_revision'),)


class FactRevision(Base):
    __tablename__ = 'kr_period_fact_revisions'
    id = Column(Integer, primary_key=True)
    period_id = Column(Integer, ForeignKey('kr_periods.id'), nullable=False)
    revision_no = Column(Integer, nullable=False)
    previous_revision_id = Column(Integer, ForeignKey('kr_period_fact_revisions.id'))
    value = Column(Numeric(30, 10), nullable=False)
    as_of_date = Column(Date, nullable=False)
    status = Column(String(16), nullable=False)
    source = Column(Text, nullable=False)
    comment = Column(Text, nullable=False, default='')
    reason = Column(Text, nullable=False, default='')
    source_measurement_id = Column(Integer, ForeignKey('kr_measurements.id'))
    source_measurement_snapshot = Column(JSON)
    numerator = Column(Numeric(30, 10))
    denominator = Column(Numeric(30, 10))
    author_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (UniqueConstraint('period_id', 'revision_no', name='uq_kr_fact_revision'),)


class ClosureRevision(Base):
    __tablename__ = 'kr_period_closure_revisions'
    id = Column(Integer, primary_key=True)
    period_id = Column(Integer, ForeignKey('kr_periods.id'), nullable=False, index=True)
    plan_revision_id = Column(Integer, ForeignKey('kr_period_plan_revisions.id'), nullable=False)
    fact_revision_id = Column(Integer, ForeignKey('kr_period_fact_revisions.id'), nullable=False)
    previous_revision_id = Column(Integer, ForeignKey('kr_period_closure_revisions.id'))
    author_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    snapshot = Column(JSON, nullable=False)
    comment = Column(Text, nullable=False, default='')
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class YearSettings(Base):
    __tablename__ = 'kr_year_settings'
    id = Column(Integer, primary_key=True)
    metric_id = Column(Integer, ForeignKey('kr_metrics.id'), nullable=False)
    year = Column(Integer, nullable=False)
    expected_quarters = Column(JSON, nullable=False)
    exclusions = Column(JSON, nullable=False, default=dict)
    aggregation = Column(String(10), nullable=False)
    scale = Column(Integer, nullable=False, default=100)
    __table_args__ = (UniqueConstraint('metric_id', 'year', name='uq_kr_year_settings'),)


class PauseInterval(Base):
    __tablename__ = 'kr_pause_intervals'
    id = Column(Integer, primary_key=True)
    metric_id = Column(Integer, ForeignKey('kr_metrics.id'), nullable=False, index=True)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date)
    author_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    reason = Column(Text, nullable=False)
