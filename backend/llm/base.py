from abc import ABC, abstractmethod


class LLMProvider(ABC):
    @property
    @abstractmethod
    def name(self) -> str: ...

    @abstractmethod
    def complete(self, messages: list[dict], system: str = "") -> str:
        """Send a list of {role, content} messages and return the assistant reply."""
        ...
