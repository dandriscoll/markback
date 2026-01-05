"""LLM client abstraction for MarkBack."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional, Protocol

import httpx

from .config import LLMConfig


@dataclass
class LLMResponse:
    """Response from an LLM call."""
    content: str
    model: str
    usage: Optional[dict] = None
    raw_response: Optional[dict] = None


class LLMClient(ABC):
    """Abstract base class for LLM clients."""

    @abstractmethod
    def complete(
        self,
        prompt: str,
        system: Optional[str] = None,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
    ) -> LLMResponse:
        """Send a completion request.

        Args:
            prompt: The user prompt
            system: Optional system prompt
            max_tokens: Override default max tokens
            temperature: Override default temperature

        Returns:
            LLM response
        """
        pass


class OpenAICompatibleClient(LLMClient):
    """Client for OpenAI-compatible APIs."""

    def __init__(self, config: LLMConfig):
        self.config = config
        self.client = httpx.Client(timeout=config.timeout)

    def complete(
        self,
        prompt: str,
        system: Optional[str] = None,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
    ) -> LLMResponse:
        """Send a completion request to OpenAI-compatible API."""
        messages = []

        if system:
            messages.append({"role": "system", "content": system})

        messages.append({"role": "user", "content": prompt})

        payload = {
            "model": self.config.model,
            "messages": messages,
            "max_tokens": max_tokens or self.config.max_tokens,
            "temperature": temperature if temperature is not None else self.config.temperature,
        }

        headers = {
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json",
        }

        url = f"{self.config.api_base.rstrip('/')}/chat/completions"

        response = self.client.post(url, json=payload, headers=headers)
        response.raise_for_status()

        data = response.json()

        return LLMResponse(
            content=data["choices"][0]["message"]["content"],
            model=data.get("model", self.config.model),
            usage=data.get("usage"),
            raw_response=data,
        )

    def close(self):
        """Close the HTTP client."""
        self.client.close()


class MockLLMClient(LLMClient):
    """Mock LLM client for testing."""

    def __init__(
        self,
        responses: Optional[list[str]] = None,
        default_response: str = "Mock response",
    ):
        self.responses = responses or []
        self.default_response = default_response
        self.call_count = 0
        self.calls: list[dict] = []

    def complete(
        self,
        prompt: str,
        system: Optional[str] = None,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
    ) -> LLMResponse:
        """Return a mock response."""
        self.calls.append({
            "prompt": prompt,
            "system": system,
            "max_tokens": max_tokens,
            "temperature": temperature,
        })

        if self.call_count < len(self.responses):
            content = self.responses[self.call_count]
        else:
            content = self.default_response

        self.call_count += 1

        return LLMResponse(
            content=content,
            model="mock-model",
            usage={"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20},
        )

    def reset(self):
        """Reset call tracking."""
        self.call_count = 0
        self.calls = []


class LLMClientFactory:
    """Factory for creating LLM clients."""

    _mock_client: Optional[MockLLMClient] = None

    @classmethod
    def set_mock(cls, client: Optional[MockLLMClient]):
        """Set a mock client for testing."""
        cls._mock_client = client

    @classmethod
    def create(cls, config: LLMConfig) -> LLMClient:
        """Create an LLM client from config.

        If a mock client is set, returns that instead.
        """
        if cls._mock_client is not None:
            return cls._mock_client

        return OpenAICompatibleClient(config)


def create_editor_client(config: LLMConfig) -> LLMClient:
    """Create an editor LLM client."""
    return LLMClientFactory.create(config)


def create_operator_client(config: LLMConfig) -> LLMClient:
    """Create an operator LLM client."""
    return LLMClientFactory.create(config)
