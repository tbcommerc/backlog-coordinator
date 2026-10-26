"""User-reviewed meeting drafts. No directory/user/team writes belong here."""
from datetime import date
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class MeetingItem(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    id: str = Field(min_length=1, max_length=64)
    kind: Literal["action", "agreement"] = "action"
    title: str = Field(min_length=1, max_length=255)
    description: str = Field(default="", max_length=5000)
    owner_text: str = Field(default="", max_length=255)
    due_date: date | None = None
    due_text: str = Field(default="", max_length=255)
    quote: str = Field(default="", max_length=4000)
    origin: Literal["ai", "manual"] = "manual"
    selected: bool = False
    link_choice: Literal["task", "none"] | None = None
    task_id: int | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def validate_link(self):
        if self.task_id is not None and self.link_choice != "task":
            raise ValueError("Связь с крупной задачей должна быть выбрана явно")
        return self


class MeetingDraft(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=255)
    meeting_date: date | None = None
    transcript: str = Field(default="", max_length=60000)
    items: list[MeetingItem] = Field(default_factory=list, max_length=60)

    @model_validator(mode="after")
    def validate_items(self):
        if len({item.id for item in self.items}) != len(self.items):
            raise ValueError("Идентификаторы пунктов должны быть уникальны")
        for item in self.items:
            if item.origin == "ai" and (not item.quote or item.quote not in self.transcript):
                raise ValueError("Цитата AI-пункта должна присутствовать в расшифровке")
        return self


class DraftUpdate(MeetingDraft):
    version: int = Field(ge=1)


class VersionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: int = Field(ge=1)


def confirmed_items(draft: MeetingDraft) -> list[MeetingItem]:
    items = [item for item in draft.items if item.selected]
    if not items:
        raise ValueError("Отметьте хотя бы одно поручение или договорённость")
    if any(item.link_choice is None for item in items):
        raise ValueError("Для каждого выбранного пункта укажите крупную задачу или «Без привязки»")
    if any(item.link_choice == "task" and item.task_id is None for item in items):
        raise ValueError("Выберите крупную задачу из результатов поиска")
    return items
