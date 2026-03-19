"""Tests for MarkBack CLI."""

import pytest
import json
import tempfile
from pathlib import Path

from typer.testing import CliRunner

from markback.cli import app


runner = CliRunner()
FIXTURES_DIR = Path(__file__).parent / "fixtures"


class TestAnnotation:
    """Tests for the default annotation mode."""

    def test_single_file_with_feedback(self):
        """Test adding feedback to a single file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            target = Path(tmpdir) / "test.txt"
            target.write_text("hello world")

            result = runner.invoke(app, [str(target), "good; clear writing"])

            assert result.exit_code == 0
            mb_path = target.with_suffix(".txt.mb")
            assert mb_path.exists()
            content = mb_path.read_text()
            assert "good; clear writing" in content
            assert "hello world" in content  # inline content included

    def test_single_file_with_prior(self):
        """Test adding feedback with --prior option."""
        with tempfile.TemporaryDirectory() as tmpdir:
            target = Path(tmpdir) / "output.txt"
            target.write_text("generated output")
            prior = Path(tmpdir) / "prompt.txt"
            prior.write_text("the prompt")

            result = runner.invoke(app, [str(target), "accurate", "--prior", str(prior)])

            assert result.exit_code == 0
            mb_path = target.with_suffix(".txt.mb")
            assert mb_path.exists()
            content = mb_path.read_text()
            assert "accurate" in content
            assert "@prior" in content

    def test_single_file_appends(self):
        """Test that feedback is appended to existing .mb file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            target = Path(tmpdir) / "test.txt"
            target.write_text("hello")

            runner.invoke(app, [str(target), "good"])
            result = runner.invoke(app, [str(target), "great"])

            assert result.exit_code == 0
            mb_path = target.with_suffix(".txt.mb")
            content = mb_path.read_text()
            assert "good" in content
            assert "great" in content

    def test_glob_with_feedback(self):
        """Test glob pattern with inline feedback."""
        with tempfile.TemporaryDirectory() as tmpdir:
            for name in ["a.txt", "b.txt", "c.txt"]:
                (Path(tmpdir) / name).write_text(f"content of {name}")

            pattern = str(Path(tmpdir) / "*.txt")
            result = runner.invoke(app, [pattern, "-f", "approved"])

            assert result.exit_code == 0
            fb_path = Path(tmpdir) / "feedback.mb"
            assert fb_path.exists()
            content = fb_path.read_text()
            assert "approved" in content

    def test_multi_files_with_feedback(self):
        """Test shell-expanded multiple files with feedback."""
        with tempfile.TemporaryDirectory() as tmpdir:
            files = []
            for name in ["a.txt", "b.txt", "c.txt"]:
                p = Path(tmpdir) / name
                p.write_text(f"content of {name}")
                files.append(str(p))

            result = runner.invoke(app, files + ["-f", "approved"])

            assert result.exit_code == 0
            fb_path = Path(tmpdir) / "feedback.mb"
            assert fb_path.exists()
            content = fb_path.read_text()
            assert "approved" in content

    def test_multi_files_with_prior(self):
        """Test shell-expanded files with --prior."""
        with tempfile.TemporaryDirectory() as tmpdir:
            prior = Path(tmpdir) / "prompt.txt"
            prior.write_text("the prompt")
            files = []
            for name in ["a.txt", "b.txt"]:
                p = Path(tmpdir) / name
                p.write_text(f"content of {name}")
                files.append(str(p))

            result = runner.invoke(app, ["--prior", str(prior)] + files + ["-f", "good"])

            assert result.exit_code == 0
            fb_path = Path(tmpdir) / "feedback.mb"
            assert fb_path.exists()
            content = fb_path.read_text()
            assert "good" in content
            assert "@prior" in content

    def test_glob_interactive_mode(self):
        """Test glob interactive mode with mocked stdin."""
        with tempfile.TemporaryDirectory() as tmpdir:
            (Path(tmpdir) / "a.txt").write_text("file a")
            (Path(tmpdir) / "b.txt").write_text("file b")

            pattern = str(Path(tmpdir) / "*.txt")
            result = runner.invoke(app, [pattern], input="good\n\n")

            assert result.exit_code == 0
            fb_path = Path(tmpdir) / "feedback.mb"
            assert fb_path.exists()
            content = fb_path.read_text()
            assert "good" in content

    def test_glob_no_matches(self):
        """Test glob with no matches."""
        result = runner.invoke(app, ["/nonexistent/path/*.xyz", "-f", "feedback"])
        assert result.exit_code == 1


