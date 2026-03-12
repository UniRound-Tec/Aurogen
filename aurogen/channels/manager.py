"""ChannelManager: global singleton for channel registration, loading from config, and dynamic reload."""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Optional

from loguru import logger

from channels.base import BaseChannel

if TYPE_CHECKING:
    from message.events import AgentEvent


@dataclass
class ChannelTypeInfo:
    """Metadata for a channel type, used by ChannelManager and API."""
    cls: type[BaseChannel]
    description: str = ""
    required_settings: list[str] = field(default_factory=list)
    builtin: bool = False   # True = built-in channel, not exposed to supported/add/delete API


def _build_registry() -> dict[str, ChannelTypeInfo]:
    """Lazy import to avoid circular dependencies."""
    from channels.web import WebChannel
    from channels.feishu import FeishuChannel
    from channels.qq import QQChannel
    from channels.dingtalk import DingTalkChannel
    from channels.discord import DiscordChannel
    from channels.email import EmailChannel
    from channels.mochat import MochatChannel
    from channels.slack import SlackChannel
    from channels.telegram import TelegramChannel
    from channels.whatsapp import WhatsAppChannel
    return {
        "web": ChannelTypeInfo(
            cls=WebChannel,
            description="Web SSE channel",
            builtin=True,
        ),
        "feishu": ChannelTypeInfo(
            cls=FeishuChannel,
            description="Feishu WebSocket channel",
            required_settings=["app_id", "app_secret"],
        ),
        "qq": ChannelTypeInfo(
            cls=QQChannel,
            description="QQ DM channel (botpy)",
            required_settings=["app_id", "secret"],
        ),
        "dingtalk": ChannelTypeInfo(
            cls=DingTalkChannel,
            description="DingTalk Stream channel",
            required_settings=["client_id", "client_secret"],
        ),
        "discord": ChannelTypeInfo(
            cls=DiscordChannel,
            description="Discord Gateway channel",
            required_settings=["token"],
        ),
        "email": ChannelTypeInfo(
            cls=EmailChannel,
            description="Email IMAP/SMTP channel",
            required_settings=["imap_host", "imap_port", "imap_username", "imap_password",
                               "smtp_host", "smtp_port", "smtp_username", "smtp_password",
                               "consent_granted"],
        ),
        "mochat": ChannelTypeInfo(
            cls=MochatChannel,
            description="Mochat Socket.IO channel",
            required_settings=["claw_token", "base_url"],
        ),
        "slack": ChannelTypeInfo(
            cls=SlackChannel,
            description="Slack Socket Mode channel",
            required_settings=["bot_token", "app_token"],
        ),
        "telegram": ChannelTypeInfo(
            cls=TelegramChannel,
            description="Telegram Bot channel (polling)",
            required_settings=["token"],
        ),
        "whatsapp": ChannelTypeInfo(
            cls=WhatsAppChannel,
            description="WhatsApp channel (Baileys bridge)",
            required_settings=[],
        ),
    }


