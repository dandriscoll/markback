"""Tests for MarkBack configuration."""

import pytest
import tempfile
from pathlib import Path
import os

from markback import Config, LLMConfig, load_config, init_env
from markback.config import validate_config, ENV_TEMPLATE


class TestInitEnv:
    """Tests for init_env function."""

    def test_creates_env_file(self):
        """Test that init_env creates a .env file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / ".env"
            result = init_env(path)

            assert result is True
            assert path.exists()

    def test_env_file_content(self):
        """Test that .env file has expected content."""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / ".env"
            init_env(path)

            content = path.read_text()
            assert "FILE_MODE" in content
            assert "LABEL_SUFFIXES" in content
            assert "EDITOR_API_BASE" in content
            assert "OPERATOR_API_BASE" in content

    def test_no_overwrite_without_force(self):
        """Test that existing file is not overwritten."""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / ".env"
            path.write_text("original")

            result = init_env(path, force=False)

            assert result is False
            assert path.read_text() == "original"

    def test_overwrite_with_force(self):
        """Test that force overwrites existing file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / ".env"
            path.write_text("original")

            result = init_env(path, force=True)

            assert result is True
            assert "FILE_MODE" in path.read_text()


class TestLoadConfig:
    """Tests for load_config function."""

    def test_default_config(self):
        """Test loading with no .env file."""
        config = load_config()

        assert config.file_mode == "git"
        assert ".label.txt" in config.label_suffixes

    def test_load_from_env_file(self):
        """Test loading from a .env file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            env_path = Path(tmpdir) / ".env"
            env_path.write_text("""
FILE_MODE=versioned
LABEL_SUFFIXES=.lbl,.feedback
POSITIVE_LABELS=good,ok,yes
NEGATIVE_LABELS=bad,no
""")
            # Change to the temp directory
            original_cwd = os.getcwd()
            try:
                os.chdir(tmpdir)
                config = load_config(env_path)

                assert config.file_mode == "versioned"
                assert ".lbl" in config.label_suffixes
                assert "good" in config.positive_labels
            finally:
                os.chdir(original_cwd)

    def test_load_llm_config(self):
        """Test loading LLM configuration."""
        with tempfile.TemporaryDirectory() as tmpdir:
            env_path = Path(tmpdir) / ".env"
            env_path.write_text("""
EDITOR_API_BASE=https://api.example.com
EDITOR_API_KEY=test-key
EDITOR_MODEL=gpt-4
EDITOR_MAX_TOKENS=1000
EDITOR_TEMPERATURE=0.5

OPERATOR_API_BASE=https://api.example.com
OPERATOR_API_KEY=test-key-2
OPERATOR_MODEL=gpt-3.5-turbo
""")
            config = load_config(env_path)

            assert config.editor is not None
            assert config.editor.api_base == "https://api.example.com"
            assert config.editor.api_key == "test-key"
            assert config.editor.model == "gpt-4"
            assert config.editor.max_tokens == 1000
            assert config.editor.temperature == 0.5

            assert config.operator is not None
            assert config.operator.model == "gpt-3.5-turbo"


class TestValidateConfig:
    """Tests for validate_config function."""

    def test_valid_config(self):
        """Test validation of a valid config."""
        config = Config(
            file_mode="git",
            label_suffixes=[".label.txt"],
            editor=LLMConfig(
                api_base="https://api.example.com",
                api_key="valid-key",
                model="gpt-4",
            ),
        )

        issues = validate_config(config)
        # Should have no issues except maybe operator not configured
        assert not any("FILE_MODE" in issue for issue in issues)

    def test_invalid_file_mode(self):
        """Test validation catches invalid file mode."""
        config = Config(file_mode="invalid")

        issues = validate_config(config)
        assert any("FILE_MODE" in issue for issue in issues)

    def test_empty_label_suffixes(self):
        """Test validation catches empty label suffixes."""
        config = Config(label_suffixes=[])

        issues = validate_config(config)
        assert any("LABEL_SUFFIXES" in issue for issue in issues)

    def test_placeholder_api_key(self):
        """Test validation catches placeholder API key."""
        config = Config(
            editor=LLMConfig(
                api_base="https://api.example.com",
                api_key="your-api-key-here",
                model="gpt-4",
            ),
        )

        issues = validate_config(config)
        assert any("API_KEY" in issue for issue in issues)


class TestConfig:
    """Tests for Config dataclass."""

    def test_default_values(self):
        """Test default configuration values."""
        config = Config()

        assert config.file_mode == "git"
        assert len(config.label_suffixes) > 0
        assert "positive" in config.positive_labels
        assert "negative" in config.negative_labels

    def test_custom_values(self):
        """Test custom configuration values."""
        config = Config(
            file_mode="versioned",
            label_suffixes=[".lbl"],
            positive_labels=["yes"],
            negative_labels=["no"],
        )

        assert config.file_mode == "versioned"
        assert config.label_suffixes == [".lbl"]
        assert config.positive_labels == ["yes"]
        assert config.negative_labels == ["no"]


class TestLLMConfig:
    """Tests for LLMConfig dataclass."""

    def test_required_fields(self):
        """Test that required fields must be provided."""
        config = LLMConfig(
            api_base="https://api.example.com",
            api_key="key",
            model="model",
        )

        assert config.api_base == "https://api.example.com"
        assert config.api_key == "key"
        assert config.model == "model"

    def test_default_optional_fields(self):
        """Test default values for optional fields."""
        config = LLMConfig(
            api_base="https://api.example.com",
            api_key="key",
            model="model",
        )

        assert config.max_tokens == 1024
        assert config.temperature == 0.7
        assert config.timeout == 60

    def test_custom_optional_fields(self):
        """Test custom values for optional fields."""
        config = LLMConfig(
            api_base="https://api.example.com",
            api_key="key",
            model="model",
            max_tokens=2000,
            temperature=0.5,
            timeout=120,
        )

        assert config.max_tokens == 2000
        assert config.temperature == 0.5
        assert config.timeout == 120
