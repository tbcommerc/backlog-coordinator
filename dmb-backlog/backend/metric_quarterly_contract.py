"""Strict v2 commands: decimal strings, calendar coordinates and explicit intent."""
from datetime import date
from decimal import Decimal
from typing import Annotated, Literal
from pydantic import BeforeValidator, Field, model_validator, WithJsonSchema
from metric_contract import Command, Version
from services.metric_quarterly_rules import decimal_value

Number = Annotated[Decimal, BeforeValidator(decimal_value), WithJsonSchema({'type':'string','pattern':r'^-?\d+(?:\.\d{1,10})?$','description':'Десятичное число строкой; модуль не более 1e15'})]
Quarter = Annotated[int, Field(strict=True, ge=1, le=4)]
Year = Annotated[int, Field(strict=True, ge=1, le=9999)]
ResultType = Literal['volume', 'change', 'threshold', 'range']
Aggregation = Literal['sum', 'last', 'ratio', 'none']


class Plan(Command):
    quarter: Quarter
    result_type: ResultType | None = None
    direction: Literal['up', 'down', 'range'] | None = None
    target: Number | None = None
    upper: Number | None = None
    baseline: Number | None = None
    baseline_date: date | None = None
    cadence: Literal['none', 'daily', 'weekly', 'monthly', 'quarterly', 'interval'] = 'none'
    interval_days: int | None = Field(None, ge=1, le=366)
    first_due_date: date | None = None
    approve: bool = True
    reason: str = Field('', max_length=2000)
    confirm_revision: bool = False


class Create(Command):
    title: str = Field(min_length=1, max_length=255)
    team_id: int = Field(gt=0)
    owner_id: int | None = Field(None, gt=0)
    unit: str = Field('', max_length=50)
    description: str = Field('', max_length=10000)
    source: str = Field('', max_length=2000)
    method: str = Field('', max_length=10000)
    project_id: int | None = Field(None, gt=0)
    priority_id: int | None = Field(None,gt=0)
    business_customer_id: int | None = Field(None,gt=0)
    department_id: int | None = Field(None,gt=0)
    did_client_group_id: int | None = Field(None,gt=0)
    involved_team_ids: list[int] = Field(default_factory=list,max_length=100)
    tags: list[Annotated[str,Field(min_length=1,max_length=80)]] = Field(default_factory=list,max_length=30)
    preferred_result_type: ResultType | None = None
    default_direction: Literal['up', 'down', 'range'] | None = None
    annual_aggregation: Aggregation = 'none'
    aggregation_scale: Literal[1, 100] = 100
    display_precision: int = Field(2, ge=0, le=10)
    year: Year
    expected_quarters: list[Quarter] = Field(min_length=1, max_length=4)
    plans: list[Plan] = Field(default_factory=list, max_length=4)
    save_mode: Literal['draft', 'start'] = 'draft'

    @model_validator(mode='after')
    def unique_quarters(self):
        if len(set(self.expected_quarters)) != len(self.expected_quarters) or len({p.quarter for p in self.plans}) != len(self.plans):
            raise ValueError('Кварталы не должны повторяться')
        if any(p.quarter not in self.expected_quarters for p in self.plans):
            raise ValueError('План вне области ведения')
        self.expected_quarters.sort()
        return self


class Plans(Version):
    plans: list[Plan] = Field(min_length=1, max_length=4)

    @model_validator(mode='after')
    def unique_quarters(self):
        if len({p.quarter for p in self.plans}) != len(self.plans):
            raise ValueError('Кварталы не должны повторяться')
        return self


class Fact(Version):
    value: Number
    as_of_date: date
    source: str = Field('', max_length=2000)
    comment: str = Field('', max_length=5000)
    reason: str = Field('', max_length=2000)
    source_measurement_id: int | None = Field(None, gt=0)
    numerator: Number | None = None
    denominator: Number | None = None


class RatioPreview(Command):
    numerator: Number
    denominator: Number
    scale: Literal[1,100] = 100


class Close(Fact):
    confirm_final: bool = False
    confirm_early_as_of: bool = False


class Revise(Plan, Version):
    pass


class Reason(Version):
    reason: str = Field(min_length=1, max_length=2000)


class Lifecycle(Version):
    action: Literal['start', 'pause', 'resume']
    reason: str = Field('', max_length=2000)


class Archive(Reason):
    archive: bool


class Measurement(Version):
    value: Number
    measured_on: date
    source: str = Field('', max_length=2000)
    comment: str = Field('', max_length=5000)
    reason: str = Field('', max_length=2000)


class Settings(Reason):
    expected_quarters: list[Quarter] = Field(min_length=1, max_length=4)
    exclusions: dict[str, str] = Field(default_factory=dict)
    aggregation: Aggregation
    scale: Literal[1, 100] = 100

    @model_validator(mode='after')
    def valid_scope(self):
        if len(set(self.expected_quarters)) != len(self.expected_quarters):
            raise ValueError('Кварталы не должны повторяться')
        if any(k not in ('1','2','3','4') or int(k) not in self.expected_quarters or not v.strip() for k,v in self.exclusions.items()):
            raise ValueError('Исключение требует квартал из области и причину')
        self.expected_quarters.sort()
        return self


class PassportPatch(Version):
    title: str | None = Field(None, min_length=1, max_length=255)
    team_id: int | None = Field(None, gt=0)
    owner_id: int | None = Field(None, gt=0)
    project_id: int | None = Field(None, gt=0)
    priority_id: int | None = Field(None,gt=0)
    business_customer_id: int | None = Field(None,gt=0)
    department_id: int | None = Field(None,gt=0)
    did_client_group_id: int | None = Field(None,gt=0)
    involved_team_ids: list[int] | None = Field(None,max_length=100)
    tags: list[Annotated[str,Field(min_length=1,max_length=80)]] | None = Field(None,max_length=30)
    unit: str | None = Field(None, max_length=50)
    description: str | None = Field(None, max_length=10000)
    source: str | None = Field(None, max_length=2000)
    method: str | None = Field(None, max_length=10000)
    display_precision: int | None = Field(None, ge=0, le=10)
    reason: str = Field('', max_length=2000)


class MigrationChoice(Command):
    period_id: int = Field(gt=0)
    result_type: ResultType
    fact: Close | None = None
    coverage_year: Year | None = None
    coverage_plans: list[Plan] = Field(default_factory=list,max_length=4)
    coverage_year: Year | None = None
    coverage_plans: list[Plan] = Field(default_factory=list,max_length=4)


class Migrate(Reason):
    choices: list[MigrationChoice] = Field(min_length=1,max_length=100)
    annual_aggregation: Aggregation = 'none'

    @model_validator(mode='after')
    def unique_periods(self):
        if len({p.period_id for p in self.choices})!=len(self.choices):
            raise ValueError('Периоды не должны повторяться')
        return self


class Comment(Version):
    text: str = Field(min_length=1,max_length=10000)
    period_id: int | None = Field(None,gt=0)
