"""Pydantic schemas for the agent HTTP API."""
from typing import Any, Optional

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    session_id: str = ""
    message: str = Field(max_length=4000)
    context: Optional[dict] = None


class NewSessionRequest(BaseModel):
    user_id: int = 0
    context: Optional[dict] = None


class ResetRequest(BaseModel):
    session_id: str = ""


class SendForReviewRequest(BaseModel):
    session_id: str = ""
    task_id: int
    title: str = ""
    user_id: Optional[int] = None


class EditDraftSectionRequest(BaseModel):
    session_id: str = ""
    field: str = Field(min_length=1, max_length=64)
    value: str = Field(min_length=1, max_length=5000)
    user_id: Optional[int] = None


class AgentResponse(BaseModel):
    success: bool = True
    session_id: str = ""
    action: str = ""
    message: str = ""
    blocks: list = Field(default_factory=list)
    phase: str = ""
    slots: dict = Field(default_factory=dict)
    progress: list = Field(default_factory=list)
    draft: Optional[dict] = None
    can_generate_draft: bool = False
    history: list = Field(default_factory=list)
    quality: dict = Field(default_factory=dict)
    request_id: Optional[int] = None
    expected_slot: str = ""


class ConfigResponse(BaseModel):
    provider: str = ""
    provider_available: bool = False
    dialogue_engine: str = ""
    intents: dict = Field(default_factory=dict)
    kb_stats: dict = Field(default_factory=dict)
    mcp_servers: list = Field(default_factory=list)
    tools: list = Field(default_factory=list)
