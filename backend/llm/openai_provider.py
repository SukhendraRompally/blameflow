import os

from openai import OpenAI

from .base import LLMProvider


class OpenAIProvider(LLMProvider):
    def __init__(self) -> None:
        self._client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
        self._model = os.getenv("OPENAI_MODEL", "gpt-4o")

    @property
    def name(self) -> str:
        return "openai"

    def complete(self, messages: list[dict], system: str = "") -> str:
        all_messages: list[dict] = []
        if system:
            all_messages.append({"role": "system", "content": system})
        all_messages.extend(messages)

        response = self._client.chat.completions.create(
            model=self._model,
            messages=all_messages,
            temperature=0.2,
            max_tokens=3000,
        )
        return response.choices[0].message.content or ""
