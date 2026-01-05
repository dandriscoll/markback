"""Tests for MarkBack CLI."""

import pytest
import json
import tempfile
from pathlib import Path

from typer.testing import CliRunner

from markback.cli import app


runner = CliRunner()
FIXTURES_DIR = Path(__file__).parent / "fixtures"


class TestInitCommand:
    """Tests for the init command."""

    def test_init_creates_env(self):
        """Test that init creates a .env file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            env_path = Path(tmpdir) / ".env"
            result = runner.invoke(app, ["init", str(env_path)])

            assert result.exit_code == 0
            assert env_path.exists()
            content = env_path.read_text()
            assert "FILE_MODE" in content
            assert "EDITOR_API_BASE" in content

    def test_init_no_overwrite(self):
        """Test that init doesn't overwrite existing file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            env_path = Path(tmpdir) / ".env"
            env_path.write_text("existing content")

            result = runner.invoke(app, ["init", str(env_path)])

            assert result.exit_code == 1
            assert env_path.read_text() == "existing content"

    def test_init_force_overwrite(self):
        """Test that init --force overwrites existing file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            env_path = Path(tmpdir) / ".env"
            env_path.write_text("existing content")

            result = runner.invoke(app, ["init", str(env_path), "--force"])

            assert result.exit_code == 0
            assert "FILE_MODE" in env_path.read_text()


class TestLintCommand:
    """Tests for the lint command."""

    def test_lint_valid_file(self):
        """Test linting a valid file."""
        result = runner.invoke(app, ["lint", str(FIXTURES_DIR / "minimal.mb"), "--no-source-check"])

        # May have warnings but should not fail
        assert "Records:" in result.output

    def test_lint_error_file(self):
        """Test linting a file with errors."""
        result = runner.invoke(app, ["lint", str(FIXTURES_DIR / "errors" / "missing_feedback.mb")])

        assert result.exit_code == 1
        assert "E001" in result.output

    def test_lint_json_output(self):
        """Test lint with JSON output."""
        result = runner.invoke(app, [
            "lint",
            str(FIXTURES_DIR / "minimal.mb"),
            "--json",
            "--no-source-check",
        ])

        data = json.loads(result.output)
        assert "summary" in data
        assert "diagnostics" in data

    def test_lint_directory(self):
        """Test linting a directory."""
        result = runner.invoke(app, ["lint", str(FIXTURES_DIR), "--no-source-check"])

        assert "Files:" in result.output


class TestNormalizeCommand:
    """Tests for the normalize command."""

    def test_normalize_to_stdout(self):
        """Test normalize outputs to stdout."""
        result = runner.invoke(app, ["normalize", str(FIXTURES_DIR / "minimal.mb")])

        assert result.exit_code == 0
        assert "<<< positive" in result.output

    def test_normalize_to_file(self):
        """Test normalize writes to output file."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.mb', delete=False) as f:
            output_path = Path(f.name)

        try:
            result = runner.invoke(app, [
                "normalize",
                str(FIXTURES_DIR / "minimal.mb"),
                str(output_path),
            ])

            assert result.exit_code == 0
            assert output_path.exists()
            assert "<<< positive" in output_path.read_text()
        finally:
            output_path.unlink()


class TestListCommand:
    """Tests for the list command."""

    def test_list_file(self):
        """Test listing records in a file."""
        result = runner.invoke(app, ["list", str(FIXTURES_DIR / "multi_record.mb")])

        assert result.exit_code == 0
        assert "Total:" in result.output

    def test_list_json(self):
        """Test list with JSON output."""
        result = runner.invoke(app, ["list", str(FIXTURES_DIR / "minimal.mb"), "--json"])

        assert result.exit_code == 0
        data = json.loads(result.output)
        assert isinstance(data, list)


class TestConvertCommand:
    """Tests for the convert command."""

    def test_convert_to_multi(self):
        """Test converting to multi-record format."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.mb', delete=False) as f:
            output_path = Path(f.name)

        try:
            result = runner.invoke(app, [
                "convert",
                str(FIXTURES_DIR / "minimal.mb"),
                str(output_path),
                "--to", "multi",
            ])

            assert result.exit_code == 0
            assert output_path.exists()
        finally:
            output_path.unlink()

    def test_convert_to_compact(self):
        """Test converting to compact format."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.mb', delete=False) as f:
            output_path = Path(f.name)

        try:
            result = runner.invoke(app, [
                "convert",
                str(FIXTURES_DIR / "label_list.mb"),
                str(output_path),
                "--to", "compact",
            ])

            assert result.exit_code == 0
        finally:
            output_path.unlink()

    def test_convert_to_paired(self):
        """Test converting to paired format."""
        with tempfile.TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir)

            result = runner.invoke(app, [
                "convert",
                str(FIXTURES_DIR / "label_list.mb"),
                str(output_dir),
                "--to", "paired",
            ])

            assert result.exit_code == 0
            label_files = list(output_dir.glob("*.label.txt"))
            assert len(label_files) > 0


class TestWorkflowCommands:
    """Tests for workflow subcommands."""

    def test_workflow_evaluate_missing_file(self):
        """Test evaluate with missing file."""
        result = runner.invoke(app, ["workflow", "evaluate", "nonexistent.json"])

        assert result.exit_code == 1

    def test_workflow_prompt_missing_file(self):
        """Test prompt with missing file."""
        result = runner.invoke(app, ["workflow", "prompt", "nonexistent.json"])

        assert result.exit_code == 1