class TestInit:
    """Tests for --init."""

    def test_init_creates_env(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            env_path = Path(tmpdir) / ".env"
            result = runner.invoke(app, ["--init", str(env_path)])

            assert result.exit_code == 0
            assert env_path.exists()
            content = env_path.read_text()
            assert "FILE_MODE" in content
            assert "EDITOR_API_BASE" in content

    def test_init_no_overwrite(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            env_path = Path(tmpdir) / ".env"
            env_path.write_text("existing content")

            result = runner.invoke(app, ["--init", str(env_path)])

            assert result.exit_code == 1
            assert env_path.read_text() == "existing content"

    def test_init_force_overwrite(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            env_path = Path(tmpdir) / ".env"
            env_path.write_text("existing content")

            result = runner.invoke(app, ["--init", "--force", str(env_path)])

            assert result.exit_code == 0
            assert "FILE_MODE" in env_path.read_text()


class TestLint:
    """Tests for --lint."""

    def test_lint_valid_file(self):
        result = runner.invoke(app, ["--lint", "--no-source-check", str(FIXTURES_DIR / "minimal.mb")])
        assert "Records:" in result.output

    def test_lint_error_file(self):
        result = runner.invoke(app, ["--lint", str(FIXTURES_DIR / "errors" / "missing_feedback.mb")])
        assert result.exit_code == 1
        assert "E001" in result.output

    def test_lint_json_output(self):
        result = runner.invoke(app, [
            "--lint", "--json", "--no-source-check",
            str(FIXTURES_DIR / "minimal.mb"),
        ])
        data = json.loads(result.output)
        assert "summary" in data
        assert "diagnostics" in data

    def test_lint_directory(self):
        result = runner.invoke(app, ["--lint", "--no-source-check", str(FIXTURES_DIR)])
        assert "Files:" in result.output


class TestNormalize:
    """Tests for --normalize."""

    def test_normalize_to_stdout(self):
        result = runner.invoke(app, ["--normalize", str(FIXTURES_DIR / "minimal.mb")])
        assert result.exit_code == 0
        assert "<<< positive" in result.output

    def test_normalize_to_file(self):
        with tempfile.NamedTemporaryFile(mode='w', suffix='.mb', delete=False) as f:
            output_path = Path(f.name)

        try:
            result = runner.invoke(app, [
                "--normalize", "-o", str(output_path),
                str(FIXTURES_DIR / "minimal.mb"),
            ])
            assert result.exit_code == 0
            assert output_path.exists()
            assert "<<< positive" in output_path.read_text()
        finally:
            output_path.unlink()


class TestList:
    """Tests for --list."""

    def test_list_file(self):
        result = runner.invoke(app, ["--list", str(FIXTURES_DIR / "multi_record.mb")])
        assert result.exit_code == 0
        assert "Total:" in result.output

    def test_list_json(self):
        result = runner.invoke(app, ["--list", "--json", str(FIXTURES_DIR / "minimal.mb")])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert isinstance(data, list)


class TestConvert:
    """Tests for --convert."""

    def test_convert_to_multi(self):
        with tempfile.NamedTemporaryFile(mode='w', suffix='.mb', delete=False) as f:
            output_path = Path(f.name)

        try:
            result = runner.invoke(app, [
                "--convert", "--to", "multi", "-o", str(output_path),
                str(FIXTURES_DIR / "minimal.mb"),
            ])
            assert result.exit_code == 0
            assert output_path.exists()
        finally:
            output_path.unlink()

    def test_convert_to_compact(self):
        with tempfile.NamedTemporaryFile(mode='w', suffix='.mb', delete=False) as f:
            output_path = Path(f.name)

        try:
            result = runner.invoke(app, [
                "--convert", "--to", "compact", "-o", str(output_path),
                str(FIXTURES_DIR / "label_list.mb"),
            ])
            assert result.exit_code == 0
        finally:
            output_path.unlink()

    def test_convert_to_paired(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir)

            result = runner.invoke(app, [
                "--convert", "--to", "paired", "-o", str(output_dir),
                str(FIXTURES_DIR / "label_list.mb"),
            ])

            assert result.exit_code == 0
            label_files = list(output_dir.glob("*.label.txt"))
            assert len(label_files) > 0
