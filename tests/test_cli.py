"""Tests for MarkBack V2 CLI."""

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
        with tempfile.TemporaryDirectory() as tmpdir:
            target = Path(tmpdir) / "test.txt"
            target.write_text("hello world")

            result = runner.invoke(app, [str(target), "good; clear writing"])

            assert result.exit_code == 0
            mb_path = target.with_suffix(".txt.mb")
            assert mb_path.exists()
            content = mb_path.read_text()
            assert "good; clear writing" in content
            assert "hello world" in content

    def test_single_file_with_input(self):
        """Test --input option (replaces V1 --prior)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            target = Path(tmpdir) / "output.txt"
            target.write_text("generated output")
            input_file = Path(tmpdir) / "prompt.txt"
            input_file.write_text("the prompt")

            result = runner.invoke(app, [str(target), "accurate", "--input", str(input_file)])

            assert result.exit_code == 0
            mb_path = target.with_suffix(".txt.mb")
            assert mb_path.exists()
            content = mb_path.read_text()
            assert "accurate" in content
            assert "@input" in content

    def test_single_file_with_tag(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            target = Path(tmpdir) / "test.txt"
            target.write_text("hello")

            result = runner.invoke(app, [str(target), "good", "--tag", "review p1"])

            assert result.exit_code == 0
            mb_path = target.with_suffix(".txt.mb")
            content = mb_path.read_text()
            assert "@tag review p1" in content

    def test_single_file_with_by(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            target = Path(tmpdir) / "test.txt"
            target.write_text("hello")

            result = runner.invoke(app, [str(target), "good", "--by", "alice@example.com"])

            assert result.exit_code == 0
            mb_path = target.with_suffix(".txt.mb")
            content = mb_path.read_text()
            assert "@by alice@example.com" in content

    def test_single_file_appends(self):
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

    def test_glob_with_scope_and_covers(self):
        """Test sweep pattern via CLI."""
        with tempfile.TemporaryDirectory() as tmpdir:
            for name in ["a.txt", "b.txt"]:
                (Path(tmpdir) / name).write_text(f"content of {name}")

            pattern = str(Path(tmpdir) / "*.txt")
            result = runner.invoke(app, [
                pattern, "-f", "issue-A",
                "--scope", "issue-A issue-B",
                "--covers", "./*.txt",
            ])

            assert result.exit_code == 0
            fb_path = Path(tmpdir) / "feedback.mb"
            content = fb_path.read_text()
            assert "%scope issue-A issue-B" in content
            assert "%covers ./*.txt" in content

    def test_glob_no_matches(self):
        result = runner.invoke(app, ["/nonexistent/path/*.xyz", "-f", "feedback"])
        assert result.exit_code == 1


class TestUrlTarget:
    """Tests for URL targets."""

    def test_url_with_path_segment(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with runner.isolated_filesystem(temp_dir=tmpdir):
                result = runner.invoke(
                    app,
                    ["https://example.com/blog/post.html", "great explanation"],
                )
                assert result.exit_code == 0
                mb_path = Path("post.html.mb")
                assert mb_path.exists()
                content = mb_path.read_text()
                assert "@file https://example.com/blog/post.html" in content
                assert "great explanation" in content

    def test_url_bare_hostname(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with runner.isolated_filesystem(temp_dir=tmpdir):
                result = runner.invoke(app, ["https://example.com", "ok"])
                assert result.exit_code == 0
                assert Path("example.com.mb").exists()

    def test_url_trailing_slash_uses_last_segment(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with runner.isolated_filesystem(temp_dir=tmpdir):
                result = runner.invoke(app, ["https://example.com/blog/", "ok"])
                assert result.exit_code == 0
                assert Path("blog.mb").exists()

    def test_url_with_query_string(self):
        """Query strings shouldn't be treated as glob patterns."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with runner.isolated_filesystem(temp_dir=tmpdir):
                result = runner.invoke(
                    app, ["https://example.com/page?id=1", "ok"]
                )
                assert result.exit_code == 0
                assert Path("page.mb").exists()

    def test_file_uri(self):
        """file:// URIs should be treated as URIs, not local file lookups."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with runner.isolated_filesystem(temp_dir=tmpdir):
                result = runner.invoke(
                    app, ["file://c:/some/bar.txt", "noted"]
                )
                assert result.exit_code == 0
                mb_path = Path("bar.txt.mb")
                assert mb_path.exists()
                content = mb_path.read_text()
                assert "@file file://c:/some/bar.txt" in content

    def test_windows_drive_path_is_not_uri(self):
        """c:/foo isn't a URI — should fail with 'not found' as a real path."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with runner.isolated_filesystem(temp_dir=tmpdir):
                result = runner.invoke(app, ["c:/no/such/file.txt"])
                assert result.exit_code == 1

    def test_url_appends_to_existing_mb(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with runner.isolated_filesystem(temp_dir=tmpdir):
                runner.invoke(app, ["https://example.com/post.html", "first"])
                runner.invoke(app, ["https://example.com/post.html", "second"])
                content = Path("post.html.mb").read_text()
                assert "first" in content
                assert "second" in content


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


class TestStats:
    """Tests for --stats."""

    def test_stats_basic(self):
        result = runner.invoke(app, ["--stats", str(FIXTURES_DIR / "multi_record.mb")])
        assert result.exit_code == 0
        assert "Records:" in result.output

    def test_stats_json(self):
        result = runner.invoke(app, ["--stats", "--json", str(FIXTURES_DIR / "multi_record.mb")])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert "records" in data
