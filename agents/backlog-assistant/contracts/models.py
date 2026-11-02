from datetime import datetime
from typing import Any, Literal, Annotated
from pydantic import BaseModel, ConfigDict, Field, model_validator


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class QuerySpec(Strict):
    object_type: Literal["task", "request"] = "task"
    team_ids: list[int] = Field(default_factory=list, max_length=100)
    project_ids: list[int] = Field(default_factory=list, max_length=100)
    status_ids: list[int] = Field(default_factory=list, max_length=100)
    priority_ids: list[int] = Field(default_factory=list, max_length=100)
    relationship: Literal["all", "mine", "my_team"] = "all"
    period: str | None = Field(default=None, max_length=80)
    created_from: datetime | None = None
    created_to: datetime | None = None
    updated_from: datetime | None = None
    updated_to: datetime | None = None
    missing: list[Literal["owner", "effort", "effect", "period"]] = Field(default_factory=list)
    terms: list[Annotated[str, Field(min_length=1, max_length=200)]] = Field(default_factory=list, max_length=8)
    sort: Literal["id", "updated_desc"] = "id"
    cursor: int = Field(default=0, ge=0, le=1000000)


class Context(Strict):
    surface: Literal["backlog", "task", "request", "report", "assistant"] = "assistant"
    object_ref: str | None = Field(default=None, max_length=128)
    filters: QuerySpec = Field(default_factory=QuerySpec)
    timezone: Literal["Europe/Moscow"] = "Europe/Moscow"


class SessionCreate(Strict):
    context: Context = Field(default_factory=Context)


class MessageCreate(Strict):
    text: str = Field(min_length=1, max_length=8000)
    context_revision: int = Field(ge=1)
    context: Context
    execution_ref: str = Field(min_length=1, max_length=128)


class SessionPatch(Strict):
    context_revision: int = Field(ge=1)
    archived: bool = False
    context: Context | None = None


class Feedback(Strict):
    rating: Literal[-1, 1]
    reason_code: Literal["incorrect", "incomplete", "irrelevant", "helpful", "other"]
    comment: str = Field(default="", max_length=1000)


class Coverage(Strict):
    matched_total: int = Field(default=0, ge=0)
    displayed_count: int = Field(default=0, ge=0)
    history_complete: bool = False
    omitted_count: int = Field(default=0, ge=0)
    unknown_count: int = Field(default=0, ge=0)
    reasons: list[str] = Field(default_factory=list, max_length=20)


class Source(Strict):
    source_id: str
    receipt_ref: str
    kind: str
    version: str
    fields: list[str]


class ToolResult(Strict):
    contract_version: Literal["1.0"] = "1.0"
    tool_call_id: str
    execution_ref: str
    tool_name: str
    status: Literal["ok", "partial", "unavailable"]
    data: dict[str, Any]
    snapshot_ref: str
    observed_at: datetime
    coverage: Coverage
    sources: list[Source]
    limitations: list[str]


class Claim(Strict):
    text: str = Field(min_length=1, max_length=2000)
    type: Literal["fact", "inference", "recommendation"]
    source_ids: list[str] = Field(max_length=60)

    @model_validator(mode="after")
    def sources_required(self):
        if not self.source_ids:
            raise ValueError("Claims require evidence")
        return self


class DataBlock(Strict):
    type: Literal["table", "list", "metrics"]
    server_result_ref: str


class Clarification(Strict):
    question: str = Field(max_length=500)
    options: list[str] = Field(default_factory=list, max_length=5)


class Action(Strict):
    type: Literal["open_object", "open_results", "copy_summary", "open_existing_assistant"]
    object_ref: str | None = None
    server_result_ref: str | None = None


class Answer(Strict):
    schema_version: Literal["1.0"] = "1.0"
    kind: Literal["answer", "clarification", "no_results", "partial", "unavailable"]
    context: Context
    as_of: datetime
    summary_claims: list[Claim] = Field(default_factory=list, max_length=20)
    data_blocks: list[DataBlock] = Field(default_factory=list, max_length=6)
    sources: list[Source] = Field(default_factory=list, max_length=100)
    coverage: Coverage
    limitations: list[str] = Field(default_factory=list, max_length=20)
    clarification: Clarification | None = None
    actions: list[Action] = Field(default_factory=list, max_length=10)
    followups: list[str] = Field(default_factory=list, max_length=3)

    @model_validator(mode="after")
    def valid_links(self):
        ids = {s.source_id for s in self.sources}
        if len(ids) != len(self.sources):
            raise ValueError("Duplicate source")
        if any(set(c.source_ids) - ids for c in self.summary_claims):
            raise ValueError("Unknown source")
        if self.kind == "clarification" and not self.clarification:
            raise ValueError("Clarification question required")
        return self
