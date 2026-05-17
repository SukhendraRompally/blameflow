import os

from .base import LLMProvider


def get_provider() -> LLMProvider:
    name = os.getenv("LLM_PROVIDER", "azure_openai").lower().strip()

    if name == "azure_openai":
        from .azure_openai import AzureOpenAIProvider
        return AzureOpenAIProvider()

    if name == "anthropic":
        from .anthropic import AnthropicProvider
        return AnthropicProvider()

    if name == "openai":
        from .openai_provider import OpenAIProvider
        return OpenAIProvider()

    raise ValueError(
        f"Unknown LLM_PROVIDER '{name}'. Valid options: azure_openai | anthropic | openai"
    )


__all__ = ["LLMProvider", "get_provider"]
