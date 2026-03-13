from dataclasses import dataclass, field
from typing import Any

from config.config import config_manager
from providers.base import BaseProviderAdapter
from providers.adapters import (
    OpenAICustomAdapter,
    OpenAIOfficialAdapter,
    AnthropicAdapter,
    AzureAdapter,
    OllamaAdapter,
    OpenRouterAdapter,
    XAIAdapter,
)


@dataclass
class ProviderTypeInfo:
    cls: type[BaseProviderAdapter]
    description: str = ""
    required_settings: list[str] = field(default_factory=list)
    optional_settings: list[str] = field(default_factory=list)


def _build_provider_registry() -> dict[str, ProviderTypeInfo]:
    return {
        "openai": ProviderTypeInfo(
            cls=OpenAIOfficialAdapter,
            description="OpenAI 官方 API",
            required_settings=["api_key"],
        ),
        "openai_custom": ProviderTypeInfo(
            cls=OpenAICustomAdapter,
            description="OpenAI 兼容 API（代理/中转）",
            required_settings=["api_key"],
            optional_settings=["api_base"],
        ),
        "anthropic": ProviderTypeInfo(
            cls=AnthropicAdapter,
            description="Anthropic Claude",
            required_settings=["api_key"],
        ),
        "azure": ProviderTypeInfo(
            cls=AzureAdapter,
            description="Azure OpenAI",
            required_settings=["api_key", "api_base", "api_version"],
        ),
        "ollama": ProviderTypeInfo(
            cls=OllamaAdapter,
            description="Ollama 本地模型",
            optional_settings=["api_base"],
        ),
        "openrouter": ProviderTypeInfo(
            cls=OpenRouterAdapter,
            description="OpenRouter",
            required_settings=["api_key"],
        ),
        "xai": ProviderTypeInfo(
            cls=XAIAdapter,
            description="xAI Grok",
            required_settings=["api_key"],
        ),
    }


class Provider:
    """LLM Provider 路由：根据 agent 配置选择对应 adapter 发起请求。"""

    def _response_with_provider_key(
        self,
        provider_key: str,
        messages: list[dict],
        tools: list[dict] | None = None,
    ) -> Any:
        provider_cfg = config_manager.get(f"providers.{provider_key}", {})
        model = provider_cfg.get("model", "gpt-4o")
        thinking = provider_cfg.get("thinking", "none")

        registry = _build_provider_registry()
        provider_type = provider_cfg.get("type", provider_key)
        info = registry.get(provider_type)
        if not info:
            raise ValueError(f"Unsupported provider type: {provider_type}")

        settings = provider_cfg.get("settings", {})
        adapter = info.cls(**settings)
        return adapter.response(model, messages, tools, thinking=thinking)

    def response(
        self,
        messages: list[dict],
        tools: list[dict] | None = None,
        agent_name: str = "main",
    ) -> Any:
        provider_key = config_manager.get(f"agents.{agent_name}.provider", "openai")
        return self._response_with_provider_key(provider_key, messages, tools)

    def response_for_provider(
        self,
        provider_key: str,
        messages: list[dict],
        tools: list[dict] | None = None,
    ) -> Any:
        return self._response_with_provider_key(provider_key, messages, tools)
