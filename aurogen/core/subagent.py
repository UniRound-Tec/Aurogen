"""Subagent manager for background task execution."""

import asyncio
import json
import uuid
from pathlib import Path
from typing import Any

from loguru import logger

from core.tools.registry import ToolRegistry
from core.tools.filesystem import ReadFileTool, WriteFileTool, EditFileTool, ListDirTool
from core.tools.shell import ExecTool
from core.tools.web import WebFetchTool
from message.events import InboundMessage
from message.queue_manager import get_inbound_queue
from providers.base import AdapterResponse


class SubagentManager:
    """
    Manages background subagent execution.

    Subagents are lightweight agent instances that run in the background
    to handle specific tasks. They share the same LLM provider but have
    isolated context and a focused system prompt.
    """

    MAX_ITERATIONS = 15

    def __init__(self, provider: Any, workspace: Path):
        self.provider = provider
        self.workspace = workspace
        self._running_tasks: dict[str, asyncio.Task[None]] = {}

    async def spawn(
        self,
        task: str,
        label: str | None = None,
        origin_channel: str = "",
        origin_chat_id: str = "",
        agent_name: str = "main",
    ) -> str:
        task_id = str(uuid.uuid4())[:8]
        display_label = label or task[:30] + ("..." if len(task) > 30 else "")

        origin = {"channel": origin_channel, "chat_id": origin_chat_id}

        bg_task = asyncio.create_task(
            self._run_subagent(task_id, task, display_label, origin, agent_name)
        )
        self._running_tasks[task_id] = bg_task
        bg_task.add_done_callback(lambda _: self._running_tasks.pop(task_id, None))

        logger.info("Spawned subagent [{}]: {}", task_id, display_label)
        return f"Subagent [{display_label}] started (id: {task_id}). I'll notify you when it completes."

    async def _run_subagent(
        self,
        task_id: str,
        task: str,
        label: str,
        origin: dict[str, str],
        agent_name: str,
    ) -> None:
        """Execute the subagent task and announce the result."""
        logger.info("Subagent [{}] starting task: {}", task_id, label)

        try:
            agent_workspace = self.workspace / "agents" / agent_name

            tools = ToolRegistry()
            for cls in (ReadFileTool, WriteFileTool, EditFileTool, ListDirTool):
                tools.register(cls(workspace=agent_workspace, allowed_dir=None))
            tools.register(ExecTool(
                working_dir=str(agent_workspace),
                timeout=60,
                restrict_to_workspace=False,
                path_append="",
            ))
            tools.register(WebFetchTool(proxy=None))

            system_prompt = self._build_subagent_prompt(agent_workspace)
            messages: list[dict[str, Any]] = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": task},
            ]

            iteration = 0
            final_result: str | None = None

            while iteration < self.MAX_ITERATIONS:
                iteration += 1

                response: AdapterResponse = await asyncio.to_thread(
                    self.provider.response,
                    messages,
                    tools=tools.get_definitions(),
                    agent_name=agent_name,
                )

                if response.tool_calls:
                    asst_msg = {
                        "role": "assistant",
                        "content": response.content or "",
                        "tool_calls": response.tool_calls,
                    }
                    if response.thinking:
                        asst_msg["reasoning_content"] = response.thinking
                    if response.reasoning_details:
                        asst_msg["reasoning_details"] = response.reasoning_details
                    messages.append(asst_msg)

                    for tc in response.tool_calls:
                        tool_name = tc["function"]["name"]
                        raw_args = tc["function"]["arguments"]
                        tool_args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
                        tool_id = tc["id"]

                        logger.debug("Subagent [{}] executing: {}({})", task_id, tool_name, tool_args)
                        result = await tools.execute(tool_name, tool_args)

                        messages.append({
                            "role": "tool",
                            "tool_call_id": tool_id,
                            "name": tool_name,
                            "content": result,
                        })
                else:
                    final_result = response.content
                    break

            if final_result is None:
                final_result = "Task completed but no final response was generated."

            logger.info("Subagent [{}] completed successfully", task_id)
            await self._announce_result(task_id, label, task, final_result, origin, "ok")

        except Exception as e:
            error_msg = f"Error: {e}"
            logger.error("Subagent [{}] failed: {}", task_id, e)
            await self._announce_result(task_id, label, task, error_msg, origin, "error")

    async def _announce_result(
        self,
        task_id: str,
        label: str,
        task: str,
        result: str,
        origin: dict[str, str],
        status: str,
    ) -> None:
        """Announce the subagent result to the main agent via the inbound queue."""
        status_text = "completed successfully" if status == "ok" else "failed"

        announce_content = f"""[Subagent '{label}' {status_text}]

Task: {task}

Result:
{result}

Summarize this naturally for the user. Keep it brief (1-2 sentences). Do not mention technical details like "subagent" or task IDs."""

        session_id = f"{origin['channel']}@{origin['chat_id']}"
        await get_inbound_queue().put(InboundMessage(
            session_id=session_id,
            content=announce_content,
            metadata={"source": "subagent", "task_id": task_id},
        ))
        logger.debug("Subagent [{}] announced result to {}", task_id, session_id)

    @staticmethod
    def _build_subagent_prompt(agent_workspace: Path) -> str:
        """Build a focused system prompt for the subagent."""
        from datetime import datetime
        import time as _time

        now = datetime.now().strftime("%Y-%m-%d %H:%M (%A)")
        tz = _time.strftime("%Z") or "UTC"

        return f"""# Subagent

## Current Time
{now} ({tz})

You are a subagent spawned by the main agent to complete a specific task.

## Rules
1. Stay focused - complete only the assigned task, nothing else
2. Your final response will be reported back to the main agent
3. Do not initiate conversations or take on side tasks
4. Be concise but informative in your findings

## What You Can Do
- Read and write files in the workspace
- Execute shell commands
- Fetch web pages
- Complete the task thoroughly

## What You Cannot Do
- Send messages directly to users (no message tool available)
- Spawn other subagents
- Access the main agent's conversation history

## Workspace
Your workspace is at: {agent_workspace}
Skills are available at: {agent_workspace}/skills/ (read SKILL.md files as needed)

When you have completed the task, provide a clear summary of your findings or actions."""

    def get_running_count(self) -> int:
        """Return the number of currently running subagents."""
        return len(self._running_tasks)
