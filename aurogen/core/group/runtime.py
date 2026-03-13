from __future__ import annotations

import asyncio
from pathlib import Path
from uuid import uuid4

from config.config import config_manager
from core.core import AgentLoop
from core.group.leader import LeaderRuntime
from core.group.store import GroupStore
from core.group.types import GroupRunState, LeaderDecision
from providers.providers import Provider


class AgentGroupManager:
    def __init__(self, workspace_root: Path, provider: Provider, agent_loop: AgentLoop):
        self._workspace_root = workspace_root
        self._provider = provider
        self._agent_loop = agent_loop
        self._store = GroupStore(workspace_root)
        self._leader = LeaderRuntime(provider)
        self._tasks: dict[str, asyncio.Task[None]] = {}

    def _max_turns(self) -> int:
        value = config_manager.get("runtime.group_max_turns", 12)
        if isinstance(value, int) and value > 0:
            return value
        return 12

    def _start_run_task(self, run_id: str) -> None:
        task = asyncio.create_task(self._run_loop(run_id))
        self._tasks[run_id] = task
        task.add_done_callback(lambda _: self._tasks.pop(run_id, None))

    async def start_run(
        self,
        *,
        members: list[str],
        instruction: str,
        title: str | None = None,
    ) -> dict:
        instruction = instruction.strip()
        if not instruction:
            raise ValueError("instruction is required")
        if not members:
            raise ValueError("members is required")

        configured_agents = config_manager.get("agents", {})
        unknown_members = [member for member in members if member not in configured_agents]
        if unknown_members:
            raise ValueError(f"Unknown agent(s): {', '.join(unknown_members)}")

        leader_provider = config_manager.get("leader_agent.provider", "")
        if not leader_provider:
            raise ValueError("leader_agent.provider is not configured")
        if not config_manager.get(f"providers.{leader_provider}"):
            raise ValueError(f"Unknown leader provider: {leader_provider}")

        unique_members = list(dict.fromkeys(members))
        run_id = uuid4().hex[:10]
        resolved_title = (title or instruction[:60]).strip() or f"group-{run_id}"
        member_descriptions = {
            member: config_manager.get(f"agents.{member}.description", "")
            for member in unique_members
        }
        state = self._store.create_run(
            run_id=run_id,
            title=resolved_title,
            instruction=instruction,
            leader_provider=leader_provider,
            members=unique_members,
            member_descriptions=member_descriptions,
        )
        self._store.append_event(
            run_id,
            event_type="run_started",
            speaker="system",
            target="group",
            content=f"AgentGroup run '{resolved_title}' started.",
            meta={"members": unique_members, "leader_provider": leader_provider},
        )
        self._store.append_event(
            run_id,
            event_type="user_instruction",
            speaker="user",
            target="leader",
            content=instruction,
        )

        self._start_run_task(run_id)
        return self._store.load_run(run_id).to_dict()

    def list_runs(self) -> list[dict]:
        return self._store.list_runs()

    def get_run(self, run_id: str) -> dict:
        return self._store.load_run(run_id).to_dict()

    def get_events(self, run_id: str, after_seq: int = 0) -> dict:
        run = self._store.load_run(run_id)
        events = self._store.read_events(run_id, after_seq=after_seq)
        return {
            "run_id": run_id,
            "status": run.status,
            "events": events,
            "next_seq": run.next_seq,
        }

    async def stop_all(self) -> None:
        tasks = list(self._tasks.values())
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def stop_run(self, run_id: str) -> dict:
        task = self._tasks.get(run_id)
        if task and not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        else:
            run = self._store.load_run(run_id)
            if run.status == "running":
                self._store.append_event(
                    run_id,
                    event_type="run_stopped",
                    speaker="system",
                    target="group",
                    content="Run stopped by user.",
                )
                run = self._store.load_run(run_id)
                run.status = "stopped"
                run.finished_at = run.updated_at
                self._store.save_run(run)
        return self.get_run(run_id)

    def append_user_message(self, run_id: str, message: str) -> dict:
        text = message.strip()
        if not text:
            raise ValueError("message is required")
        run = self._store.load_run(run_id)
        task = self._tasks.get(run_id)
        self._store.append_event(
            run_id,
            event_type="user_followup",
            speaker="user",
            target="leader",
            content=text,
        )
        if run.status != "running" and (task is None or task.done()):
            self._store.append_event(
                run_id,
                event_type="run_resumed",
                speaker="system",
                target="group",
                content="Run resumed with a new user message.",
            )
            run = self._store.load_run(run_id)
            run.status = "running"
            run.finished_at = None
            run.final_message = None
            run.error_message = None
            self._store.save_run(run)
            self._start_run_task(run_id)
        return self.get_run(run_id)

    async def _run_loop(self, run_id: str) -> None:
        try:
            max_turns = self._max_turns()
            turns = 0
            while turns < max_turns:
                turns += 1
                run = self._store.load_run(run_id)
                transcript = self._store.read_events(run_id)
                decision = await self._leader.decide(run, transcript)
                await self._apply_decision(run, decision)
                run = self._store.load_run(run_id)
                if run.status != "running":
                    return

            run = self._store.load_run(run_id)
            self._store.append_event(
                run_id,
                event_type="run_failed",
                speaker="system",
                target="group",
                content=f"Reached max turns ({max_turns}).",
            )
            run = self._store.load_run(run_id)
            run.status = "failed"
            run.error_message = f"Reached max turns ({max_turns})."
            run.finished_at = run.updated_at
            self._store.save_run(run)
        except asyncio.CancelledError:
            run = self._store.load_run(run_id)
            if run.status == "running":
                self._store.append_event(
                    run_id,
                    event_type="run_stopped",
                    speaker="system",
                    target="group",
                    content="Run stopped by user.",
                )
                run = self._store.load_run(run_id)
                run.status = "stopped"
                run.finished_at = run.updated_at
                self._store.save_run(run)
            raise
        except Exception as exc:
            self._store.append_event(
                run_id,
                event_type="run_failed",
                speaker="system",
                target="group",
                content=str(exc),
            )
            run = self._store.load_run(run_id)
            run.status = "failed"
            run.error_message = str(exc)
            run.finished_at = run.updated_at
            self._store.save_run(run)

    async def _apply_decision(self, run: GroupRunState, decision: LeaderDecision) -> None:
        if decision.action == "delegate":
            await self._run_member_turn(run, decision)
            return

        if decision.action == "final":
            final_message = (decision.message or "").strip()
            if not final_message:
                raise ValueError("Leader returned final without message")
            self._store.append_event(
                run.run_id,
                event_type="leader_final",
                speaker="leader",
                target="user",
                content=final_message,
            )
            self._store.append_event(
                run.run_id,
                event_type="run_completed",
                speaker="system",
                target="group",
                content="Run completed.",
            )
            updated = self._store.load_run(run.run_id)
            updated.status = "completed"
            updated.final_message = final_message
            updated.finished_at = updated.updated_at
            self._store.save_run(updated)
            return

        if decision.action == "stop":
            reason = (decision.reason or "").strip() or "Leader stopped the run."
            self._store.append_event(
                run.run_id,
                event_type="run_stopped",
                speaker="leader",
                target="group",
                content=reason,
            )
            updated = self._store.load_run(run.run_id)
            updated.status = "stopped"
            updated.finished_at = updated.updated_at
            self._store.save_run(updated)
            return

        raise ValueError(f"Unsupported leader action: {decision.action}")

    async def _run_member_turn(self, run: GroupRunState, decision: LeaderDecision) -> None:
        agent_name = decision.agent.strip()
        if not agent_name:
            raise ValueError("Leader delegate action requires agent")
        if agent_name not in run.members:
            raise ValueError(f"Leader selected non-member agent: {agent_name}")

        instruction = decision.instruction.strip()
        if not instruction:
            raise ValueError("Leader delegate action requires instruction")

        delta_events = self._store.read_events(
            run.run_id,
            after_seq=run.agent_cursors.get(agent_name, 0),
        )
        self._store.append_event(
            run.run_id,
            event_type="leader_delegate",
            speaker="leader",
            target=agent_name,
            content=instruction,
        )
        prompt = self._build_member_prompt(run, agent_name, instruction, delta_events)
        result = await self._agent_loop.execute_once(
            session_id=f"group@{run.run_id}",
            content=prompt,
            agent_name=agent_name,
            notify_channel_events=False,
            deliver_final=False,
            disabled_tools={"message", "spawn"},
            event_sink=self._build_member_event_sink(run.run_id, agent_name),
        )
        self._store.append_event(
            run.run_id,
            event_type="member_reply",
            speaker=agent_name,
            target="leader",
            content=result.final_content,
        )
        updated = self._store.load_run(run.run_id)
        updated.agent_cursors[agent_name] = updated.next_seq - 1
        self._store.save_run(updated)

    def _build_member_prompt(
        self,
        run: GroupRunState,
        agent_name: str,
        instruction: str,
        delta_events: list[dict],
    ) -> str:
        delta_text = self._render_delta_events(delta_events, agent_name)
        return (
            f"[Group Goal]\n{run.instruction}\n\n"
            f"[New Context Since Your Last Turn]\n{delta_text}\n\n"
            f"[Instruction From Leader]\n{instruction}\n"
        )

    def _render_delta_events(self, events: list[dict], agent_name: str) -> str:
        lines: list[str] = []
        for event in events:
            if event.get("speaker") == agent_name:
                continue
            lines.append(
                f"[{event.get('seq', '?')}] {event.get('type', '')} "
                f"{event.get('speaker', '')} -> {event.get('target', '')}: "
                f"{str(event.get('content', '')).strip() or '(empty)'}"
            )
        return "\n".join(lines) if lines else "(no new shared context)"

    def _build_member_event_sink(self, run_id: str, agent_name: str):
        async def _sink(kind: str, data: dict) -> None:
            if kind == "thinking":
                self._store.append_event(
                    run_id,
                    event_type="member_thinking",
                    speaker=agent_name,
                    target="leader",
                    content=str(data.get("content", "")),
                )
            elif kind == "tool_call":
                self._store.append_event(
                    run_id,
                    event_type="member_tool_call",
                    speaker=agent_name,
                    target="tool",
                    content=str(data.get("tool_name", "")),
                    meta={"args": data.get("args")},
                )
            elif kind == "tool_result":
                self._store.append_event(
                    run_id,
                    event_type="member_tool_result",
                    speaker=agent_name,
                    target="leader",
                    content=str(data.get("result", "")),
                    meta={"tool_name": data.get("tool_name", "")},
                )

        return _sink
