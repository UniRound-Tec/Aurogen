"""Agent loop: the core processing engine."""

import asyncio
import json
import re
from contextlib import AsyncExitStack
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable

from channels.manager import get_channel_manager
from config.config import config_manager
from core.memory import MemoryStore
from core.tools.cron import CronTool
from core.tools.memory import MemoryTool
from core.tools.mcp import connect_mcp_servers
from core.tools.web import WebFetchTool, WebSearchTool
from cron import CronJob, CronService
from message.queue_manager import get_inbound_queue
from message.session_manager import Session
from message.events import InboundMessage, EventType, AgentEvent
from core.tools.registry import ToolRegistry
from providers.base import AdapterResponse

from core.tools.filesystem import EditFileTool, ListDirTool, ReadFileTool, WriteFileTool
from core.tools.message import MessageTool
from core.tools.shell import ExecTool
from core.tools.spawn import SpawnTool
from core.subagent import SubagentManager


def _normalize_command_text(content: str) -> str:
    """Normalize command text from chat channels that may inject mentions/zero-width chars."""
    text = content.strip()
    text = re.sub(r"[\u200b-\u200d\ufeff]", "", text)
    text = re.sub(r"<at\b[^>]*>.*?</at>", " ", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"@[\w.\-]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


ExecutionEventSink = Callable[[str, dict[str, Any]], Awaitable[None]]


@dataclass
class ExecutionResult:
    final_content: str
    agent_name: str
    session_id: str
    message_tool_content: str | None = None


class AgentLoop:
    """
    Agent 循环引擎，支持多轮 tool 调用。

    核心流程:
    1. 收到消息 → 构建上下文（历史 + 当前消息）
    2. 调用 LLM
    3. 如果 LLM 返回 tool_calls → 执行工具 → 结果加入历史 → 回到步骤 2
    4. 如果 LLM 返回文本 → 返回最终回复
    """

    def __init__(
        self,
        provider: Any = None,
        workspace: str | Path = ".",
        restrict_to_workspace: bool = True,
        exec_config: dict | None = None,
    ):
        self._running = False
        self.provider = provider
        self.tools = ToolRegistry()
        self.workspace = Path(workspace).resolve()
        self.restrict_to_workspace = False
        self._session_locks: dict[str, asyncio.Lock] = {}
        self.cron_service = CronService(
            self.workspace / "cron" / "jobs.json",
            on_job=self._handle_cron_job,
        )
        self._mcp_stack: AsyncExitStack | None = None
        self._register_default_tools()
        self.subagent_manager = SubagentManager(provider=self.provider, workspace=self.workspace)
        self.tools.register(SpawnTool(self.subagent_manager))

    def _max_iterations(self) -> int:
        value = config_manager.get("runtime.agent_loop_max_iterations", 40)
        if isinstance(value, int) and value > 0:
            return value
        return 40

    async def _handle_cron_job(self, job: CronJob) -> str | None:
        """Cron 任务回调：将消息注入入站队列，由 agent 正常处理并回复。"""
        payload = job.payload
        if payload.deliver:
            if not payload.channel or not payload.to:
                raise ValueError("deliver cron job requires both channel and to")
            session_id = f"{payload.channel}@{payload.to}"
            agent_name = config_manager.get(f"channels.{payload.channel}.agent_name")
        else:
            # Silent cron jobs still need a valid session so the agent can run normally.
            session_id = f"web@cron:{job.id}"
            agent_name = config_manager.get("channels.web.agent_name", "main")

        msg = InboundMessage(
            session_id=session_id,
            content=payload.message,
            agent_name=agent_name,
            metadata={"source": "cron", "job_id": job.id},
        )
        await get_inbound_queue().put(msg)
        print(f"[Cron] 任务 '{job.name}' 已投递到 {session_id}")
        return "delivered"

    def _register_default_tools(self) -> None:
        """注册工具"""
        allowed_dir = self.workspace if self.restrict_to_workspace else None
        for cls in (ReadFileTool, WriteFileTool, EditFileTool, ListDirTool):
            self.tools.register(cls(workspace=self.workspace, allowed_dir=allowed_dir))
        self.tools.register(
            ExecTool(
                working_dir=str(self.workspace),
                timeout=60,
                restrict_to_workspace=self.restrict_to_workspace,
                path_append="",
            )
        )
        self.tools.register(WebSearchTool(proxy=None))
        self.tools.register(WebFetchTool(proxy=None))
        self.tools.register(CronTool(cron_service=self.cron_service))
        self.tools.register(MemoryTool(workspace=self.workspace))
        self.tools.register(MessageTool())

    async def _setup_mcp(self) -> None:
        """连接 config 中配置的所有 MCP servers 并注册其工具。"""
        mcp_cfg = config_manager.config.mcp
        if not mcp_cfg:
            return
        if self._mcp_stack:
            await self._mcp_stack.aclose()
        for name in list(self.tools.tool_names):
            if name.startswith("mcp_"):
                self.tools.unregister(name)
        self._mcp_stack = AsyncExitStack()
        await self._mcp_stack.__aenter__()
        await connect_mcp_servers(mcp_cfg, self.tools, self._mcp_stack)

    async def reload_mcp(self) -> None:
        """重新读取 config 并重连所有 MCP servers（动态加载）。"""
        config_manager.reload()
        await self._setup_mcp()

    async def run(self) -> None:
        """运行 agent loop，异步消费消息。"""
        self._running = True
        await self.cron_service.start()
        await self._setup_mcp()
        print("[AgentLoop] Starting...")

        inbound = get_inbound_queue()

        try:
            while self._running:
                try:
                    msg = await asyncio.wait_for(inbound.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue

                # 异步处理消息
                asyncio.create_task(self._process_message_serialized(msg))
        finally:
            if self._mcp_stack:
                await self._mcp_stack.aclose()
                self._mcp_stack = None

    def stop(self) -> None:
        """停止 agent loop。"""
        self._running = False
        self.cron_service.stop()
        print("[AgentLoop] 停止中...")

    def _get_session_lock(self, session_id: str) -> asyncio.Lock:
        lock = self._session_locks.get(session_id)
        if lock is None:
            lock = asyncio.Lock()
            self._session_locks[session_id] = lock
        return lock

    async def _process_message_serialized(self, msg: InboundMessage) -> None:
        """Serialize processing per session to avoid stale session overwrites."""
        lock = self._get_session_lock(msg.session_id)
        async with lock:
            await self._process_message(msg)

    async def execute_once(
        self,
        *,
        session_id: str,
        content: str,
        agent_name: str,
        metadata: dict | None = None,
        event_sink: ExecutionEventSink | None = None,
        notify_channel_events: bool = True,
        deliver_final: bool = True,
        disabled_tools: set[str] | None = None,
    ) -> ExecutionResult:
        msg = InboundMessage(
            session_id=session_id,
            content=content,
            agent_name=agent_name,
            metadata=metadata or {},
        )
        lock = self._get_session_lock(session_id)
        async with lock:
            session = Session(session_id, agent_name=agent_name)
            return await self._execute_with_session(
                session,
                msg,
                event_sink=event_sink,
                notify_channel_events=notify_channel_events,
                deliver_final=deliver_final,
                disabled_tools=disabled_tools,
            )

    async def _process_message(self, msg: InboundMessage) -> None:
        """处理单条消息，包含多轮 tool 调用。"""
        print(f"[AgentLoop] 处理消息: {msg.content}")
        session: Session | None = None

        try:
            session = Session(msg.session_id, agent_name=msg.agent_name)
            result = await self._execute_with_session(session, msg)
            print(f"[AgentLoop] 消息处理完成: {result.final_content[:50]}...")
        except Exception as exc:
            print(f"[AgentLoop] 消息处理失败: {exc}")

            if session is None:
                return

            error_message = f"运行失败：{exc}"
            session.add_message("assistant", error_message)
            await get_channel_manager().send(session.channel, session.chat_id, error_message)

    async def _execute_with_session(
        self,
        session: Session,
        msg: InboundMessage,
        *,
        event_sink: ExecutionEventSink | None = None,
        notify_channel_events: bool = True,
        deliver_final: bool = True,
        disabled_tools: set[str] | None = None,
    ) -> ExecutionResult:
        agent_name = session.agent_name
        print(f"[AgentLoop] channel: {session.channel}, agent_name: {agent_name}")

        cron_tool = self.tools.get("cron")
        if cron_tool and isinstance(cron_tool, CronTool):
            cron_tool.set_context(session.channel, session.chat_id)

        msg_tool = self.tools.get("message")
        if msg_tool and isinstance(msg_tool, MessageTool):
            msg_tool.set_context(session.channel, session.chat_id)

        memory_tool = self.tools.get("memory")
        if memory_tool and isinstance(memory_tool, MemoryTool):
            memory_tool.set_context(agent_name)

        spawn_tool = self.tools.get("spawn")
        if spawn_tool and isinstance(spawn_tool, SpawnTool):
            spawn_tool.set_context(session.channel, session.chat_id, agent_name)

        normalized_content = _normalize_command_text(msg.content)
        if normalized_content == "/new":
            print(f"[AgentLoop] 手动触发记忆整合: {msg.content!r} -> {normalized_content!r}")
            memory_store = MemoryStore(self.workspace, agent_name)
            success = await memory_store.consolidate(session, self.provider, archive_all=True)

            if success:
                session.messages = []
                session.last_consolidated = 0
                session._save_session()
                print(f"[AgentLoop] Session 已清空")

            result_msg = "记忆整合完成，会话已清空" if success else "记忆整合失败"
            if event_sink:
                await event_sink(EventType.FINAL.value, {"content": result_msg})
            if deliver_final:
                await get_channel_manager().send(session.channel, session.chat_id, result_msg)
            return ExecutionResult(
                final_content=result_msg,
                agent_name=agent_name,
                session_id=msg.session_id,
            )

        session.add_message("user", msg.content)
        messages = session.get_context()
        print(f"[AgentLoop] Agent name: {agent_name}")

        iteration = 0
        final_content: str | None = None
        message_tool_content: str | None = None
        tool_summaries: list[str] = []
        tool_definitions = self._get_tool_definitions(disabled_tools)

        max_iterations = self._max_iterations()
        while iteration < max_iterations:
            iteration += 1
            print(f"[AgentLoop] 第 {iteration} 轮调用")

            response: AdapterResponse = await self._call_llm(
                messages, tools=tool_definitions, agent_name=agent_name
            )

            if response.thinking:
                print(f"[AgentLoop][Thinking]\n{response.thinking}")
                await self._emit_event(
                    session=session,
                    session_id=msg.session_id,
                    event_type=EventType.THINKING,
                    data={"content": response.thinking},
                    event_sink=event_sink,
                    notify_channel_events=notify_channel_events,
                )

            if response.tool_calls:
                print(
                    f"[AgentLoop] LLM 请求调用工具: {[tc['function']['name'] for tc in response.tool_calls]}"
                )

                asst_dict: dict = {
                    "role": "assistant",
                    "content": response.content or "",
                    "tool_calls": response.tool_calls,
                }
                if response.thinking:
                    asst_dict["reasoning_content"] = response.thinking
                if response.reasoning_details:
                    asst_dict["reasoning_details"] = response.reasoning_details
                messages.append(asst_dict)

                for tool_call in response.tool_calls:
                    tool_name = tool_call["function"]["name"]
                    tool_args = self._parse_tool_arguments(
                        tool_call["function"]["arguments"]
                    )
                    tool_id = tool_call["id"]

                    print(f"[AgentLoop] 执行工具: {tool_name}({tool_args})")
                    await self._emit_event(
                        session=session,
                        session_id=msg.session_id,
                        event_type=EventType.TOOL_CALL,
                        data={"tool_name": tool_name, "args": tool_args},
                        event_sink=event_sink,
                        notify_channel_events=notify_channel_events,
                    )

                    result = await self._execute_tool(
                        tool_name,
                        tool_args,
                        disabled_tools=disabled_tools,
                    )

                    if tool_name == "message" and "content" in tool_args:
                        message_tool_content = tool_args["content"]

                    if (
                        tool_name == "memory"
                        and tool_args.get("action") == "complete_bootstrap"
                        and "already completed" not in result
                    ):
                        session.messages = []
                        session.last_consolidated = 0
                        session._save_session()
                        print(f"[AgentLoop] Bootstrap 完成，session 已清空")

                    brief_args = {
                        k: (v[:60] + "..." if isinstance(v, str) and len(v) > 60 else v)
                        for k, v in tool_args.items()
                    }
                    brief_result = result[:200] + ("..." if len(result) > 200 else "")
                    tool_summaries.append(f"[{tool_name}({brief_args}) -> {brief_result}]")

                    await self._emit_event(
                        session=session,
                        session_id=msg.session_id,
                        event_type=EventType.TOOL_RESULT,
                        data={"tool_name": tool_name, "result": result},
                        event_sink=event_sink,
                        notify_channel_events=notify_channel_events,
                    )

                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tool_id,
                            "name": tool_name,
                            "content": result,
                        }
                    )
            else:
                final_content = response.content
                break

        if final_content is None:
            final_content = f"达到最大迭代次数 ({max_iterations})，任务可能未完成。"

        if message_tool_content and (not final_content or not final_content.strip()):
            final_content = message_tool_content

        if not final_content or not final_content.strip():
            final_content = "Done."

        if tool_summaries:
            tool_log = "\n".join(tool_summaries)
            session.add_message("assistant", final_content, tool_summary=tool_log)
        else:
            session.add_message("assistant", final_content)

        if final_content and final_content != message_tool_content:
            await self._emit_final(
                session=session,
                session_id=msg.session_id,
                content=final_content,
                event_sink=event_sink,
                deliver_final=deliver_final,
            )
        elif not message_tool_content:
            await self._emit_final(
                session=session,
                session_id=msg.session_id,
                content=final_content,
                event_sink=event_sink,
                deliver_final=deliver_final,
            )

        provider_key = config_manager.get("agents." + agent_name + ".provider", "")
        memory_window = config_manager.get(
            "providers." + provider_key + ".memory_window",
            100,
        ) if provider_key else 100
        unconsolidated = len(session.messages) - session.last_consolidated
        if unconsolidated >= memory_window:
            print(f"[AgentLoop] 自动触发记忆整合: 未整合消息 {unconsolidated} >= {memory_window}")
            memory_store = MemoryStore(self.workspace, agent_name)
            await memory_store.consolidate(session, self.provider, memory_window=memory_window)

        return ExecutionResult(
            final_content=final_content,
            agent_name=agent_name,
            session_id=msg.session_id,
            message_tool_content=message_tool_content,
        )

    def _get_tool_definitions(self, disabled_tools: set[str] | None = None) -> list[dict[str, Any]]:
        blocked = disabled_tools or set()
        return [
            self.tools[name].to_schema()
            for name in self.tools.tool_names
            if name not in blocked
        ]

    async def _emit_event(
        self,
        *,
        session: Session,
        session_id: str,
        event_type: EventType,
        data: dict[str, Any],
        event_sink: ExecutionEventSink | None = None,
        notify_channel_events: bool = True,
    ) -> None:
        if event_sink:
            await event_sink(event_type.value, data)
        if notify_channel_events:
            await get_channel_manager().notify(session.channel, AgentEvent(
                session_id=session_id,
                event_type=event_type,
                data=data,
            ))

    async def _emit_final(
        self,
        *,
        session: Session,
        session_id: str,
        content: str,
        event_sink: ExecutionEventSink | None = None,
        deliver_final: bool = True,
    ) -> None:
        if event_sink:
            await event_sink(EventType.FINAL.value, {"content": content})
        if deliver_final:
            await get_channel_manager().send(session.channel, session.chat_id, content)

    async def _call_llm(
        self, messages: list[dict], tools: list[dict] | None = None, agent_name: str = "main"
    ) -> AdapterResponse:
        """调用 LLM，返回标准化 AdapterResponse。"""
        if not self.provider:
            return AdapterResponse(content="（未配置 provider）")

        # OpenAI SDK 是同步的，用 to_thread 包装成异步
        return await asyncio.to_thread(self.provider.response, messages, tools=tools, agent_name=agent_name)

    def _parse_tool_arguments(self, raw_args: Any) -> dict[str, Any]:
        """兼容字符串或对象形式的工具参数。"""
        if isinstance(raw_args, str):
            parsed_args = json.loads(raw_args)
        elif isinstance(raw_args, dict):
            parsed_args = raw_args
        else:
            raise ValueError(f"Unexpected tool arguments type: {type(raw_args).__name__}")

        if not isinstance(parsed_args, dict):
            raise ValueError(f"Unexpected parsed tool arguments type: {type(parsed_args).__name__}")

        return parsed_args

    async def _execute_tool(
        self,
        name: str,
        args: dict,
        *,
        disabled_tools: set[str] | None = None,
    ) -> str:
        """执行工具调用。"""
        if disabled_tools and name in disabled_tools:
            return f"Error: Tool '{name}' is disabled in this execution context"
        if name in self.tools:
            tool = self.tools[name]
            result = await tool.execute(**args)
            return str(result)
        return f"未知工具: {name}"
