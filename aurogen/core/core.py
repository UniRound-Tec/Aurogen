"""Agent loop: the core processing engine."""

import asyncio
import json
from contextlib import AsyncExitStack
from pathlib import Path
from typing import Any

from channels.manager import get_channel_manager
from config.config import config_manager
from core.memory import MemoryStore
from core.tools.cron import CronTool
from core.tools.mcp import connect_mcp_servers
from core.tools.web import WebFetchTool, WebSearchTool
from cron import CronService
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


class AgentLoop:
    """
    Agent 循环引擎，支持多轮 tool 调用。

    核心流程:
    1. 收到消息 → 构建上下文（历史 + 当前消息）
    2. 调用 LLM
    3. 如果 LLM 返回 tool_calls → 执行工具 → 结果加入历史 → 回到步骤 2
    4. 如果 LLM 返回文本 → 返回最终回复
    """

    MAX_ITERATIONS = 40  # 防止无限循环

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
        self.cron_service = CronService(self.workspace / "cron" / "jobs.json")
        self._mcp_stack: AsyncExitStack | None = None
        self._register_default_tools()
        self.subagent_manager = SubagentManager(provider=self.provider, workspace=self.workspace)
        self.tools.register(SpawnTool(self.subagent_manager))

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
        # self.tools.register(WebSearchTool()) # TODO: add api key
        self.tools.register(WebFetchTool(proxy=None))
        self.tools.register(CronTool(cron_service=self.cron_service))
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
        print("[AgentLoop] 启动")

        inbound = get_inbound_queue()

        try:
            while self._running:
                try:
                    msg = await asyncio.wait_for(inbound.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue

                # 异步处理消息
                asyncio.create_task(self._process_message(msg))
        finally:
            if self._mcp_stack:
                await self._mcp_stack.aclose()
                self._mcp_stack = None

    def stop(self) -> None:
        """停止 agent loop。"""
        self._running = False
        self.cron_service.stop()
        print("[AgentLoop] 停止中...")

    async def _process_message(self, msg: InboundMessage) -> None:
        """处理单条消息，包含多轮 tool 调用。"""
        print(f"[AgentLoop] 处理消息: {msg.content}")
        session: Session | None = None

        try:
            # 获取或创建 session
            session = Session(msg.session_id)
            agent_name = session.agent_name
            print(f"[AgentLoop] channel: {session.channel}, agent_name: {agent_name}")

            # 注入当前会话上下文到 CronTool
            cron_tool = self.tools.get("cron")
            if cron_tool and isinstance(cron_tool, CronTool):
                cron_tool.set_context(session.channel, session.chat_id)

            # 注入当前会话上下文到 MessageTool
            msg_tool = self.tools.get("message")
            if msg_tool and isinstance(msg_tool, MessageTool):
                msg_tool.set_context(session.channel, session.chat_id)

            # 注入当前会话上下文到 SpawnTool
            spawn_tool = self.tools.get("spawn")
            if spawn_tool and isinstance(spawn_tool, SpawnTool):
                spawn_tool.set_context(session.channel, session.chat_id, agent_name)

            # 检查是否是手动触发记忆整合命令
            if msg.content.strip() == "/new":
                print("[AgentLoop] 手动触发记忆整合: /new")
                memory_store = MemoryStore(self.workspace, agent_name)
                success = await memory_store.consolidate(session, self.provider, archive_all=True)

                # 整合完成后清空 session 消息
                if success:
                    session.messages = []
                    session.last_consolidated = 0
                    session._save_session()
                    print(f"[AgentLoop] Session 已清空")

                # 发送完成通知
                result_msg = "记忆整合完成，会话已清空" if success else "记忆整合失败"
                await get_channel_manager().send(session.channel, session.chat_id, result_msg)
                return

            session.add_message("user", msg.content)

            # 使用 ContextBuilder 构建消息历史（包含运行时上下文）
            messages = session.get_context_with_message(msg.content)
            print(f"[AgentLoop] Agent name: {agent_name}")

            # 多轮调用循环
            iteration = 0
            final_content = None
            message_tool_content: str | None = None

            while iteration < self.MAX_ITERATIONS:
                iteration += 1
                print(f"[AgentLoop] 第 {iteration} 轮调用")

                # 调用 LLM，返回标准化 AdapterResponse
                response: AdapterResponse = await self._call_llm(
                    messages, tools=self.tools.get_definitions(), agent_name=agent_name
                )

                # 发布 thinking 事件（如有）
                if response.thinking:
                    print(f"[AgentLoop][Thinking]\n{response.thinking}")
                    await get_channel_manager().notify(session.channel, AgentEvent(
                        session_id=msg.session_id,
                        event_type=EventType.THINKING,
                        data={"content": response.thinking}
                    ))

                if response.tool_calls:
                    # 有工具调用：执行工具，结果加入历史，继续循环
                    print(
                        f"[AgentLoop] LLM 请求调用工具: {[tc['function']['name'] for tc in response.tool_calls]}"
                    )

                    # 添加 assistant 消息（包含 tool_calls）
                    asst_dict: dict = {
                        "role": "assistant",
                        "content": response.content or "",
                        "tool_calls": response.tool_calls,
                    }
                    # 多轮 thinking：将 reasoning_details 带回，供下一轮使用
                    if response.reasoning_details:
                        asst_dict["reasoning_details"] = response.reasoning_details
                    messages.append(asst_dict)

                    # 执行每个工具
                    for tool_call in response.tool_calls:
                        tool_name = tool_call["function"]["name"]
                        tool_args = self._parse_tool_arguments(
                            tool_call["function"]["arguments"]
                        )
                        tool_id = tool_call["id"]

                        print(f"[AgentLoop] 执行工具: {tool_name}({tool_args})")

                        # 发送 TOOL_CALL 事件
                        await get_channel_manager().notify(session.channel, AgentEvent(
                            session_id=msg.session_id,
                            event_type=EventType.TOOL_CALL,
                            data={"tool_name": tool_name, "args": tool_args}
                        ))

                        result = await self._execute_tool(tool_name, tool_args)

                        # 记录 message 工具发送的内容
                        if tool_name == "message" and "content" in tool_args:
                            message_tool_content = tool_args["content"]

                        # 发送 TOOL_RESULT 事件
                        await get_channel_manager().notify(session.channel, AgentEvent(
                            session_id=msg.session_id,
                            event_type=EventType.TOOL_RESULT,
                            data={"tool_name": tool_name, "result": result}
                        ))

                        # 工具结果加入历史
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tool_id,
                                "name": tool_name,
                                "content": result,
                            }
                        )
                else:
                    # 没有工具调用：返回最终回复
                    final_content = response.content
                    break

            if final_content is None:
                final_content = (
                    f"达到最大迭代次数 ({self.MAX_ITERATIONS})，任务可能未完成。"
                )

            # message 工具已经通过 channel 直接发送了内容，
            # 需要将其记录到 session，避免保存空回复
            if message_tool_content and (not final_content or not final_content.strip()):
                final_content = message_tool_content

            # 保存 assistant 回复到 session
            session.add_message("assistant", final_content)

            # 通过 ChannelManager 路由最终回复到对应 channel
            # 如果 message 工具已经发送过相同内容，跳过重复发送
            if final_content and final_content != message_tool_content:
                await get_channel_manager().send(session.channel, session.chat_id, final_content)
            elif not message_tool_content:
                await get_channel_manager().send(session.channel, session.chat_id, final_content)

            print(f"[AgentLoop] 消息处理完成: {final_content[:50]}...")

            # 自动触发记忆整合检查
            memory_window = config_manager.get("agents." + agent_name + ".model_settings.memory_window", 100)
            unconsolidated = len(session.messages) - session.last_consolidated
            if unconsolidated >= memory_window:
                print(f"[AgentLoop] 自动触发记忆整合: 未整合消息 {unconsolidated} >= {memory_window}")
                memory_store = MemoryStore(self.workspace, agent_name)
                await memory_store.consolidate(session, self.provider, memory_window=memory_window)
        except Exception as exc:
            print(f"[AgentLoop] 消息处理失败: {exc}")

            if session is None:
                return

            error_message = f"运行失败：{exc}"
            session.add_message("assistant", error_message)
            await get_channel_manager().send(session.channel, session.chat_id, error_message)

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

    async def _execute_tool(self, name: str, args: dict) -> str:
        """执行工具调用。"""
        if name in self.tools:
            tool = self.tools[name]
            result = await tool.execute(**args)
            return str(result)
        return f"未知工具: {name}"
