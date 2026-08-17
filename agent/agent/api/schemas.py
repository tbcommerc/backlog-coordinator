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


class ConfigResponse(BaseModel):
    provider: str = ""
    provider_available: bool = False
    intents: dict = Field(default_factory=dict)
    kb_stats: dict = Field(default_factory=dict)
    mcp_servers: list = Field(default_factory=list)
    tools: list = Field(default_factory=list)
