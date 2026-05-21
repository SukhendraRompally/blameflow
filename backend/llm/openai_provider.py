import os
from typing import Iterator

from openai import OpenAI

from .base import LLMProvider


class OpenAIProvider(LLMProvider):
    def __init__(self) -> None:
        self._client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
        self._model = os.getenv("OPENAI_MODEL", "gpt-4o")

    @property
    def name(self) -> str:
        return "openai"

    def _build_messages(self, messages: list[dict], system: str) -> list[dict]:
        all_messages: list[dict] = []
        if system:
            all_messages.append({"role": "system", "content": system})
        all_messages.extend(messages)
        return all_messages

    def complete(self, messages: list[dict], system: str = "") -> str:
        response = self._client.chat.completions.create(
            model=self._model,
            messages=self._build_messages(messages, system),
            temperature=0.2,
            max_tokens=3000,
        )
        return response.choices[0].message.content or ""

    def stream(self, messages: list[dict], system: str = "") -> Iterator[str]:
        response = self._client.chat.completions.create(
            model=self._model,
            messages=self._build_messages(messages, system),
            temperature=0.2,
            max_tokens=3000,
            stream=True,
        )
        for chunk in response:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
