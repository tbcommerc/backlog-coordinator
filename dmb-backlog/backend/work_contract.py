"""Strict write contracts for local work; no Task classification fields."""
from datetime import date
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Placement(Contract):
    major_task_id: int | None = Field(None, gt=0)
    direct_project_id: int | None = Field(None, gt=0)

    @model_validator(mode="after")
    def single_context(self):
        if self.major_task_id and self.direct_project_id:
            raise ValueError("Выберите задачу или проект, не оба контекста")
        return self


Priority = Literal["low", "normal", "high", "urgent"]


class ChecklistItem(Contract):
    id: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    title: str = Field(min_length=1, max_length=300)
    completed: bool = Field(False, strict=True)


def validate_checklist(items):
    if items is not None and len({item.id for item in items}) != len(items):
        raise ValueError("Номера пунктов чек-листа должны быть уникальны")
    return items


class WorkCreate(Placement):
    title: str = Field(min_length=1, max_length=255)
    work_direction: Literal["product", "organizational"]
    execution_team_id: int = Field(gt=0)
    description: str = Field("", max_length=30000)
    assignee_id: int | None = Field(None, gt=0)
    due_date: date | None = None
    acceptance_required: bool = False
    acceptor_id: int | None = Field(None, gt=0)
    priority: Priority = "normal"
    checklist: list[ChecklistItem] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def unique_items(self):
        validate_checklist(self.checklist)
        return self


class Version(Contract):
    version: int = Field(ge=1)


class WorkUpdate(Version):
    priority: Priority | None = None
    checklist: list[ChecklistItem] | None = Field(None, max_length=50)
    reason: str = Field("", max_length=5000)
    title: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = Field(None, max_length=30000)
    assignee_id: int | None = Field(None, gt=0)
    due_date: date | None = None
    acceptor_id: int | None = Field(None, gt=0)

    @model_validator(mode="after")
    def non_null_text(self):
        for field in ("title", "description", "priority", "checklist"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} не может быть null")
        validate_checklist(self.checklist)
        return self


class ChecklistToggle(Version):
    completed: bool = Field(strict=True)


class TemplateContent(Contract):
    title: str = Field(min_length=1, max_length=255)
    description: str = Field("", max_length=30000)
    priority: Priority = "normal"
    work_direction: Literal["product", "organizational"] = "organizational"
    acceptance_required: bool = False
    checklist: list[str] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def item_titles(self):
        self.checklist = [item.strip() for item in self.checklist]
        if any(not item or len(item) > 300 for item in self.checklist):
            raise ValueError("Пункт чек-листа должен содержать от 1 до 300 символов")
        return self


class TemplateCreate(Contract):
    name: str = Field(min_length=1, max_length=120)
    content: TemplateContent


class TemplateUpdate(TemplateCreate, Version):
    pass


class Move(Placement, Version):
    reason: str = Field(min_length=1, max_length=5000)


class Transition(Version):
    status: Literal["new", "ready", "in_progress", "in_acceptance", "done", "cancelled"]
    reason: str = Field("", max_length=5000)
    result_text: str = Field("", max_length=30000)


class Assignment(Version):
    decision: Literal["accepted", "declined"]
    reason: str = Field("", max_length=5000)
    assignee_id: int | None = Field(None, gt=0)
    due_date: date | None = None


class Comment(Version):
    body: str = Field(min_length=1, max_length=10000)


class Reassignment(Version):
    execution_team_id: int = Field(gt=0)
    reason: str = Field(min_length=1, max_length=5000)


class AcceptorChange(Version):
    acceptor_id: int = Field(gt=0)
    reason: str = Field(min_length=1, max_length=5000)
