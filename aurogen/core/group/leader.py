from __future__ import annotations

import asyncio
import json
from typing import Any

from providers.providers import Provider

from core.group.types import GroupRunState, LeaderDecision

_GROUP_DECISION_TOOL = [
    {
        "type": "function",
        "function": {
            "name": "group_decision",
            "description": "Decide the next AgentGroup action.",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["delegate", "final", "stop"],
                        "description": "delegate = ask a member agent to continue, final = reply to user and finish, stop = stop the run.",
                    },
                    "agent": {
                        "type": "string",
                        "description": "Required when action=delegate. Must be one of the available member agents.",
                    },
                    "instruction": {
                        "type": "string",
                        "description": "Required when action=delegate. Clear task for the selected member agent.",
                    },
                    "message": {
                        "type": "string",
                        "description": "Required when action=final. Final answer for the user.",
                    },
                    "reason": {
                        "type": "string",
                        "description": "Optional explanation when action=stop.",
                    },
                },
                "required": ["action"],
            },
        },
    }
]

_LEADER_SYSTEM_PROMPT = """You are the leader of an AgentGroup.

Your job is to coordinate member agents toward the user's goal.
You have no workspace, no memory files, and no private session. You only know:
- the user's objective
- the available member agents and their descriptions
- the shared transcript so far

Rules:
1. Always decide by calling the group_decision tool.
2. Use delegate when a member agent should contribute the next step.
3. Use final only when the group has enough information to answer the user.
4. Use stop when the task should end without a final answer.
5. Be decisive and keep instructions concrete.
6. Do not ask the user questions. Work with the available members and transcript."""


class LeaderRuntime:
    def __init__(self, provider: Provider):
        self._provider = provider

    async def decide(self, run: GroupRunState, transcript: list[dict[str, Any]]) -> LeaderDecision:
        member_lines = "\n".join(
            f"- {member}: {run.member_descriptions.get(member, '').strip() or 'No description'}"
            for member in run.members
        )
        transcript_text = self._render_transcript(transcript)
        prompt = (
            f"Run ID: {run.run_id}\n"
            f"Status: {run.status}\n"
            f"User objective:\n{run.instruction}\n\n"
            f"Available members:\n{member_lines}\n\n"
            f"Shared transcript so far:\n{transcript_text}\n"
        )
        response = await asyncio.to_thread(
            self._provider.response_for_provider,
            run.leader_provider,
            [
                {"role": "system", "content": _LEADER_SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            tools=_GROUP_DECISION_TOOL,
        )
        if not response.tool_calls:
            content = (response.content or "").strip()
            if content:
                return LeaderDecision(action="final", message=content)
            raise ValueError("Leader did not return a group_decision tool call")

        raw_args = response.tool_calls[0]["function"]["arguments"]
        args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
        if not isinstance(args, dict):
            raise ValueError("Leader decision arguments must be an object")
        return LeaderDecision(
            action=args.get("action", "stop"),
            agent=args.get("agent", ""),
            instruction=args.get("instruction", ""),
            message=args.get("message", ""),
            reason=args.get("reason", ""),
        )

    @staticmethod
    def _render_transcript(transcript: list[dict[str, Any]]) -> str:
        if not transcript:
            return "(empty)"
        lines: list[str] = []
        for event in transcript:
            seq = event.get("seq", "?")
            event_type = event.get("type", "")
            speaker = event.get("speaker", "")
            target = event.get("target", "")
            content = str(event.get("content", "")).strip() or "(empty)"
            lines.append(f"[{seq}] {event_type} {speaker} -> {target}: {content}")
        return "\n".join(lines)
