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

# Default reviewer identity (used with --by when not specified)
# DEFAULT_BY=reviewer@example.com
'''


@dataclass
class Config:
    """MarkBack configuration."""
    file_mode: str = "git"
    default_by: Optional[str] = None


def load_config(env_path: Optional[Path] = None) -> Config:
    """Load configuration from .env file."""
    if env_path:
        load_dotenv(env_path)
    else:
        load_dotenv()

    config = Config()

    file_mode = os.getenv("FILE_MODE", "git")
    if file_mode in ("git", "versioned"):
        config.file_mode = file_mode

    config.default_by = os.getenv("DEFAULT_BY")

    return config


def init_env(path: Path, force: bool = False) -> bool:
    """Initialize a .env file with template."""
    if path.exists() and not force:
        return False

    path.write_text(ENV_TEMPLATE)
    return True


def validate_config(config: Config) -> list[str]:
    """Validate configuration and return list of issues."""
    issues: list[str] = []

    if config.file_mode not in ("git", "versioned"):
        issues.append(f"Invalid FILE_MODE: {config.file_mode} (must be 'git' or 'versioned')")

    return issues
