from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from config.schema import ThinkingLevel


class SetConfigRequest(BaseModel):
    path: str
    value: Any


class SendMessageRequest(BaseModel):
    session_id: str
    message: str
    metadata: Optional[dict] = None


class SessionInfo(BaseModel):
    session_id: str
    channel: str
    chat_id: str
    agent_name: str = ""
    title: str = ""
    message_count: int = 0
    updated_at: Optional[str] = None


class AddChannelRequest(BaseModel):
    key: str           # config key, also session_id prefix, e.g. "feishu_work"
    type: str          # channel type, e.g. "feishu"
    agent_name: str
    description: str = ""
    settings: dict[str, Any] = Field(default_factory=dict)
    emoji: str = ""


class AddAgentRequest(BaseModel):
    name: str           # agent key, also workspace dir name, e.g. "assistant"
    display_name: str   # display name, maps to AgentConfig.name
    description: str = ""
    provider: str
    emoji: str = ""


class UpdateAgentRequest(BaseModel):
    display_name: Optional[str] = None
    description: Optional[str] = None
    provider: Optional[str] = None
    emoji: Optional[str] = None


class WriteFileRequest(BaseModel):
    content: str


class AddProviderRequest(BaseModel):
    key: str
    type: str
    description: str = ""
    settings: dict[str, Any] = Field(default_factory=dict)
    model: str = ""
    memory_window: int = 100
    thinking: ThinkingLevel = "none"
    emoji: str = ""


class UpdateProviderRequest(BaseModel):
    type: Optional[str] = None
    description: Optional[str] = None
    settings: Optional[dict[str, Any]] = None
    model: Optional[str] = None
    memory_window: Optional[int] = None
    thinking: Optional[ThinkingLevel] = None
    emoji: Optional[str] = None


class UpdateChannelRequest(BaseModel):
    agent_name: Optional[str] = None
    description: Optional[str] = None
    settings: Optional[dict[str, Any]] = None
    emoji: Optional[str] = None


class CreateChatSessionRequest(BaseModel):
    channel: str = "web"
    chat_id: Optional[str] = None


class CreateAgentGroupRunRequest(BaseModel):
    members: list[str] = Field(default_factory=list)
    instruction: str
    title: Optional[str] = None


class AppendAgentGroupMessageRequest(BaseModel):
    message: str


class AgentGroupRunInfo(BaseModel):
    run_id: str
    title: str
    status: str
    instruction: str
    leader_provider: str
    members: list[str] = Field(default_factory=list)
    member_descriptions: dict[str, str] = Field(default_factory=dict)
    agent_cursors: dict[str, int] = Field(default_factory=dict)
    next_seq: int = 1
    created_at: str = ""
    updated_at: str = ""
    finished_at: Optional[str] = None
    final_message: Optional[str] = None
    error_message: Optional[str] = None


class AgentGroupEventsResponse(BaseModel):
    run_id: str
    status: str
    next_seq: int
    events: list[dict[str, Any]] = Field(default_factory=list)


class CheckAuthRequest(BaseModel):
    password: str


class SetPasswordRequest(BaseModel):
    password: str


class UpdateHeartbeatConfigRequest(BaseModel):
    interval_s: Optional[int] = None
    enabled: Optional[bool] = None


class AddMCPServerRequest(BaseModel):
    key: str
    command: str = ""
    args: list[str] = Field(default_factory=list)
    env: dict[str, str] = Field(default_factory=dict)
    url: str = ""
    headers: dict[str, str] = Field(default_factory=dict)
    tool_timeout: int = 30


class UpdateMCPServerRequest(BaseModel):
    command: Optional[str] = None
    args: Optional[list[str]] = None
    env: Optional[dict[str, str]] = None
    url: Optional[str] = None
    headers: Optional[dict[str, str]] = None
    tool_timeout: Optional[int] = None


# ── Skills ─────────────────────────────────────────────────────────────────────

# ── Cron Jobs ──────────────────────────────────────────────────────────────────

class CronScheduleInput(BaseModel):
    kind: Literal["at", "every", "cron"]
    at_ms: Optional[int] = None
    every_ms: Optional[int] = None
    expr: Optional[str] = None
    tz: Optional[str] = None


class AddCronJobRequest(BaseModel):
    name: str
    schedule: CronScheduleInput
    message: str
    deliver: bool = False
    channel: Optional[str] = None
    to: Optional[str] = None
    delete_after_run: bool = False


class UpdateCronJobRequest(BaseModel):
    name: Optional[str] = None
    enabled: Optional[bool] = None
    schedule: Optional[CronScheduleInput] = None
    message: Optional[str] = None
    deliver: Optional[bool] = None
    channel: Optional[str] = None
    to: Optional[str] = None
    delete_after_run: Optional[bool] = None


# ── Skills ─────────────────────────────────────────────────────────────────────

class SkillInfo(BaseModel):
    name: str
    description: str = ""
    source: str              # "builtin" | "workspace"
    agent_name: Optional[str] = None
    available: bool = True
    missing_requirements: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None


class SkillDetailResponse(BaseModel):
    name: str
    description: str = ""
    source: str
    agent_name: Optional[str] = None
    available: bool = True
    missing_requirements: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None
    content: str = ""