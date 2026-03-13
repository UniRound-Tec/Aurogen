from typing import Any

from openai import OpenAI
from loguru import logger

from providers.base import AdapterResponse, BaseProviderAdapter


def _normalize_tool_calls(raw_tool_calls: Any) -> list[dict] | None:
    """将 OpenAI SDK 的 tool_calls 对象列表标准化为 list[dict]。"""
    if not raw_tool_calls:
        return None
    return [
        {
            "id": tc.id,
            "type": "function",
            "function": {
                "name": tc.function.name,
                "arguments": tc.function.arguments,
            },
        }
        for tc in raw_tool_calls
    ]


def _parse_openai_message(message: Any) -> tuple[str, str | None, Any]:
    """从 OpenAI 兼容 message 对象中提取 (content, thinking, reasoning_details)。

    支持两种 thinking 格式：
    - aihubmix 格式：thinking 在 message.reasoning_content（字符串）
    - 原生 Anthropic API 格式：message.content 是含 thinking/text block 的列表
    """
    reasoning_details = getattr(message, "reasoning_details", None)

    # ── aihubmix 格式 ────────────────────────────────────────────────────────
    reasoning_content = getattr(message, "reasoning_content", None)
    if reasoning_content:
        raw_content = message.content
        content = raw_content if isinstance(raw_content, str) else str(raw_content or "")
        return content, reasoning_content, reasoning_details

    # ── 原生 Anthropic content block 列表格式 ────────────────────────────────
    raw_content = getattr(message, "content", None)
    if isinstance(raw_content, list):
        text_parts: list[str] = []
        thinking_parts: list[str] = []
        for block in raw_content:
            btype = block.get("type") if isinstance(block, dict) else getattr(block, "type", None)
            if btype == "thinking":
                t = block.get("thinking") if isinstance(block, dict) else getattr(block, "thinking", "")
                thinking_parts.append(t or "")
            elif btype == "text":
                t = block.get("text") if isinstance(block, dict) else getattr(block, "text", "")
                text_parts.append(t or "")
        thinking = "\n".join(thinking_parts) if thinking_parts else None
        return "\n".join(text_parts), thinking, reasoning_details

    # ── 普通字符串格式 ────────────────────────────────────────────────────────
    content = raw_content if isinstance(raw_content, str) else str(raw_content or "")
    return content, None, reasoning_details


def _should_retry_without_reasoning_effort(exc: Exception) -> bool:
    """Return True when the upstream rejects reasoning_effort/reasoningEffort."""
    text = str(exc).lower()
    return (
        ("reasoning_effort" in text or "reasoningeffort" in text)
        and ("does not support" in text or "unsupported" in text or "invalid" in text)
    )


def _create_with_reasoning_fallback(client: OpenAI, kwargs: dict[str, Any]) -> Any:
    """Retry once without reasoning_effort when an upstream model rejects it."""
    try:
        return client.chat.completions.create(**kwargs)
    except Exception as exc:
        if "reasoning_effort" not in kwargs or not _should_retry_without_reasoning_effort(exc):
            raise

        retry_kwargs = dict(kwargs)
        retry_kwargs.pop("reasoning_effort", None)
        logger.warning(
            "Provider rejected reasoning_effort for model '{}', retrying without it",
            kwargs.get("model", ""),
        )
        return client.chat.completions.create(**retry_kwargs)


class OpenAICustomAdapter(BaseProviderAdapter):
    """OpenAI 兼容 API（适用于代理地址，如 aihubmix）"""

    def __init__(self, api_key: str = "", api_base: str = "", **_):
        self.api_key = api_key
        self.api_base = api_base or "https://api.openai.com/v1"

    def response(
        self,
        model: str,
        messages: list[dict],
        tools: list[dict] | None = None,
        thinking: str = "none",
    ) -> AdapterResponse:
        client = OpenAI(api_key=self.api_key, base_url=self.api_base)
        kwargs: dict = {"model": model, "messages": messages}
        if tools:
            kwargs["tools"] = tools
        if thinking != "none":
            kwargs["reasoning_effort"] = thinking

        raw = _create_with_reasoning_fallback(client, kwargs)
        message = raw.choices[0].message

        content, thinking, reasoning_details = _parse_openai_message(message)
        tool_calls = _normalize_tool_calls(getattr(message, "tool_calls", None))

        return AdapterResponse(
            content=content,
            thinking=thinking,
            tool_calls=tool_calls,
            reasoning_details=reasoning_details,
        )


