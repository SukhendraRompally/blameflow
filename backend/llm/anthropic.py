import os

from anthropic import Anthropic

from .base import LLMProvider


class AnthropicProvider(LLMProvider):
    def __init__(self) -> None:
        self._client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        self._model = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")

    @property
    def name(self) -> str:
        return "anthropic"

    def complete(self, messages: list[dict], system: str = "") -> str:
        response = self._client.messages.create(
            model=self._model,
            max_tokens=3000,
            system=system or "You are a helpful code analysis assistant.",
            messages=messages,
        )
        return response.content[0].text
