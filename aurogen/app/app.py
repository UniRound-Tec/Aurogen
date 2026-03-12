import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

from app.schema import (
    AddAgentRequest,
    AddChannelRequest,
    AddCronJobRequest,
    AddMCPServerRequest,
    AddProviderRequest,
    CheckAuthRequest,
    CreateChatSessionRequest,
    SendMessageRequest,
    SessionInfo,
    SetConfigRequest,
    SetPasswordRequest,
    SkillDetailResponse,
    SkillInfo,
    UpdateAgentRequest,
    UpdateChannelRequest,
    UpdateCronJobRequest,
    UpdateHeartbeatConfigRequest,
    UpdateMCPServerRequest,
    UpdateProviderRequest,
    WriteFileRequest,
)
from cron.types import CronSchedule
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger
from config.config import config_manager, WORKSPACE_DIR, TEMPLATE_DIR
from config.schema import HeartbeatConfig
from channels.manager import get_channel_manager, _build_registry
from channels.web import WebChannel
from message.queue_manager import get_inbound_queue
from message.events import EventType, InboundMessage
from message.session_manager import Session
from core.core import AgentLoop
from core.skills import SkillsLoader, get_skills_loader, resolve_skills_dir
from providers.providers import Provider, _build_provider_registry
from core.heartbeat import HeartbeatManager

agent_loop: AgentLoop | None = None
heartbeat_manager: HeartbeatManager | None = None

DEFAULT_HEARTBEAT_CONFIG = HeartbeatConfig().model_dump()


def _ensure_main_agent():
    """If the main agent workspace is missing or empty, seed it from the template."""
    import shutil
    agent_dir = WORKSPACE_DIR / "agents" / "main"
    if agent_dir.exists() and any(agent_dir.iterdir()):
        return
    logger.info("[App] main agent workspace is empty, initializing from template")
    agent_dir.mkdir(parents=True, exist_ok=True)
    for src in TEMPLATE_DIR.rglob("*"):
        if src.suffix in (".py", ".pyc") or "__pycache__" in src.parts:
            continue
        dst = agent_dir / src.relative_to(TEMPLATE_DIR)
        if src.is_dir():
            dst.mkdir(parents=True, exist_ok=True)
        else:
            shutil.copy2(src, dst)


def _ensure_agent_heartbeat_file(agent_name: str) -> None:
    """Ensure the agent workspace has a default HEARTBEAT.md."""
    template_file = TEMPLATE_DIR / "HEARTBEAT.md"
    if not template_file.exists():
        return
    heartbeat_file = WORKSPACE_DIR / "agents" / agent_name / "HEARTBEAT.md"
    if heartbeat_file.exists():
        return
    heartbeat_file.parent.mkdir(parents=True, exist_ok=True)
    heartbeat_file.write_text(template_file.read_text(encoding="utf-8"), encoding="utf-8")


def _get_heartbeat_agent_config(agent_name: str) -> dict:
    cfg = config_manager.get(f"heartbeat.{agent_name}")
    if isinstance(cfg, dict):
        return {
            "interval_s": cfg.get("interval_s", DEFAULT_HEARTBEAT_CONFIG["interval_s"]),
            "enabled": cfg.get("enabled", DEFAULT_HEARTBEAT_CONFIG["enabled"]),
        }
    return dict(DEFAULT_HEARTBEAT_CONFIG)


