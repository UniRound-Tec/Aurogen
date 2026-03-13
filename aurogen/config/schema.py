from pydantic import BaseModel, Field
from typing import Any, Dict, Literal

ThinkingLevel = Literal["none", "low", "medium", "high"]


class AgentConfig(BaseModel):
    name: str
    description: str
    provider: str
    emoji: str = ""
    bootstrap_completed: bool = False


class ProviderConfig(BaseModel):
    type: str
    description: str = ""
    settings: dict[str, Any] = Field(default_factory=dict)
    model: str = ""
    memory_window: int = 100
    thinking: ThinkingLevel = "none"
    emoji: str = ""


class ChannelConfig(BaseModel):
    type: str                   # channel 类型，对应 CHANNEL_REGISTRY 中的 key，如 "web" / "feishu"
    agent_name: str
    description: str = ""
    settings: dict = {}         # channel 类型专属配置（凭证等），schema 不感知细节
    emoji: str = ""


class MCPServerConfig(BaseModel):
    command: str = ""
    args: list[str] = []
    env: dict[str, str] = {}
    url: str = ""
    headers: dict[str, str] = {}
    tool_timeout: int = 30


class AuthConfig(BaseModel):
    password: str = ""
    first_login: bool = True


class HeartbeatConfig(BaseModel):
    interval_s: int = 1800
    enabled: bool = True


class LeaderAgentConfig(BaseModel):
    provider: str


class RuntimeLimitsConfig(BaseModel):
    agent_loop_max_iterations: int = 40
    group_max_turns: int = 12


class AppConfig(BaseModel):
    agents: Dict[str, AgentConfig] = {}
    providers: Dict[str, ProviderConfig] = {}
    channels: Dict[str, ChannelConfig] = {}
    mcp: Dict[str, MCPServerConfig] = {}
    auth: AuthConfig = Field(default_factory=AuthConfig)
    heartbeat: Dict[str, HeartbeatConfig] = Field(default_factory=dict)
    leader_agent: LeaderAgentConfig | None = None
    runtime: RuntimeLimitsConfig = Field(default_factory=RuntimeLimitsConfig)
