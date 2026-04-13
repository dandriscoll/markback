"""Tests for MarkBack V2 configuration."""

import pytest
import tempfile
from pathlib import Path
import os

from markback import Config, load_config, init_env
from markback.config import validate_config, ENV_TEMPLATE


class TestInitEnv:
    """Tests for init_env function."""

    def test_creates_env_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / ".env"
            result = init_env(path)
            assert result is True
            assert path.exists()

    def test_env_file_content(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / ".env"
            init_env(path)
            content = path.read_text()
            assert "FILE_MODE" in content
            # V2: no LLM config
            assert "EDITOR_API" not in content

    def test_no_overwrite_without_force(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / ".env"
            path.write_text("original")
            result = init_env(path, force=False)
            assert result is False
            assert path.read_text() == "original"

    def test_overwrite_with_force(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / ".env"
            path.write_text("original")
            result = init_env(path, force=True)
            assert result is True
            assert "FILE_MODE" in path.read_text()


class TestLoadConfig:
    """Tests for load_config function."""

    def test_default_config(self):
        config = load_config()
        assert config.file_mode == "git"

    def test_load_from_env_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            env_path = Path(tmpdir) / ".env"
            env_path.write_text("FILE_MODE=versioned\nDEFAULT_BY=alice@example.com\n")
            original_cwd = os.getcwd()
            try:
                os.chdir(tmpdir)
                config = load_config(env_path)
                assert config.file_mode == "versioned"
                assert config.default_by == "alice@example.com"
            finally:
                os.chdir(original_cwd)


class TestValidateConfig:
    """Tests for validate_config function."""

    def test_valid_config(self):
        config = Config(file_mode="git")
        issues = validate_config(config)
        assert not any("FILE_MODE" in issue for issue in issues)

    def test_invalid_file_mode(self):
        config = Config(file_mode="invalid")
        issues = validate_config(config)
        assert any("FILE_MODE" in issue for issue in issues)


class TestConfig:
    """Tests for Config dataclass."""

    def test_default_values(self):
        config = Config()
        assert config.file_mode == "git"
        assert config.default_by is None

    def test_custom_values(self):
        config = Config(file_mode="versioned", default_by="dan@example.com")
        assert config.file_mode == "versioned"
        assert config.default_by == "dan@example.com"
