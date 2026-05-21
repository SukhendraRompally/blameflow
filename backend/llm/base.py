from abc import ABC, abstractmethod
from typing import Iterator


class LLMProvider(ABC):
    @property
    @abstractmethod
    def name(self) -> str: ...

    @abstractmethod
    def complete(self, messages: list[dict], system: str = "") -> str:
        """Send a list of {role, content} messages and return the assistant reply."""
        ...

    @abstractmethod
    def stream(self, messages: list[dict], system: str = "") -> Iterator[str]:
        """Stream token chunks. Yields non-empty strings as they arrive."""
        ...
