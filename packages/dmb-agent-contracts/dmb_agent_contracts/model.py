from datetime import datetime, timezone
from typing import Literal, Protocol
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", protected_namespaces=())


class Message(StrictModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1)


class ModelRequest(StrictModel):
    request_id: UUID
    run_id: UUID
    conversation_ref: str | None = None
    purpose: Literal["dialogue", "extraction", "document_generation", "document_review", "factor_assessment", "answer"]
    messages: list[Message] = Field(min_length=1)
    system_prompt: str
    output_schema: dict | None = None
    model_profile: str
    deadline_at: datetime
    max_output_tokens: int = Field(gt=0, le=32000)
    temperature: float = Field(default=0, ge=0, le=2)
    reasoning_effort: Literal["low", "medium", "high"] | None = None
    allowed_tools: list[dict] = Field(default_factory=list)

    @field_validator("deadline_at")
    @classmethod
    def aware(cls, value):
        if value.tzinfo is None:
            raise ValueError("deadline_at requires timezone")
        return value.astimezone(timezone.utc)


class Usage(StrictModel):
    input_tokens: StrictInt | None = Field(default=None, ge=0)
    output_tokens: StrictInt | None = Field(default=None, ge=0)
    reasoning_tokens: StrictInt | None = Field(default=None, ge=0)
    cache_tokens: StrictInt | None = Field(default=None, ge=0)
    cost: float | None = Field(default=None, strict=True, ge=0, allow_inf_nan=False)
    allowance: float | None = Field(default=None, strict=True, ge=0, allow_inf_nan=False)
    unavailable_reason: str | None = None


class ModelResult(StrictModel):
    text: str
    structured: dict | None = None
    finish_reason: str
    usage: Usage
    provider_request_ref: str | None = None
    model_actual: str
    attempt_count: int = 1
    elapsed_ms: int
    validation_status: Literal["pending", "valid", "invalid"] = "pending"


class ModelPort(Protocol):
    def complete(self, request: ModelRequest) -> ModelResult: ...


class AgentError(RuntimeError):
    """Only safe codes cross the transport boundary."""
    def __init__(self, code: str, status: int = 503):
        self.code, self.status = code, status
        super().__init__(code)
