"""Tests for MarkBack linter."""

import pytest
from pathlib import Path

from markback import (
    lint_file,
    lint_string,
    lint_files,
    format_diagnostics,
    summarize_results,
    ErrorCode,
    WarningCode,
    Severity,
)


FIXTURES_DIR = Path(__file__).parent / "fixtures"
ERRORS_DIR = FIXTURES_DIR / "errors"


class TestLintString:
    """Tests for lint_string function."""

    def test_valid_minimal(self):
        """Test linting a valid minimal record."""
        text = "Content here.\n<<< positive\n"
        result = lint_string(text, check_sources=False, check_canonical=False)

        assert not result.has_errors

    def test_valid_with_uri(self):
        """Test linting a valid record with URI."""
        text = "@uri local:example\n\nContent.\n<<< good\n"
        result = lint_string(text, check_sources=False, check_canonical=False)

        assert not result.has_errors

    def test_missing_feedback_error(self):
        """Test E001: Missing feedback."""
        text = "@uri local:example\n\nContent without feedback.\n"
        result = lint_string(text)

        assert result.has_errors
        errors = [d for d in result.diagnostics if d.code == ErrorCode.E001]
        assert len(errors) == 1

    def test_empty_feedback_error(self):
        """Test E009: Empty feedback."""
        text = "Content.\n<<<\n"
        result = lint_string(text)

        assert result.has_errors
        errors = [d for d in result.diagnostics if d.code == ErrorCode.E009]
        assert len(errors) == 1

    def test_malformed_uri_error(self):
        """Test E003: Malformed URI."""
        text = "@uri invalid\n\nContent.\n<<< good\n"
        result = lint_string(text, check_sources=False, check_canonical=False)

        assert result.has_errors
        errors = [d for d in result.diagnostics if d.code == ErrorCode.E003]
        assert len(errors) == 1

    def test_invalid_json_error(self):
        """Test E007: Invalid JSON."""
        text = "Content.\n<<< json:{invalid json}\n"
        result = lint_string(text, check_sources=False, check_canonical=False)

        assert result.has_errors
        errors = [d for d in result.diagnostics if d.code == ErrorCode.E007]
        assert len(errors) == 1

    def test_valid_json(self):
        """Test valid JSON feedback."""
        text = 'Content.\n<<< json:{"key":"value"}\n'
        result = lint_string(text, check_sources=False, check_canonical=False)

        json_errors = [d for d in result.diagnostics if d.code == ErrorCode.E007]
        assert len(json_errors) == 0

    def test_unclosed_quote_error(self):
        """Test E008: Unclosed quote."""
        text = 'Content.\n<<< note="unclosed\n'
        result = lint_string(text, check_sources=False, check_canonical=False)

        assert result.has_errors
        errors = [d for d in result.diagnostics if d.code == ErrorCode.E008]
        assert len(errors) == 1

    def test_duplicate_uri_warning(self):
        """Test W001: Duplicate URI."""
        text = """@uri local:same

Content 1.
<<< good

---
@uri local:same

Content 2.
<<< bad
"""
        result = lint_string(text, check_sources=False, check_canonical=False)

        warnings = [d for d in result.diagnostics if d.code == WarningCode.W001]
        assert len(warnings) == 1

    def test_missing_uri_warning(self):
        """Test W006: Missing URI."""
        text = "Content without URI.\n<<< good\n"
        result = lint_string(text, check_sources=False, check_canonical=False)

        warnings = [d for d in result.diagnostics if d.code == WarningCode.W006]
        assert len(warnings) == 1

    def test_unknown_header_warning(self):
        """Test W002: Unknown header."""
        text = "@uri local:example\n@custom value\n\nContent.\n<<< good\n"
        result = lint_string(text, check_sources=False, check_canonical=False)

        warnings = [d for d in result.diagnostics if d.code == WarningCode.W002]
        assert len(warnings) == 1


class TestLintFile:
    """Tests for lint_file function."""

    def test_lint_minimal(self):
        """Test linting minimal.mb fixture."""
        result = lint_file(FIXTURES_DIR / "minimal.mb", check_sources=False)

        # Should have W006 (missing URI) but no errors
        assert not result.has_errors

    def test_lint_with_uri(self):
        """Test linting with_uri.mb fixture."""
        result = lint_file(FIXTURES_DIR / "with_uri.mb", check_sources=False)

        assert not result.has_errors

    def test_lint_multi_record(self):
        """Test linting multi_record.mb fixture."""
        result = lint_file(FIXTURES_DIR / "multi_record.mb", check_sources=False)

        assert not result.has_errors

    def test_lint_missing_feedback_error(self):
        """Test linting file with missing feedback."""
        result = lint_file(ERRORS_DIR / "missing_feedback.mb")

        assert result.has_errors
        errors = [d for d in result.diagnostics if d.code == ErrorCode.E001]
        assert len(errors) == 1

    def test_lint_empty_feedback_error(self):
        """Test linting file with empty feedback."""
        result = lint_file(ERRORS_DIR / "empty_feedback.mb")

        assert result.has_errors
        errors = [d for d in result.diagnostics if d.code == ErrorCode.E009]
        assert len(errors) == 1

    def test_lint_malformed_uri_error(self):
        """Test linting file with malformed URI."""
        result = lint_file(ERRORS_DIR / "malformed_uri.mb", check_sources=False)

        assert result.has_errors
        errors = [d for d in result.diagnostics if d.code == ErrorCode.E003]
        assert len(errors) == 1


class TestLintFiles:
    """Tests for lint_files function."""

    def test_lint_directory(self):
        """Test linting a directory of files."""
        results = lint_files([FIXTURES_DIR], check_sources=False)

        assert len(results) > 0

    def test_lint_multiple_files(self):
        """Test linting multiple specific files."""
        files = [
            FIXTURES_DIR / "minimal.mb",
            FIXTURES_DIR / "with_uri.mb",
        ]
        results = lint_files(files, check_sources=False)

        assert len(results) == 2


class TestFormatDiagnostics:
    """Tests for format_diagnostics function."""

    def test_human_format(self):
        """Test human-readable format."""
        text = "@uri invalid\n\nContent.\n<<< good\n"
        result = lint_string(text, check_sources=False, check_canonical=False)

        output = format_diagnostics(result.diagnostics, format="human")
        assert "E003" in output

    def test_json_format(self):
        """Test JSON format."""
        import json

        text = "@uri invalid\n\nContent.\n<<< good\n"
        result = lint_string(text, check_sources=False, check_canonical=False)

        output = format_diagnostics(result.diagnostics, format="json")
        data = json.loads(output)
        assert isinstance(data, list)


class TestSummarizeResults:
    """Tests for summarize_results function."""

    def test_summary(self):
        """Test result summarization."""
        results = lint_files([FIXTURES_DIR / "minimal.mb"], check_sources=False)
        summary = summarize_results(results)

        assert "files" in summary
        assert "records" in summary
        assert "errors" in summary
        assert "warnings" in summary
