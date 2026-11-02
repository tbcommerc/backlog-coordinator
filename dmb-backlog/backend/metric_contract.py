"""Validated metric commands. No reference-data mutations."""
from datetime import date
from typing import Literal, Optional
from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, field_validator, model_validator

class Command(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)

class Version(Command):
    version: int = Field(ge=1)

class Passport(Command):
    title: str = Field(min_length=1, max_length=255)
    description: str = Field(default='', max_length=10000)
    team_id: int = Field(gt=0)
    owner_id: int = Field(gt=0)
    unit: str = Field(min_length=1, max_length=50)
    method: str = Field(default='', max_length=10000)
    source: str = Field(default='', max_length=2000)
    project_id: Optional[int] = Field(default=None, gt=0)
    priority_id: Optional[int] = Field(default=None, gt=0)
    business_customer_id: Optional[int] = Field(default=None, gt=0)
    department_id: Optional[int] = Field(default=None, gt=0)
    did_client_group_id: Optional[int] = Field(default=None, gt=0)
    involved_team_ids: list[int] = Field(default_factory=list, max_length=100)
    tags: list[str] = Field(default_factory=list, max_length=30)

    @field_validator('tags')
    @classmethod
    def tags_valid(cls, values):
        if any(not v.strip() or len(v) > 80 for v in values):
            raise ValueError('Тег должен содержать от 1 до 80 символов')
        return list(dict.fromkeys(v.strip() for v in values))

class PassportUpdate(Passport, Version):
    reason: str = Field(default='', max_length=2000)

class PeriodCommand(Version):
    label: str = Field(min_length=1, max_length=120)
    start_date: date
    end_date: date
    direction: Optional[Literal['up','down','range']] = None
    baseline: Optional[FiniteFloat] = Field(default=None, ge=-1e15, le=1e15)
    baseline_date: Optional[date] = None
    target: Optional[FiniteFloat] = Field(default=None, ge=-1e15, le=1e15)
    upper: Optional[FiniteFloat] = Field(default=None, ge=-1e15, le=1e15)
    cadence: Literal['daily','weekly','monthly','quarterly','interval'] = 'weekly'
    interval_days: Optional[int] = Field(default=None, ge=1, le=366)
    first_due_date: Optional[date] = None
    weight: Optional[FiniteFloat] = Field(default=None, ge=0, le=100)
    forecast: Optional[FiniteFloat] = Field(default=None, ge=0, le=100)
    reason: str = Field(default='', max_length=2000)

    @model_validator(mode='after')
    def period_dates(self):
        if self.end_date < self.start_date or (self.end_date-self.start_date).days > 3660:
            raise ValueError('Период должен быть от 1 дня до 10 лет')
        if self.first_due_date and not self.start_date <= self.first_due_date <= self.end_date:
            raise ValueError('Первое измерение должно быть внутри периода')
        if self.cadence == 'interval' and self.interval_days is None:
            raise ValueError('Укажите интервал измерений')
        return self

class MeasurementCommand(Version):
    value: FiniteFloat = Field(ge=-1e15, le=1e15)
    measured_on: date
    source: str = Field(min_length=1, max_length=2000)
    comment: str = Field(default='', max_length=5000)
    reason: str = Field(default='', max_length=2000)

class Transition(Version):
    action: Literal['activate','complete','cancel','reopen']
    reason: str = Field(default='', max_length=5000)
    confirm_no_data: bool = False

class CommentCommand(Version):
    text: str = Field(min_length=1, max_length=10000)

class LinkCommand(Version):
    kind: Literal['task','work']
    target_id: int = Field(gt=0)

class ReportCommand(Version):
    period_id: int = Field(gt=0)
    meeting_id: int = Field(gt=0)
    text: str = Field(min_length=1, max_length=10000)

class ArchiveCommand(Version):
    archive: bool
    reason: str = Field(min_length=1, max_length=2000)
