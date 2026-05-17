import os

from openai import AzureOpenAI

from .base import LLMProvider


class AzureOpenAIProvider(LLMProvider):
    def __init__(self) -> None:
        for key in ("AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_API_KEY", "AZURE_OPENAI_DEPLOYMENT"):
            if not os.environ.get(key):
                raise RuntimeError(
                    f"Missing required environment variable: {key}. "
                    "Add it in Render → blameflow-api → Environment."
                )
        self._client = AzureOpenAI(
            azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
            api_key=os.environ["AZURE_OPENAI_API_KEY"],
            api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2024-02-01"),
        )
        self._deployment = os.environ["AZURE_OPENAI_DEPLOYMENT"]

    @property
    def name(self) -> str:
        return "azure_openai"

    def complete(self, messages: list[dict], system: str = "") -> str:
        all_messages: list[dict] = []
        if system:
            all_messages.append({"role": "system", "content": system})
        all_messages.extend(messages)

        response = self._client.chat.completions.create(
            model=self._deployment,
            messages=all_messages,
            temperature=0.2,
            max_tokens=3000,
        )
        return response.choices[0].message.content or ""