def _heartbeat_session_id(agent_name: str) -> str:
    return f"web@heartbeat:{agent_name}"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI lifespan: start and shutdown agent loop and all channels."""
    global agent_loop, heartbeat_manager

    _ensure_main_agent()
    for agent_name in config_manager.get("agents", {}):
        _ensure_agent_heartbeat_file(agent_name)

    # Load and start all channels from config
    channel_manager = get_channel_manager()
    await channel_manager.load_from_config()

    provider = Provider()
    agent_loop = AgentLoop(provider, workspace=WORKSPACE_DIR)

    def _on_execute_factory(agent_name: str):
        async def _on_execute(tasks: str) -> str:
            msg = InboundMessage(
                session_id=_heartbeat_session_id(agent_name),
                content=tasks,
                agent_name=agent_name,
                metadata={"source": "heartbeat", "agent_name": agent_name},
            )
            await get_inbound_queue().put(msg)
            return f"Heartbeat task queued for {agent_name}: {tasks[:80]}"
        return _on_execute

    def _on_notify_factory(agent_name: str):
        async def _on_notify(response: str) -> None:
            logger.info("Heartbeat [{}] result: {}", agent_name, response)
        return _on_notify

    heartbeat_manager = HeartbeatManager(
        workspace_root=WORKSPACE_DIR,
        config_resolver=_get_heartbeat_agent_config,
        on_execute_factory=_on_execute_factory,
        on_notify_factory=_on_notify_factory,
    )
    heartbeat_manager.sync_agents(config_manager.get("agents", {}).keys())

    task = asyncio.create_task(agent_loop.run())
    await heartbeat_manager.start_all()
    logger.info("[App] Agent loop started, loaded channels: {}", list(channel_manager._channels.keys()))

    yield  # Application running

    agent_loop.stop()
    heartbeat_manager.stop_all()
    await channel_manager.stop_all()
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    logger.info("[App] Agent loop stopped")


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

AUTH_PUBLIC_PATHS = {"/check-auth", "/set-password", "/docs", "/openapi.json"}

_STATIC_EXTS = {
    ".js", ".css", ".html", ".ico", ".png", ".svg",
    ".woff", ".woff2", ".ttf", ".map", ".json", ".webmanifest",
}

# SPA index path (exists in Docker deploy, not in local dev)
_SPA_INDEX = Path(__file__).resolve().parent.parent.parent / "aurogen_web" / "dist" / "index.html"


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if request.method == "OPTIONS":
        return await call_next(request)

    if request.url.path in AUTH_PUBLIC_PATHS:
        return await call_next(request)

    # Static assets (with extension or root path) do not require auth
    if request.url.path == "/" or Path(request.url.path).suffix in _STATIC_EXTS:
        return await call_next(request)

    # Browser page navigation (SPA route refresh) → return index.html for frontend routing
    # Avoid 401 from conflicting with same-named API; SPA handles auth after load
    if "text/html" in request.headers.get("Accept", "") and _SPA_INDEX.exists():
        return FileResponse(_SPA_INDEX)

    auth_cfg = config_manager.get("auth", {})
    stored_password = auth_cfg.get("password", "")
    first_login = auth_cfg.get("first_login", True)

    if first_login and stored_password == "":
        return await call_next(request)

    auth_key = request.headers.get("X-Auth-Key", "")
    if auth_key != stored_password:
        return JSONResponse(status_code=401, content={"detail": "Authentication failed"})

    return await call_next(request)


# ── Auth endpoints ─────────────────────────────────────────────────────────────


@app.post("/check-auth")
async def check_auth(request: CheckAuthRequest):
    auth_cfg = config_manager.get("auth", {})
    stored_password = auth_cfg.get("password", "")
    first_login = auth_cfg.get("first_login", True)

    if first_login and stored_password == "":
        return {"status": "first_login"}
    if request.password == stored_password:
        return {"status": "success"}
    return {"status": "failed"}


@app.post("/set-password")
async def set_password(request: SetPasswordRequest):
    auth_cfg = config_manager.get("auth", {})
    if not auth_cfg.get("first_login", False):
        raise HTTPException(status_code=403, detail="Not first login, cannot set password")
    if not request.password:
        raise HTTPException(status_code=400, detail="Password cannot be empty")

    config_manager.set("auth.password", request.password)
    config_manager.set("auth.first_login", False)
    return {"status": "success"}


# ── Config endpoints ───────────────────────────────────────────────────────────

@app.post("/set-config")
async def set_config(request: SetConfigRequest):
    config_manager.set(request.path, request.value)
    return {"message": "Config set successfully"}


@app.get("/get-config")
async def get_config():
    return {"config": config_manager.get_full_config()}


# ── MCP management endpoints ──────────────────────────────────────────────────


def _get_loaded_mcp_tools(server_key: str) -> list[str]:
    """Return currently loaded tool names belonging to a specific MCP server."""
    if not agent_loop:
        return []
    prefix = f"mcp_{server_key}_"
    return [
        name for name in getattr(agent_loop.tools, "tool_names", [])
        if name.startswith(prefix)
    ]


def _build_mcp_entry(key: str, cfg: dict) -> dict:
    loaded = _get_loaded_mcp_tools(key)
    return {
        "key": key,
        **cfg,
        "loaded_tools": loaded,
        "loaded_count": len(loaded),
    }


def _validate_mcp_server_config(command: str, url: str) -> None:
    if not command and not url:
        raise HTTPException(
            status_code=400,
            detail="MCP server must have at least one of command or url configured",
        )


@app.get("/mcp/config")
async def get_mcp_config():
    """Return all configured MCP servers and their load status."""
    mcp_cfg: dict = config_manager.get("mcp", {})
    return {
        "servers": [
            _build_mcp_entry(key, cfg)
            for key, cfg in mcp_cfg.items()
        ]
    }


@app.get("/mcp/{key}")
async def get_mcp_detail(key: str):
    """Return a single MCP server detail."""
    cfg = config_manager.get(f"mcp.{key}")
    if not cfg:
        raise HTTPException(status_code=404, detail=f"MCP server '{key}' not found")
    return _build_mcp_entry(key, cfg)


@app.post("/mcp")
async def add_mcp_server(request: AddMCPServerRequest):
    """Add MCP server config and connect automatically."""
    if config_manager.get(f"mcp.{request.key}"):
        raise HTTPException(status_code=400, detail=f"MCP server '{request.key}' already exists")

    _validate_mcp_server_config(request.command, request.url)

    config_manager.set(f"mcp.{request.key}", {
        "command": request.command,
        "args": request.args,
        "env": request.env,
        "url": request.url,
        "headers": request.headers,
        "tool_timeout": request.tool_timeout,
    })

    if agent_loop:
        await agent_loop.reload_mcp()

    return {"message": f"MCP server '{request.key}' added and loaded"}


@app.patch("/mcp/{key}")
async def update_mcp_server(key: str, request: UpdateMCPServerRequest):
    """Partially update MCP server config and reconnect automatically."""
    existing = config_manager.get(f"mcp.{key}")
    if not existing:
        raise HTTPException(status_code=404, detail=f"MCP server '{key}' not found")

    merged = dict(existing)
    if request.command is not None:
        merged["command"] = request.command
    if request.args is not None:
        merged["args"] = request.args
    if request.env is not None:
        merged["env"] = request.env
    if request.url is not None:
        merged["url"] = request.url
    if request.headers is not None:
        merged["headers"] = request.headers
    if request.tool_timeout is not None:
        merged["tool_timeout"] = request.tool_timeout

    _validate_mcp_server_config(merged.get("command", ""), merged.get("url", ""))

    config_manager.set(f"mcp.{key}", merged)

    if agent_loop:
        await agent_loop.reload_mcp()

    return {"message": f"MCP server '{key}' updated and reloaded"}


@app.delete("/mcp/{key}")
async def delete_mcp_server(key: str):
    """Remove MCP server config and unload its tools."""
    mcp_cfg: dict = config_manager.get("mcp", {})
    if key not in mcp_cfg:
        raise HTTPException(status_code=404, detail=f"MCP server '{key}' not found")

    mcp_cfg.pop(key, None)
    config_manager.set("mcp", mcp_cfg)

    if agent_loop:
        await agent_loop.reload_mcp()

    return {"message": f"MCP server '{key}' deleted"}


@app.post("/mcp/reload")
async def reload_mcp():
    """Re-read config and reconnect all MCP servers."""
    if agent_loop is None:
        raise HTTPException(status_code=503, detail="Agent loop not started")
    await agent_loop.reload_mcp()
    return {"message": "MCP servers reloaded"}


# ── Heartbeat config endpoints ─────────────────────────────────────────────────

@app.get("/heartbeat/config")
async def get_heartbeat_config(agent_name: str = "main"):
    """Return heartbeat config for the given agent."""
    _require_agent(agent_name)
    cfg = _get_heartbeat_agent_config(agent_name)
    return {
        "interval_s": cfg["interval_s"],
        "enabled": cfg["enabled"],
    }


@app.patch("/heartbeat/config")
async def update_heartbeat_config(request: UpdateHeartbeatConfigRequest, agent_name: str = "main"):
    """Partially update heartbeat config for the agent and restart instance to apply."""
    global heartbeat_manager
    _require_agent(agent_name)
    existing = _get_heartbeat_agent_config(agent_name)
    merged = dict(existing)

    if request.interval_s is not None:
        if request.interval_s <= 0:
            raise HTTPException(status_code=400, detail="interval_s must be greater than 0")
        merged["interval_s"] = request.interval_s
    if request.enabled is not None:
        merged["enabled"] = request.enabled

    config_manager.set(f"heartbeat.{agent_name}", merged)

    if heartbeat_manager is not None:
        await heartbeat_manager.rebuild_agent(agent_name)

    return {"message": "Heartbeat config updated"}


# ── Cron Job management endpoints ─────────────────────────────────────────────


def _cron_service():
    """Return running CronService; raise 503 when not ready."""
    if agent_loop is None:
        raise HTTPException(status_code=503, detail="Agent loop not started")
    return agent_loop.cron_service


def _build_cron_job_entry(job) -> dict:
    return {
        "id": job.id,
        "name": job.name,
        "enabled": job.enabled,
        "schedule": {
            "kind": job.schedule.kind,
            "at_ms": job.schedule.at_ms,
            "every_ms": job.schedule.every_ms,
            "expr": job.schedule.expr,
            "tz": job.schedule.tz,
        },
        "payload": {
            "kind": job.payload.kind,
            "message": job.payload.message,
            "deliver": job.payload.deliver,
            "channel": job.payload.channel,
            "to": job.payload.to,
        },
        "state": {
            "next_run_at_ms": job.state.next_run_at_ms,
            "last_run_at_ms": job.state.last_run_at_ms,
            "last_status": job.state.last_status,
            "last_error": job.state.last_error,
        },
        "created_at_ms": job.created_at_ms,
        "updated_at_ms": job.updated_at_ms,
        "delete_after_run": job.delete_after_run,
    }


@app.get("/cron/status")
async def get_cron_status():
    """Return cron service status and stats."""
    svc = _cron_service()
    return svc.status()


@app.get("/cron/jobs")
async def list_cron_jobs(include_disabled: bool = False):
    """List all cron jobs. include_disabled=true includes disabled jobs."""
    svc = _cron_service()
    jobs = svc.list_jobs(include_disabled=include_disabled)
    return {"jobs": [_build_cron_job_entry(j) for j in jobs]}


@app.get("/cron/jobs/{job_id}")
async def get_cron_job(job_id: str):
    """Get a single cron job detail."""
    svc = _cron_service()
    jobs = svc.list_jobs(include_disabled=True)
    for job in jobs:
        if job.id == job_id:
            return _build_cron_job_entry(job)
    raise HTTPException(status_code=404, detail=f"cron job '{job_id}' not found")


@app.post("/cron/jobs")
async def add_cron_job(request: AddCronJobRequest):
    """Add a new cron job."""
    svc = _cron_service()
    schedule = CronSchedule(
        kind=request.schedule.kind,
        at_ms=request.schedule.at_ms,
        every_ms=request.schedule.every_ms,
        expr=request.schedule.expr,
        tz=request.schedule.tz,
    )
    try:
        job = svc.add_job(
            name=request.name,
            schedule=schedule,
            message=request.message,
            deliver=request.deliver,
            channel=request.channel,
            to=request.to,
            delete_after_run=request.delete_after_run,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"message": f"cron job '{job.id}' created", "job": _build_cron_job_entry(job)}


@app.patch("/cron/jobs/{job_id}")
async def update_cron_job(job_id: str, request: UpdateCronJobRequest):
    """Partially update a cron job."""
    svc = _cron_service()
    schedule = None
    if request.schedule is not None:
        schedule = CronSchedule(
            kind=request.schedule.kind,
            at_ms=request.schedule.at_ms,
            every_ms=request.schedule.every_ms,
            expr=request.schedule.expr,
            tz=request.schedule.tz,
        )
    try:
        job = svc.update_job(
            job_id=job_id,
            name=request.name,
            enabled=request.enabled,
            schedule=schedule,
            message=request.message,
            deliver=request.deliver,
            channel=request.channel,
            to=request.to,
            delete_after_run=request.delete_after_run,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if job is None:
        raise HTTPException(status_code=404, detail=f"cron job '{job_id}' not found")
    return {"message": f"cron job '{job_id}' updated", "job": _build_cron_job_entry(job)}


@app.delete("/cron/jobs/{job_id}")
async def delete_cron_job(job_id: str):
    """Delete a cron job."""
    svc = _cron_service()
    removed = svc.remove_job(job_id)
    if not removed:
        raise HTTPException(status_code=404, detail=f"cron job '{job_id}' not found")
    return {"message": f"cron job '{job_id}' deleted"}


@app.post("/cron/jobs/{job_id}/enable")
async def enable_cron_job(job_id: str):
    """Enable a cron job."""
    svc = _cron_service()
    job = svc.enable_job(job_id, enabled=True)
    if job is None:
        raise HTTPException(status_code=404, detail=f"cron job '{job_id}' not found")
    return {"message": f"cron job '{job_id}' enabled", "job": _build_cron_job_entry(job)}


@app.post("/cron/jobs/{job_id}/disable")
async def disable_cron_job(job_id: str):
    """Disable a cron job."""
    svc = _cron_service()
    job = svc.enable_job(job_id, enabled=False)
    if job is None:
        raise HTTPException(status_code=404, detail=f"cron job '{job_id}' not found")
    return {"message": f"cron job '{job_id}' disabled", "job": _build_cron_job_entry(job)}


@app.post("/cron/jobs/{job_id}/run")
async def run_cron_job(job_id: str):
    """Manually trigger cron job immediately (force run even if disabled)."""
    svc = _cron_service()
    ran = await svc.run_job(job_id, force=True)
    if not ran:
        raise HTTPException(status_code=404, detail=f"cron job '{job_id}' not found")
    return {"message": f"cron job '{job_id}' triggered"}


# ── Provider management endpoints ──────────────────────────────────────────────


def _require_provider_type(provider_type: str):
    registry = _build_provider_registry()
    info = registry.get(provider_type)
    if info is None:
        raise HTTPException(status_code=400, detail=f"Unsupported provider type: {provider_type}")
    return info


def _validate_provider_config(provider_type: str, settings: dict) -> None:
    info = _require_provider_type(provider_type)
    missing = [key for key in info.required_settings if key not in settings or settings[key] is None]
    if missing:
        raise HTTPException(
            status_code=400,
            detail={
                "message": f"Provider type '{provider_type}' missing required settings",
                "missing_settings": missing,
            },
        )


def _get_provider_usages(provider_key: str) -> list[str]:
    agents_cfg: dict = config_manager.get("agents", {})
    return [
        agent_key
        for agent_key, agent_cfg in agents_cfg.items()
        if agent_cfg.get("provider") == provider_key
    ]


def _get_agent_usages(agent_name: str) -> list[str]:
    channels_cfg: dict = config_manager.get("channels", {})
    return [
        channel_key
        for channel_key, channel_cfg in channels_cfg.items()
        if channel_cfg.get("agent_name") == agent_name
    ]


def _require_agent(agent_name: str) -> dict:
    cfg = config_manager.get(f"agents.{agent_name}")
    if not cfg:
        raise HTTPException(status_code=404, detail=f"agent '{agent_name}' not found")
    return cfg


def _require_channel(channel_key: str) -> dict:
    cfg = config_manager.get(f"channels.{channel_key}")
    if not cfg:
        raise HTTPException(status_code=404, detail=f"channel '{channel_key}' not found")
    return cfg


def _require_provider(provider_key: str) -> dict:
    cfg = config_manager.get(f"providers.{provider_key}")
    if not cfg:
        raise HTTPException(status_code=404, detail=f"provider '{provider_key}' not found")
    return cfg


def _build_agent_entry(agent_key: str, cfg: dict) -> dict:
    return {
        "key": agent_key,
        "builtin": agent_key in BUILTIN_AGENTS,
        "name": cfg.get("name", ""),
        "description": cfg.get("description", ""),
        "provider": cfg.get("provider", ""),
        "emoji": cfg.get("emoji", ""),
    }


def _build_channel_entry(channel_key: str, cfg: dict) -> dict:
    registry = _build_registry()
    channel_type = cfg.get("type", channel_key)
    info = registry.get(channel_type)
    channel = get_channel_manager().get(channel_key)
    return {
        "key": channel_key,
        "type": channel_type,
        "agent_name": cfg.get("agent_name", ""),
        "description": cfg.get("description", ""),
        "settings": cfg.get("settings", {}),
        "builtin": bool(info and info.builtin),
        "running": getattr(channel, "_running", True) if channel else False,
        "emoji": cfg.get("emoji", ""),
    }


def _build_provider_entry(provider_key: str, cfg: dict) -> dict:
    return {
        "key": provider_key,
        "type": cfg.get("type", provider_key),
        "description": cfg.get("description", ""),
        "settings": cfg.get("settings", {}),
        "model": cfg.get("model", ""),
        "memory_window": cfg.get("memory_window", 100),
        "thinking": cfg.get("thinking", "none"),
        "emoji": cfg.get("emoji", ""),
        "used_by_agents": _get_provider_usages(provider_key),
    }


def _validate_agent_provider(provider_key: str) -> None:
    _require_provider(provider_key)


def _validate_channel_agent(agent_name: str) -> None:
    _require_agent(agent_name)


def _count_total_sessions() -> int:
    total = 0
    agents_dir = WORKSPACE_DIR / "agents"
    if not agents_dir.exists():
        return 0
    for sessions_dir in agents_dir.glob("*/sessions"):
        total += len(list(sessions_dir.glob("*.json")))
    return total


def _get_session_file(channel: str, session_id: str) -> tuple[str, Path]:
    if "/" in session_id or "\\" in session_id:
        raise HTTPException(status_code=400, detail="session_id invalid")
    if "@" in session_id and session_id.split("@", 1)[0] != channel:
        raise HTTPException(status_code=400, detail="session_id does not match channel")

    agent_name = config_manager.get(f"channels.{channel}.agent_name", "main")
    session_file = WORKSPACE_DIR / "agents" / agent_name / "sessions" / f"{session_id}.json"
    return agent_name, session_file


def _build_session_info(session_id: str, session_file: Path, agent_name: str) -> SessionInfo:
    """Extract display metadata from session file."""
    parts = session_id.split("@", 1)
    channel = parts[0] if len(parts) > 0 else "unknown"
    chat_id = parts[1] if len(parts) > 1 else "unknown"

    title = ""
    message_count = 0
    updated_at = None

    try:
        data = json.loads(session_file.read_text(encoding="utf-8"))
        messages: list = data.get("messages", data) if isinstance(data, dict) else data
        for msg in messages:
            role = msg.get("role", "")
            if role in ("user", "assistant"):
                message_count += 1
            if not title and role == "user":
                content = msg.get("content", "")
                if isinstance(content, str):
                    title = content[:40]
                elif isinstance(content, list):
                    for part in content:
                        if isinstance(part, dict) and part.get("type") == "text":
                            title = part.get("text", "")[:40]
                            break
            if msg.get("timestamp"):
                updated_at = msg["timestamp"]
    except Exception:
        pass

    return SessionInfo(
        session_id=session_id,
        channel=channel,
        chat_id=chat_id,
        agent_name=agent_name,
        title=title,
        message_count=message_count,
        updated_at=updated_at,
    )


@app.get("/providers/supported")
async def get_supported_providers():
    """Return all supported provider types and their required config fields."""
    registry = _build_provider_registry()
    return {
        "supported": [
            {
                "type": key,
                "description": info.description,
                "required_settings": info.required_settings,
                "optional_settings": info.optional_settings,
            }
            for key, info in registry.items()
        ]
    }


@app.get("/providers/config")
async def get_providers_config():
    """Return all currently configured provider instances."""
    providers_cfg: dict = config_manager.get("providers", {})
    return {
        "providers": [
            _build_provider_entry(key, cfg)
            for key, cfg in providers_cfg.items()
        ]
    }


@app.get("/providers/{key}")
async def get_provider_detail(key: str):
    """Return a single provider instance detail."""
    cfg = _require_provider(key)
    return _build_provider_entry(key, cfg)


@app.post("/providers")
async def add_provider(request: AddProviderRequest):
    """Add a new provider config."""
    if config_manager.get(f"providers.{request.key}"):
        raise HTTPException(status_code=400, detail=f"provider '{request.key}' already exists")

    _validate_provider_config(request.type, request.settings)
    config_manager.set(
        f"providers.{request.key}",
        {
            "type": request.type,
            "description": request.description,
            "settings": request.settings,
            "model": request.model,
            "memory_window": request.memory_window,
            "thinking": request.thinking,
            "emoji": request.emoji,
        },
    )
    return {"message": f"provider '{request.key}' added"}


@app.patch("/providers/{key}")
async def update_provider(key: str, request: UpdateProviderRequest):
    """Partially update provider config."""
    existing_cfg = config_manager.get(f"providers.{key}")
    if not existing_cfg:
        raise HTTPException(status_code=404, detail=f"provider '{key}' not found")

    merged_cfg = dict(existing_cfg)
    if request.type is not None:
        merged_cfg["type"] = request.type
    if request.description is not None:
        merged_cfg["description"] = request.description
    if request.settings is not None:
        merged_cfg["settings"] = {**existing_cfg.get("settings", {}), **request.settings}
    if request.model is not None:
        merged_cfg["model"] = request.model
    if request.memory_window is not None:
        if request.memory_window <= 0:
            raise HTTPException(status_code=400, detail="memory_window must be greater than 0")
        merged_cfg["memory_window"] = request.memory_window
    if request.thinking is not None:
        merged_cfg["thinking"] = request.thinking
    if request.emoji is not None:
        merged_cfg["emoji"] = request.emoji

    provider_type = merged_cfg.get("type", key)
    settings = merged_cfg.get("settings", {})
    _validate_provider_config(provider_type, settings)
    config_manager.set(f"providers.{key}", merged_cfg)
    return {"message": f"provider '{key}' updated"}


@app.delete("/providers/{key}")
async def delete_provider(key: str):
    """Delete provider config; reject if still referenced by agents."""
    providers_cfg: dict = config_manager.get("providers", {})
    if key not in providers_cfg:
        raise HTTPException(status_code=404, detail=f"provider '{key}' not found")

    used_by = _get_provider_usages(key)
    if used_by:
        raise HTTPException(
            status_code=400,
            detail={
                "message": f"provider '{key}' is referenced by agents, cannot delete",
                "used_by_agents": used_by,
            },
        )

    providers_cfg.pop(key, None)
    config_manager.set("providers", providers_cfg)
    return {"message": f"provider '{key}' deleted"}


@app.post("/providers/{key}/test")
async def test_provider(key: str):
    """Send a minimal message to provider to verify connectivity."""
    cfg = config_manager.get(f"providers.{key}")
    if not cfg:
        raise HTTPException(status_code=404, detail=f"provider '{key}' not found")

    registry = _build_provider_registry()
    provider_type = cfg.get("type", key)
    info = registry.get(provider_type)
    if not info:
        raise HTTPException(status_code=400, detail=f"Unsupported provider type: {provider_type}")

    model = cfg.get("model", "")
    if not model:
        raise HTTPException(status_code=400, detail="provider has no model configured")

    settings = cfg.get("settings", {})
    adapter = info.cls(**settings)

    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(
            None,
            lambda: adapter.response(
                model,
                [{"role": "user", "content": "Hi"}],
                None,
                thinking="none",
            ),
        )
        reply = (result.content or "")[:200]
        return {"ok": True, "reply": reply}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


# ── Channel management endpoints ───────────────────────────────────────────────

@app.get("/channels")
async def list_channels():
    """List currently registered channels and their status."""
    return get_channel_manager().status()


@app.get("/channels/config")
async def get_channels_config():
    """Return all configured channels (including web) with settings, description, agent_name."""
    channels_cfg: dict = config_manager.get("channels", {})
    return {
        "channels": [
            _build_channel_entry(key, cfg)
            for key, cfg in channels_cfg.items()
        ]
    }


@app.get("/channels/supported")
async def get_supported_channels():
    """Return all configurable channel types (builtin like web filtered out)."""
    registry = _build_registry()
    return {
        "supported": [
            {
                "type": type_key,
                "description": info.description,
                "required_settings": info.required_settings,
            }
            for type_key, info in registry.items()
            if not info.builtin
        ]
    }


@app.get("/channels/{key}")
async def get_channel_detail(key: str):
    """Return a single channel instance detail."""
    cfg = _require_channel(key)
    return _build_channel_entry(key, cfg)


@app.get("/channels/{key}/qr")
async def get_channel_qr(key: str):
    """Return QR code string for WhatsApp channel (WhatsApp type only)."""
    _require_channel(key)
    ch = get_channel_manager().get(key)
    if ch is None:
        raise HTTPException(status_code=404, detail="channel not running")
    qr = getattr(ch, "_qr_code", None)
    return {"qr": qr}


@app.post("/channels")
async def add_channel(request: AddChannelRequest):
    """Write config and start a new channel instance. Builtin types (e.g. web) cannot be added."""
    registry = _build_registry()
    info = registry.get(request.type)
    if info is None:
        raise HTTPException(status_code=400, detail=f"Unsupported channel type: {request.type}")
    if info.builtin:
        raise HTTPException(status_code=400, detail=f"channel type '{request.type}' is builtin, cannot add via API")
    if request.key in get_channel_manager()._channels:
        raise HTTPException(status_code=400, detail=f"channel '{request.key}' already exists")

    cfg = {
        "type": request.type,
        "agent_name": request.agent_name,
        "description": request.description,
        "settings": request.settings,
        "emoji": request.emoji,
    }
    config_manager.set(f"channels.{request.key}", cfg)
    await get_channel_manager()._start_channel(request.key, info, cfg)
    return {"message": f"channel '{request.key}' added and started"}


@app.patch("/channels/{key}")
async def update_channel(key: str, request: UpdateChannelRequest):
    """Partially update channel config and restart channel when running to apply."""
    existing_cfg = _require_channel(key)
    channel_type = existing_cfg.get("type", key)
    registry = _build_registry()
    info = registry.get(channel_type)
    if info is None:
        raise HTTPException(status_code=400, detail=f"Unsupported channel type: {channel_type}")

    merged_cfg = dict(existing_cfg)
    if request.agent_name is not None:
        _validate_channel_agent(request.agent_name)
        merged_cfg["agent_name"] = request.agent_name
    if request.description is not None:
        merged_cfg["description"] = request.description
    if request.settings is not None:
        merged_cfg["settings"] = {**existing_cfg.get("settings", {}), **request.settings}
    if request.emoji is not None:
        merged_cfg["emoji"] = request.emoji

    config_manager.set(f"channels.{key}", merged_cfg)
    if get_channel_manager().get(key) is not None:
        await get_channel_manager()._stop_channel(key)
        await get_channel_manager()._start_channel(key, info, merged_cfg)
    return {"message": f"channel '{key}' updated"}


@app.delete("/channels/{key}")
async def delete_channel(key: str):
    """Stop and remove a channel instance. Builtin channels (e.g. web) cannot be deleted."""
    registry = _build_registry()
    channel = get_channel_manager().get(key)
    if channel is None:
        raise HTTPException(status_code=404, detail=f"channel '{key}' not found")

    channel_type = config_manager.get(f"channels.{key}.type", key)
    info = registry.get(channel_type)
    if info and info.builtin:
        raise HTTPException(status_code=400, detail=f"channel '{key}' is builtin, cannot delete")

    await get_channel_manager()._stop_channel(key)
    cfg = config_manager.get("channels", {})
    cfg.pop(key, None)
    config_manager.set("channels", cfg)
    return {"message": f"channel '{key}' stopped and removed"}


BUILTIN_AGENTS = {"main"}


# ── Agent management endpoints ─────────────────────────────────────────────────

@app.get("/agents")
async def list_agents():
    """Return all configured agents and their config."""
    agents_cfg: dict = config_manager.get("agents", {})
    return {
        "agents": [
            _build_agent_entry(key, cfg)
            for key, cfg in agents_cfg.items()
        ]
    }


@app.get("/agents/{name}")
async def get_agent_detail(name: str):
    """Return a single agent detail."""
    cfg = _require_agent(name)
    return _build_agent_entry(name, cfg)


@app.post("/agents")
async def add_agent(request: AddAgentRequest):
    """Create new agent: copy template and write config."""
    import shutil
    global heartbeat_manager
    if config_manager.get(f"agents.{request.name}"):
        raise HTTPException(status_code=400, detail=f"agent '{request.name}' already exists")

    _validate_agent_provider(request.provider)

    template_dir = TEMPLATE_DIR
    agent_dir = WORKSPACE_DIR / "agents" / request.name
    agent_dir.mkdir(parents=True, exist_ok=True)

    for src in template_dir.rglob("*"):
        if src.suffix in (".py", ".pyc") or "__pycache__" in src.parts:
            continue
        dst = agent_dir / src.relative_to(template_dir)
        if src.is_dir():
            dst.mkdir(parents=True, exist_ok=True)
        else:
            shutil.copy2(src, dst)

    config_manager.set(f"agents.{request.name}", {
        "name": request.display_name,
        "description": request.description,
        "provider": request.provider,
        "emoji": request.emoji,
        "bootstrap_completed": False,
    })
    config_manager.set(f"heartbeat.{request.name}", dict(DEFAULT_HEARTBEAT_CONFIG))
    _ensure_agent_heartbeat_file(request.name)
    if heartbeat_manager is not None:
        await heartbeat_manager.rebuild_agent(request.name)
    return {"message": f"agent '{request.name}' created"}


@app.patch("/agents/{name}")
async def update_agent(name: str, request: UpdateAgentRequest):
    """Partially update agent config."""
    existing_cfg = _require_agent(name)
    merged_cfg = dict(existing_cfg)

    if request.display_name is not None:
        merged_cfg["name"] = request.display_name
    if request.description is not None:
        merged_cfg["description"] = request.description
    if request.provider is not None:
        _validate_agent_provider(request.provider)
        merged_cfg["provider"] = request.provider
    if request.emoji is not None:
        merged_cfg["emoji"] = request.emoji

    config_manager.set(f"agents.{name}", merged_cfg)
    return {"message": f"agent '{name}' updated"}


@app.post("/agents/{name}/reset")
async def reset_agent(name: str):
    """Reset agent workspace: clear dir, copy from template again, reset bootstrap state."""
    import shutil
    global heartbeat_manager
    _require_agent(name)

    agent_dir = WORKSPACE_DIR / "agents" / name
    if agent_dir.exists():
        shutil.rmtree(agent_dir)
    agent_dir.mkdir(parents=True, exist_ok=True)
    for src in TEMPLATE_DIR.rglob("*"):
        if src.suffix in (".py", ".pyc") or "__pycache__" in src.parts:
            continue
        dst = agent_dir / src.relative_to(TEMPLATE_DIR)
        if src.is_dir():
            dst.mkdir(parents=True, exist_ok=True)
        else:
            shutil.copy2(src, dst)
    _ensure_agent_heartbeat_file(name)

    existing_cfg = config_manager.get(f"agents.{name}", {})
    existing_cfg["bootstrap_completed"] = False
    config_manager.set(f"agents.{name}", existing_cfg)

    if heartbeat_manager is not None:
        await heartbeat_manager.rebuild_agent(name)

    return {"message": f"agent '{name}' workspace reset"}


@app.delete("/agents/{name}")
async def delete_agent(name: str):
    """Delete agent (remove config and workspace dir). Builtin agents cannot be deleted."""
    import shutil
    global heartbeat_manager
    if name in BUILTIN_AGENTS:
        raise HTTPException(status_code=400, detail=f"agent '{name}' is builtin, cannot delete")
    if not config_manager.get(f"agents.{name}"):
        raise HTTPException(status_code=404, detail=f"agent '{name}' not found")

    used_by = _get_agent_usages(name)
    if used_by:
        raise HTTPException(
            status_code=400,
            detail={
                "message": f"agent '{name}' is referenced by channels, cannot delete",
                "used_by_channels": used_by,
            },
        )

    agent_dir = WORKSPACE_DIR / "agents" / name
    if agent_dir.exists():
        shutil.rmtree(agent_dir)

    if heartbeat_manager is not None:
        heartbeat_manager.remove_agent(name)

    heartbeat_cfg = config_manager.get("heartbeat", {})
    if isinstance(heartbeat_cfg, dict):
        heartbeat_cfg.pop(name, None)
        config_manager.set("heartbeat", heartbeat_cfg)

    agents_cfg = config_manager.get("agents", {})
    agents_cfg.pop(name, None)
    config_manager.set("agents", agents_cfg)
    return {"message": f"agent '{name}' deleted"}


# ── Agent Workspace Files ──────────────────────────────────────────────────────

EDITABLE_AGENT_FILES = {"AGENTS.md", "SOUL.md", "USER.md", "TOOLS.md", "BOOTSTRAP.md", "HEARTBEAT.md"}


@app.get("/agents/{name}/files")
async def list_agent_files(name: str):
    """List editable md files under agent workspace."""
    _require_agent(name)
    agent_dir = WORKSPACE_DIR / "agents" / name
    if not agent_dir.exists():
        return {"files": []}
    files = [
        f.name for f in sorted(agent_dir.iterdir())
        if f.is_file() and f.name in EDITABLE_AGENT_FILES
    ]
    return {"files": files}


@app.get("/agents/{name}/files/{filename}")
async def read_agent_file(name: str, filename: str):
    """Read a single md file under agent workspace."""
    _require_agent(name)
    if filename not in EDITABLE_AGENT_FILES:
        raise HTTPException(status_code=400, detail=f"File not readable: {filename}")
    file_path = WORKSPACE_DIR / "agents" / name / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File '{filename}' not found")
    content = file_path.read_text(encoding="utf-8")
    return {"filename": filename, "content": content}


@app.put("/agents/{name}/files/{filename}")
async def write_agent_file(name: str, filename: str, body: WriteFileRequest):
    """Write a single md file under agent workspace."""
    _require_agent(name)
    if filename not in EDITABLE_AGENT_FILES:
        raise HTTPException(status_code=400, detail=f"File not editable: {filename}")
    file_path = WORKSPACE_DIR / "agents" / name / filename
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(body.content, encoding="utf-8")
    return {"message": f"File '{filename}' saved"}


# ── Skills management endpoints ───────────────────────────────────────────────


def _build_skill_entry(
    name: str, loader: SkillsLoader, source: str, agent_name: str | None = None,
) -> dict:
    """Build a skill info dict for API responses."""
    meta = loader.get_skill_metadata(name) or {}
    aurogen_meta = loader._parse_aurogen_metadata(meta.get("metadata", ""))
    available = loader._check_requirements(aurogen_meta)
    missing = loader._get_missing_requirements(aurogen_meta) if not available else None

    return SkillInfo(
        name=name,
        description=meta.get("description", name),
        source=source,
        agent_name=agent_name,
        available=available,
        missing_requirements=missing,
        metadata=aurogen_meta or None,
    ).model_dump()


@app.get("/skills")
async def list_skills(
    scope: str | None = None,
    agent_name: str = "main",
):
    """
    List skills.
    - scope empty: return builtin + specified agent's workspace skills
    - scope=builtin: builtin skills only
    - scope=workspace: specified agent's skills only
    """
    results: list[dict] = []

    if scope in (None, "builtin"):
        builtin_dir = resolve_skills_dir("builtin")
        if builtin_dir.exists():
            loader = get_skills_loader(agent_name)
            for skill_dir in sorted(builtin_dir.iterdir()):
                if skill_dir.is_dir() and (skill_dir / "SKILL.md").exists():
                    results.append(
                        _build_skill_entry(skill_dir.name, loader, source="builtin")
                    )

    if scope in (None, "workspace"):
        ws_dir = resolve_skills_dir("workspace", agent_name)
        if ws_dir.exists():
            loader = get_skills_loader(agent_name)
            for skill_dir in sorted(ws_dir.iterdir()):
                if skill_dir.is_dir() and (skill_dir / "SKILL.md").exists():
                    if not any(s["name"] == skill_dir.name for s in results):
                        results.append(
                            _build_skill_entry(
                                skill_dir.name, loader,
                                source="workspace", agent_name=agent_name,
                            )
                        )

    return {"skills": results}


@app.get("/skills/{name}")
async def get_skill_detail(
    name: str,
    scope: str | None = None,
    agent_name: str = "main",
):
    """Return a single skill detail (including SKILL.md content)."""
    loader = get_skills_loader(agent_name)

    if scope == "workspace":
        skill_file = resolve_skills_dir("workspace", agent_name) / name / "SKILL.md"
    elif scope == "builtin":
        skill_file = resolve_skills_dir("builtin") / name / "SKILL.md"
    else:
        ws_file = resolve_skills_dir("workspace", agent_name) / name / "SKILL.md"
        bi_file = resolve_skills_dir("builtin") / name / "SKILL.md"
        skill_file = ws_file if ws_file.exists() else bi_file

    if not skill_file.exists():
        raise HTTPException(status_code=404, detail=f"Skill '{name}' not found")

    source = "workspace" if "agents" in str(skill_file) else "builtin"
    content = skill_file.read_text(encoding="utf-8")
    meta = loader.get_skill_metadata(name) or {}
    aurogen_meta = loader._parse_aurogen_metadata(meta.get("metadata", ""))
    available = loader._check_requirements(aurogen_meta)
    missing = loader._get_missing_requirements(aurogen_meta) if not available else None

    return SkillDetailResponse(
        name=name,
        description=meta.get("description", name),
        source=source,
        agent_name=agent_name if source == "workspace" else None,
        available=available,
        missing_requirements=missing,
        metadata=aurogen_meta or None,
        content=content,
    ).model_dump()


@app.post("/skills/upload")
async def upload_skill(
    file: UploadFile = File(...),
    scope: str = Form(...),
    agent_name: str = Form("main"),
):
    """
    Upload zip skill package and extract to target dir.
    scope: "builtin" | "workspace"
    agent_name: target agent when scope=workspace
    """
    if scope not in ("builtin", "workspace"):
        raise HTTPException(status_code=400, detail="scope must be 'builtin' or 'workspace'")

    if not file.filename or not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Please upload a .zip file")

    MAX_SIZE = 50 * 1024 * 1024  # 50 MB
    zip_bytes = await file.read()
    if len(zip_bytes) > MAX_SIZE:
        raise HTTPException(status_code=400, detail="File size exceeds 50 MB limit")

    target_dir = resolve_skills_dir(scope, agent_name)

    try:
        skill_name = SkillsLoader.install_skill_from_zip(
            zip_bytes, target_dir, filename=file.filename or "",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {
        "message": f"Skill '{skill_name}' installed",
        "name": skill_name,
        "scope": scope,
        "agent_name": agent_name if scope == "workspace" else None,
        "path": str(target_dir / skill_name),
    }


@app.delete("/skills/{name}")
async def delete_skill(
    name: str,
    scope: str = "builtin",
    agent_name: str = "main",
):
    """Delete the specified skill folder."""
    if scope not in ("builtin", "workspace"):
        raise HTTPException(status_code=400, detail="scope must be 'builtin' or 'workspace'")

    target_dir = resolve_skills_dir(scope, agent_name)

    try:
        SkillsLoader.delete_skill(name, target_dir)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return {
        "message": f"Skill '{name}' deleted",
        "scope": scope,
        "agent_name": agent_name if scope == "workspace" else None,
    }


@app.post("/channels/reload")
async def reload_channels():
    """
    Compare config with running channels, incremental update:
    - new in config → start()
    - removed from config → stop()
        - changed in config → restart()
        - unchanged → keep running
    """
    config_manager.reload()
    result = await get_channel_manager().reload()
    return result


# ── Message endpoints ──────────────────────────────────────────────────────────


@app.post("/chat/session")
async def create_chat_session(request: CreateChatSessionRequest):
    """Create a new web chat session, return session_id and bound agent."""
    if request.channel != "web":
        raise HTTPException(status_code=400, detail="Only web channel chat session creation is supported")

    chat_id = request.chat_id or uuid4().hex[:8]
    session_id = f"{request.channel}@{chat_id}"
    agent_name = config_manager.get(f"channels.{request.channel}.agent_name", "main")

    # Persist empty session on create so list is not lost after refresh before first message.
    Session(session_id)

    return {
        "session_id": session_id,
        "channel": request.channel,
        "chat_id": chat_id,
        "agent_name": agent_name,
    }


@app.get("/chat/events/schema")
async def get_chat_events_schema():
    """Return web chat SSE event protocol description."""
    return {
        "transport": "sse",
        "endpoint": "/chat",
        "events": [
            {
                "event": EventType.THINKING.value,
                "description": "LLM thinking process",
                "data_schema": {"content": "string"},
            },
            {
                "event": EventType.TOOL_CALL.value,
                "description": "Tool call started",
                "data_schema": {"tool_name": "string", "args": "object"},
            },
            {
                "event": EventType.TOOL_RESULT.value,
                "description": "Tool call result",
                "data_schema": {"tool_name": "string", "result": "string"},
            },
            {
                "event": EventType.FINAL.value,
                "description": "Final reply",
                "data_schema": {"content": "string"},
            },
        ],
    }


@app.get("/system/status")
async def get_system_status():
    """Return system status for frontend home and status bar."""
    loaded_mcp_tools = []
    if agent_loop:
        loaded_mcp_tools = [
            name for name in getattr(agent_loop.tools, "tool_names", [])
            if name.startswith("mcp_")
        ]
    heartbeat_status = heartbeat_manager.status() if heartbeat_manager else {"running": False, "instances": {}}
    return {
        "app": "ok",
        "agent_loop_running": bool(agent_loop and agent_loop._running),
        "heartbeat": heartbeat_status,
        "cron": {
            "running": bool(agent_loop and agent_loop.cron_service._running),
        },
        "channels": get_channel_manager().status()["channels"],
        "mcp": {
            "configured": len(config_manager.get("mcp", {})),
            "loaded_count": len(loaded_mcp_tools),
            "loaded_tools": loaded_mcp_tools,
        },
    }


@app.get("/resources/summary")
async def get_resources_summary():
    """Return resource summary for Web console home."""
    return {
        "agents_count": len(config_manager.get("agents", {})),
        "channels_count": len(config_manager.get("channels", {})),
        "providers_count": len(config_manager.get("providers", {})),
        "sessions_count": _count_total_sessions(),
    }


@app.get("/sessions")
async def list_sessions_v2(
    group_by: str = "channel",
    channel: str | None = None,
    agent_name: str | None = None,
) -> dict:
    """
    List all sessions, optionally grouped by channel or agent.
    - group_by: "channel" | "agent"
    - channel: optional filter by channel
    - agent_name: optional filter by agent
    """
    if group_by not in ("channel", "agent"):
        raise HTTPException(status_code=400, detail="group_by must be 'channel' or 'agent'")

    agents_dir = WORKSPACE_DIR / "agents"
    groups: dict[str, list[dict]] = {}

    if agents_dir.exists():
        for agent_dir in sorted(agents_dir.iterdir()):
            if not agent_dir.is_dir():
                continue
            current_agent = agent_dir.name
            if agent_name and current_agent != agent_name:
                continue
            sessions_dir = agent_dir / "sessions"
            if not sessions_dir.exists():
                continue
            for session_file in sorted(sessions_dir.glob("*.json"), key=lambda f: f.stat().st_mtime, reverse=True):
                sid = session_file.stem
                if "@" not in sid:
                    continue
                sid_channel = sid.split("@", 1)[0]
                if channel and sid_channel != channel:
                    continue
                info = _build_session_info(sid, session_file, current_agent)
                group_key = sid_channel if group_by == "channel" else current_agent
                groups.setdefault(group_key, []).append(info.model_dump())

    return {
        "group_by": group_by,
        "groups": [
            {"key": key, "sessions": sessions}
            for key, sessions in groups.items()
        ],
    }


@app.get("/list-sessions")
async def list_sessions(channel: str) -> dict:
    agent_name = config_manager.get(f"channels.{channel}.agent_name", "main")
    sessions_dir = WORKSPACE_DIR / "agents" / agent_name / "sessions"
    if not sessions_dir.exists():
        return {"agent_name": agent_name, "sessions": []}
    sessions: list[SessionInfo] = []
    for f in sorted(sessions_dir.glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True):
        session_id = f.stem
        parts = session_id.split("@", 1)
        if len(parts) != 2 or parts[0] != channel:
            continue
        sessions.append(_build_session_info(session_id, f, agent_name))
    return {"agent_name": agent_name, "sessions": [s.model_dump() for s in sessions]}


@app.get("/get-session")
async def get_session(channel: str, session_id: str) -> dict:
    """Read chat history by channel and session_id."""
    agent_name, session_file = _get_session_file(channel, session_id)
    if not session_file.exists():
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
    data = json.loads(session_file.read_text(encoding="utf-8"))
    messages = data.get("messages", data) if isinstance(data, dict) else data
    return {
        "agent_name": agent_name,
        "session_id": session_id,
        "messages": messages,
    }


@app.delete("/delete-session")
async def delete_session(channel: str, session_id: str) -> dict:
    """Delete session file by channel and session_id."""
    agent_name, session_file = _get_session_file(channel, session_id)
    if not session_file.exists():
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")

    session_file.unlink()
    return {
        "message": f"Session '{session_id}' deleted",
        "agent_name": agent_name,
        "session_id": session_id,
    }


@app.post("/send-message")
async def send_message(request: SendMessageRequest):

    msg = InboundMessage(
        session_id=request.session_id,
        content=request.message,
        metadata=request.metadata or {}
    )
    await get_inbound_queue().put(msg)
    return {"message": "Message sent successfully"}


@app.post("/chat")
async def chat(request: SendMessageRequest):
    """SSE endpoint: send message and stream multi-turn feedback (web channel only)."""
    session_id = request.session_id

    web_channel = get_channel_manager().get("web")
    if not isinstance(web_channel, WebChannel):
        raise HTTPException(status_code=503, detail="web channel not started")

    queue = await web_channel.subscribe(session_id)
    await web_channel.receive(
        session_id=session_id,
        content=request.message,
        metadata=request.metadata,
    )

    async def event_stream():
        try:
            async for sse_str in web_channel.event_stream(queue):
                yield sse_str
        finally:
            await web_channel.unsubscribe(session_id)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


# Mount frontend static files (only when dist exists; does not affect local dev)
_dist_dir = Path(__file__).resolve().parent.parent.parent / "aurogen_web" / "dist"
if _dist_dir.exists():
    app.mount("/", StaticFiles(directory=_dist_dir, html=True), name="static")
