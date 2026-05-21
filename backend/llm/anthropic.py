import os
from typing import Iterator

from anthropic import Anthropic

from .base import LLMProvider

_DEFAULT_SYSTEM = "You are a helpful code analysis assistant."


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
            system=system or _DEFAULT_SYSTEM,
            messages=messages,
        )
        return response.content[0].text

    def stream(self, messages: list[dict], system: str = "") -> Iterator[str]:
        with self._client.messages.stream(
            model=self._model,
            max_tokens=3000,
            system=system or _DEFAULT_SYSTEM,
            messages=messages,
        ) as s:
            yield from s.text_stream
