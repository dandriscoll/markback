"""Configuration management for MarkBack."""

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv


# Default .env template content
ENV_TEMPLATE = '''# MarkBack Configuration
# =====================

# File handling mode: "git" (in-place) or "versioned" (never overwrite)
FILE_MODE=git

# Label file discovery suffixes (comma-separated)
LABEL_SUFFIXES=.label.txt,.feedback.txt,.mb

# Editor LLM Configuration
# ------------------------
# The Editor LLM refines prompts based on examples and feedback
EDITOR_API_BASE=https://api.openai.com/v1
EDITOR_API_KEY=your-api-key-here
EDITOR_MODEL=gpt-4
EDITOR_MAX_TOKENS=2048
EDITOR_TEMPERATURE=0.7
EDITOR_TIMEOUT=60

# Operator LLM Configuration
# --------------------------
# The Operator LLM runs the refined prompt against examples
OPERATOR_API_BASE=https://api.openai.com/v1
OPERATOR_API_KEY=your-api-key-here
OPERATOR_MODEL=gpt-4
OPERATOR_MAX_TOKENS=1024
OPERATOR_TEMPERATURE=0.3
OPERATOR_TIMEOUT=60

# Evaluation Configuration
# ------------------------
# Labels that indicate positive/passing examples (comma-separated)
POSITIVE_LABELS=good,positive,pass,approved,excellent,correct
# Labels that indicate negative/failing examples (comma-separated)
NEGATIVE_LABELS=bad,negative,fail,rejected,needs work,incorrect
'''


@dataclass
class LLMConfig:
    """Configuration for an LLM endpoint."""
    api_base: str
    api_key: str
    model: str
    max_tokens: int = 1024
    temperature: float = 0.7
    timeout: int = 60


@dataclass
class Config:
    """MarkBack configuration."""
    file_mode: str = "git"  # "git" or "versioned"
    label_suffixes: list[str] = field(default_factory=lambda: [".label.txt", ".feedback.txt", ".mb"])

    # LLM configs
    editor: Optional[LLMConfig] = None
    operator: Optional[LLMConfig] = None

    # Evaluation
    positive_labels: list[str] = field(default_factory=lambda: ["good", "positive", "pass", "approved", "excellent", "correct"])
    negative_labels: list[str] = field(default_factory=lambda: ["bad", "negative", "fail", "rejected", "needs work", "incorrect"])


def load_config(env_path: Optional[Path] = None) -> Config:
    """Load configuration from .env file.

    Args:
        env_path: Path to .env file. If None, searches current directory and parents.

    Returns:
        Loaded configuration
    """
    # Load .env file
    if env_path:
        load_dotenv(env_path)
    else:
        load_dotenv()

    # Parse configuration
    config = Config()

    # File mode
    file_mode = os.getenv("FILE_MODE", "git")
    if file_mode in ("git", "versioned"):
        config.file_mode = file_mode

    # Label suffixes
    suffixes = os.getenv("LABEL_SUFFIXES")
    if suffixes:
        config.label_suffixes = [s.strip() for s in suffixes.split(",") if s.strip()]

    # Editor LLM
    editor_base = os.getenv("EDITOR_API_BASE")
    editor_key = os.getenv("EDITOR_API_KEY")
    editor_model = os.getenv("EDITOR_MODEL")

    if editor_base and editor_key and editor_model:
        config.editor = LLMConfig(
            api_base=editor_base,
            api_key=editor_key,
            model=editor_model,
            max_tokens=int(os.getenv("EDITOR_MAX_TOKENS", "2048")),
            temperature=float(os.getenv("EDITOR_TEMPERATURE", "0.7")),
            timeout=int(os.getenv("EDITOR_TIMEOUT", "60")),
        )

    # Operator LLM
    operator_base = os.getenv("OPERATOR_API_BASE")
    operator_key = os.getenv("OPERATOR_API_KEY")
    operator_model = os.getenv("OPERATOR_MODEL")

    if operator_base and operator_key and operator_model:
        config.operator = LLMConfig(
            api_base=operator_base,
            api_key=operator_key,
            model=operator_model,
            max_tokens=int(os.getenv("OPERATOR_MAX_TOKENS", "1024")),
            temperature=float(os.getenv("OPERATOR_TEMPERATURE", "0.3")),
            timeout=int(os.getenv("OPERATOR_TIMEOUT", "60")),
        )

    # Evaluation labels
    positive = os.getenv("POSITIVE_LABELS")
    if positive:
        config.positive_labels = [l.strip().lower() for l in positive.split(",") if l.strip()]

    negative = os.getenv("NEGATIVE_LABELS")
    if negative:
        config.negative_labels = [l.strip().lower() for l in negative.split(",") if l.strip()]

    return config


def init_env(path: Path, force: bool = False) -> bool:
    """Initialize a .env file with template.

    Args:
        path: Path to create .env file
        force: If True, overwrite existing file

    Returns:
        True if file was created, False if already exists
    """
    if path.exists() and not force:
        return False

    path.write_text(ENV_TEMPLATE)
    return True


def validate_config(config: Config) -> list[str]:
    """Validate configuration and return list of issues."""
    issues: list[str] = []

    if config.file_mode not in ("git", "versioned"):
        issues.append(f"Invalid FILE_MODE: {config.file_mode} (must be 'git' or 'versioned')")

    if not config.label_suffixes:
        issues.append("LABEL_SUFFIXES is empty")

    if config.editor:
        if not config.editor.api_key or config.editor.api_key == "your-api-key-here":
            issues.append("EDITOR_API_KEY not set")

    if config.operator:
        if not config.operator.api_key or config.operator.api_key == "your-api-key-here":
            issues.append("OPERATOR_API_KEY not set")

    return issues