class OpenAIOfficialAdapter(BaseProviderAdapter):
    """OpenAI 官方 API。"""

    def __init__(self, api_key: str = "", **_):
        self.api_key = api_key

    def response(
        self,
        model: str,
        messages: list[dict],
        tools: list[dict] | None = None,
        thinking: str = "none",
    ) -> AdapterResponse:
        client = OpenAI(api_key=self.api_key)
        kwargs: dict = {"model": model, "messages": messages}
        if tools:
            kwargs["tools"] = tools
        if thinking != "none":
            kwargs["reasoning_effort"] = thinking

        raw = _create_with_reasoning_fallback(client, kwargs)
        message = raw.choices[0].message
        raw_content = getattr(message, "content", None)

        if isinstance(raw_content, list):
            text_parts: list[str] = []
            for block in raw_content:
                btype = block.get("type") if isinstance(block, dict) else getattr(block, "type", None)
                if btype == "text":
                    text_parts.append(
                        block.get("text") if isinstance(block, dict) else getattr(block, "text", "")
                    )
            content = "\n".join(part for part in text_parts if part)
        else:
            content = raw_content if isinstance(raw_content, str) else str(raw_content or "")

        tool_calls = _normalize_tool_calls(getattr(message, "tool_calls", None))
        return AdapterResponse(
            content=content,
            thinking=None,
            tool_calls=tool_calls,
            reasoning_details=None,
        )


class AnthropicAdapter(BaseProviderAdapter):
    """Anthropic Claude 原生 API — 待实现"""

    def __init__(self, api_key: str = "", **_):
        self.api_key = api_key

    def response(
        self,
        model: str,
        messages: list[dict],
        tools: list[dict] | None = None,
        thinking: str = "none",
    ) -> AdapterResponse:
        raise NotImplementedError("AnthropicAdapter.response() 待实现")


class AzureAdapter(BaseProviderAdapter):
    """Azure OpenAI"""

    def __init__(self, api_key: str = "", api_base: str = "", api_version: str = "2024-02-01", **_):
        self.api_key = api_key
        self.api_base = api_base
        self.api_version = api_version

    def response(
        self,
        model: str,
        messages: list[dict],
        tools: list[dict] | None = None,
        thinking: str = "none",
    ) -> AdapterResponse:
        from openai import AzureOpenAI
        client = AzureOpenAI(
            api_key=self.api_key,
            azure_endpoint=self.api_base,
            api_version=self.api_version,
        )
        kwargs: dict = {"model": model, "messages": messages}
        if tools:
            kwargs["tools"] = tools
        raw = client.chat.completions.create(**kwargs)
        message = raw.choices[0].message
        content, thinking, reasoning_details = _parse_openai_message(message)
        tool_calls = _normalize_tool_calls(getattr(message, "tool_calls", None))
        return AdapterResponse(content=content, thinking=thinking, tool_calls=tool_calls, reasoning_details=reasoning_details)


class OllamaAdapter(BaseProviderAdapter):
    """Ollama 本地模型 — OpenAI 兼容接口"""

    def __init__(self, api_base: str = "http://localhost:11434/v1", **_):
        self.api_base = api_base

    def response(
        self,
        model: str,
        messages: list[dict],
        tools: list[dict] | None = None,
        thinking: str = "none",
    ) -> AdapterResponse:
        client = OpenAI(api_key="ollama", base_url=self.api_base)
        kwargs: dict = {"model": model, "messages": messages}
        if tools:
            kwargs["tools"] = tools
        raw = client.chat.completions.create(**kwargs)
        message = raw.choices[0].message
        content, thinking, reasoning_details = _parse_openai_message(message)
        tool_calls = _normalize_tool_calls(getattr(message, "tool_calls", None))
        return AdapterResponse(content=content, thinking=thinking, tool_calls=tool_calls, reasoning_details=reasoning_details)


class OpenRouterAdapter(BaseProviderAdapter):
    """OpenRouter — OpenAI 兼容接口"""

    def __init__(self, api_key: str = "", **_):
        self.api_key = api_key

    def response(
        self,
        model: str,
        messages: list[dict],
        tools: list[dict] | None = None,
        thinking: str = "none",
    ) -> AdapterResponse:
        client = OpenAI(api_key=self.api_key, base_url="https://openrouter.ai/api/v1")
        kwargs: dict = {"model": model, "messages": messages}
        if tools:
            kwargs["tools"] = tools
        raw = client.chat.completions.create(**kwargs)
        message = raw.choices[0].message
        content, thinking, reasoning_details = _parse_openai_message(message)
        tool_calls = _normalize_tool_calls(getattr(message, "tool_calls", None))
        return AdapterResponse(content=content, thinking=thinking, tool_calls=tool_calls, reasoning_details=reasoning_details)


class XAIAdapter(BaseProviderAdapter):
    """xAI Grok — OpenAI 兼容接口"""

    def __init__(self, api_key: str = "", **_):
        self.api_key = api_key

    def response(
        self,
        model: str,
        messages: list[dict],
        tools: list[dict] | None = None,
        thinking: str = "none",
    ) -> AdapterResponse:
        client = OpenAI(api_key=self.api_key, base_url="https://api.x.ai/v1")
        kwargs: dict = {"model": model, "messages": messages}
        if tools:
            kwargs["tools"] = tools
        raw = client.chat.completions.create(**kwargs)
        message = raw.choices[0].message
        content, thinking, reasoning_details = _parse_openai_message(message)
        tool_calls = _normalize_tool_calls(getattr(message, "tool_calls", None))
        return AdapterResponse(content=content, thinking=thinking, tool_calls=tool_calls, reasoning_details=reasoning_details)