class ChannelManager:
    """
    Manages all registered channels.

    Responsibilities:
    - Outbound message routing: send(channel_name, chat_id, content)
    - Bulk channel instantiation from config: load_from_config()
    - Runtime incremental reload: reload()
    - Status query: status()
    """

    def __init__(self):
        self._channels: dict[str, BaseChannel] = {}
        self._channel_configs: dict[str, dict] = {}
        # Tracks asyncio Task per channel (for channels with background loops)
        self._tasks: dict[str, asyncio.Task] = {}

    # ── Basic operations ──────────────────────────────────────────────────────

    def register(self, channel: BaseChannel) -> None:
        """Register an already-instantiated channel (no start required)."""
        self._channels[channel.name] = channel

    def get(self, channel_name: str) -> Optional[BaseChannel]:
        """Get the channel instance by name; returns None if not found."""
        return self._channels.get(channel_name)

    async def send(self, channel_name: str, chat_id: str, content: str) -> None:
        """Route message to the corresponding channel's send() method."""
        channel = self._channels.get(channel_name)
        if channel is None:
            logger.warning("[ChannelManager] Unknown channel: {}, message dropped", channel_name)
            return
        await channel.send(chat_id, content)

    async def notify(self, channel_name: str, event: "AgentEvent") -> None:
        """Route intermediate events (THINKING/TOOL_CALL/TOOL_RESULT) to the channel's notify() method."""
        channel = self._channels.get(channel_name)
        if channel:
            await channel.notify(event)

    # ── Load from config ───────────────────────────────────────────────────────

    async def load_from_config(self) -> None:
        """
        On startup, read all channel configs, instantiate and start() each.
        Equivalent to calling _start_channel() for each config entry.
        """
        from config.config import config_manager
        registry = _build_registry()

        channels_cfg: dict = config_manager.get("channels", {})
        for key, cfg in channels_cfg.items():
            channel_type = cfg.get("type", key)
            info = registry.get(channel_type)
            if info is None:
                logger.warning("[ChannelManager] Unknown channel type: {}, skipping", channel_type)
                continue
            await self._start_channel(key, info, cfg)

    async def _start_channel(self, key: str, info: ChannelTypeInfo, cfg: dict) -> None:
        """Instantiate and start() a channel."""
        settings = cfg.get("settings", {})
        try:
            channel = info.cls(channel_key=key, settings=settings)
            self._channels[key] = channel
            self._channel_configs[key] = json.loads(json.dumps(cfg, sort_keys=True))
            await channel.start()
            logger.info("[ChannelManager] channel '{}' started", key)
        except Exception as e:
            self._channels.pop(key, None)
            self._channel_configs.pop(key, None)
            logger.error("[ChannelManager] Failed to start channel '{}': {}", key, e)

    # ── Dynamic reload ────────────────────────────────────────────────────────

    async def reload(self) -> dict:
        """
        Compare running channels with latest config and update incrementally:
        - Added channels → start()
        - Removed channels → stop()
        - Changed channels → restart()
        - Existing unchanged channels → keep running

        Returns a change summary dict.
        """
        from config.config import config_manager
        registry = _build_registry()

        channels_cfg: dict = config_manager.get("channels", {})
        config_keys = set(channels_cfg.keys())
        running_keys = set(self._channels.keys())

        added = config_keys - running_keys
        removed = running_keys - config_keys
        shared = running_keys & config_keys
        changed = {
            key for key in shared
            if self._channel_configs.get(key) != json.loads(json.dumps(channels_cfg[key], sort_keys=True))
        }
        unchanged = shared - changed

        for key in removed:
            await self._stop_channel(key)

        for key in changed:
            cfg = channels_cfg[key]
            channel_type = cfg.get("type", key)
            info = registry.get(channel_type)
            if info is None:
                logger.warning("[ChannelManager] Unknown channel type: {}, skipping", channel_type)
                continue
            await self._stop_channel(key)
            await self._start_channel(key, info, cfg)

        for key in added:
            cfg = channels_cfg[key]
            channel_type = cfg.get("type", key)
            info = registry.get(channel_type)
            if info is None:
                logger.warning("[ChannelManager] Unknown channel type: {}, skipping", channel_type)
                continue
            await self._start_channel(key, info, cfg)

        return {
            "added": list(added),
            "removed": list(removed),
            "changed": list(changed),
            "unchanged": list(unchanged),
        }

    async def _stop_channel(self, key: str) -> None:
        """Stop and unregister a channel."""
        channel = self._channels.pop(key, None)
        self._channel_configs.pop(key, None)
        if channel:
            try:
                await channel.stop()
                logger.info("[ChannelManager] channel '{}' stopped", key)
            except Exception as e:
                logger.error("[ChannelManager] Failed to stop channel '{}': {}", key, e)

    async def stop_all(self) -> None:
        """Stop all registered channels (called on application shutdown)."""
        for key in list(self._channels.keys()):
            await self._stop_channel(key)

    # ── Status query ──────────────────────────────────────────────────────────

    def status(self) -> dict:
        """Return the list of registered channels and their status."""
        return {
            "channels": [
                {
                    "name": name,
                    "type": type(ch).__name__,
                    "running": getattr(ch, "_running", True),
                }
                for name, ch in self._channels.items()
            ]
        }


# ── Global singleton ─────────────────────────────────────────────────────────

_channel_manager: Optional[ChannelManager] = None


def get_channel_manager() -> ChannelManager:
    """Get the global ChannelManager instance."""
    global _channel_manager
    if _channel_manager is None:
        _channel_manager = ChannelManager()
    return _channel_manager
