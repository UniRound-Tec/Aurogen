from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal


GroupRunStatus = Literal["running", "completed", "failed", "stopped"]
GroupEventType = Literal[
    "run_started",
    "run_resumed",
    "user_instruction",
    "user_followup",
    "leader_delegate",
    "member_thinking",
    "member_tool_call",
    "member_tool_result",
    "member_reply",
    "leader_final",
    "run_completed",
    "run_failed",
    "run_stopped",
]
LeaderAction = Literal["delegate", "final", "stop"]


@dataclass
class GroupRunState:
    run_id: str
    title: str
    status: GroupRunStatus
    instruction: str
    leader_provider: str
    members: list[str]
    member_descriptions: dict[str, str] = field(default_factory=dict)
    agent_cursors: dict[str, int] = field(default_factory=dict)
    next_seq: int = 1
    created_at: str = ""
    updated_at: str = ""
    finished_at: str | None = None
    final_message: str | None = None
    error_message: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "GroupRunState":
        return cls(**data)


@dataclass
class GroupTranscriptEvent:
    seq: int
    type: GroupEventType
    speaker: str
    target: str
    content: str
    created_at: str
    meta: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class LeaderDecision:
    action: LeaderAction
    agent: str = ""
    instruction: str = ""
    message: str = ""
    reason: str = ""
