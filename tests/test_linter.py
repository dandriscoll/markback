"""Tests for MarkBack V2 linter."""

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
        text = "Content here.\n<<< positive\n"
        result = lint_string(text, check_sources=False, check_canonical=False)
        assert not result.has_errors

    def test_valid_with_id(self):
        text = "@id example\n\nContent.\n<<< good\n"
        result = lint_string(text, check_sources=False, check_canonical=False)
        assert not result.has_errors

    def test_missing_feedback_error(self):
        text = "@id example\n\nContent without feedback.\n"
        result = lint_string(text)
        assert result.has_errors
        errors = [d for d in result.diagnostics if d.code == ErrorCode.E001]
        assert len(errors) == 1

    def test_empty_feedback_error(self):
        text = "Content.\n<<<\n"
        result = lint_string(text)
        assert result.has_errors
        errors = [d for d in result.diagnostics if d.code == ErrorCode.E009]
        assert len(errors) == 1

    def test_no_malformed_id_error_for_plain_strings(self):
        """V2: @id is a plain string, no E003."""
        text = "@id just-a-name\n\nContent.\n<<< good\n"
        result = lint_string(text, check_sources=False, check_canonical=False)
        errors = [d for d in result.diagnostics if d.code == ErrorCode.E003]
        assert len(errors) == 0

    def test_invalid_json_error(self):
        text = "Content.\n<<< json:{invalid json}\n"
        result = lint_string(text, check_sources=False, check_canonical=False)
        assert result.has_errors
        errors = [d for d in result.diagnostics if d.code == ErrorCode.E007]
        assert len(errors) == 1

    def test_valid_json(self):
        text = 'Content.\n<<< json:{"key":"value"}\n'
        result = lint_string(text, check_sources=False, check_canonical=False)
        json_errors = [d for d in result.diagnostics if d.code == ErrorCode.E007]
        assert len(json_errors) == 0

    def test_unclosed_quote_error(self):
        text = 'Content.\n<<< note="unclosed\n'
        result = lint_string(text, check_sources=False, check_canonical=False)
        assert result.has_errors
        errors = [d for d in result.diagnostics if d.code == ErrorCode.E008]
        assert len(errors) == 1

    def test_duplicate_id_warning(self):
        text = "@id same\n\nContent 1.\n<<< good\n\n---\n@id same\n\nContent 2.\n<<< bad\n"
        result = lint_string(text, check_sources=False, check_canonical=False)
        warnings = [d for d in result.diagnostics if d.code == WarningCode.W001]
        assert len(warnings) == 1

    def test_missing_id_warning(self):
        text = "Content without ID.\n<<< good\n"
        result = lint_string(text, check_sources=False, check_canonical=False)
        warnings = [d for d in result.diagnostics if d.code == WarningCode.W006]
        assert len(warnings) == 1

    def test_unknown_header_warning(self):
        text = "@id example\n@custom value\n\nContent.\n<<< good\n"
        result = lint_string(text, check_sources=False, check_canonical=False)
        warnings = [d for d in result.diagnostics if d.code == WarningCode.W002]
        assert len(warnings) == 1

    def test_input_file_not_found_warning(self):
        text = "@id example\n@input ./nonexistent_input.txt\n@file ./nonexistent.txt\n<<< good\n"
        result = lint_string(text, check_sources=True, check_canonical=False)
        w009 = [d for d in result.diagnostics if d.code == WarningCode.W009]
        assert len(w009) == 1
        assert "@input not found" in w009[0].message

    def test_input_uri_not_checked(self):
        text = "@id example\n@input https://example.com/input.txt\n\nContent.\n<<< good\n"
        result = lint_string(text, check_sources=True, check_canonical=False)
        w009 = [d for d in result.diagnostics if d.code == WarningCode.W009]
        assert len(w009) == 0

    def test_file_and_content_no_error(self):
        """V2: @file + inline content is valid."""
        text = "@id item\n@file ./doc.txt\n\nSnapshot.\n<<< good\n"
        result = lint_string(text, check_sources=False, check_canonical=False)
        e005 = [d for d in result.diagnostics if d.code == ErrorCode.E005]
        assert len(e005) == 0


class TestLintFile:
    """Tests for lint_file function."""

    def test_lint_minimal(self):
        result = lint_file(FIXTURES_DIR / "minimal.mb", check_sources=False)
        assert not result.has_errors

    def test_lint_with_id(self):
        result = lint_file(FIXTURES_DIR / "with_uri.mb", check_sources=False)
        assert not result.has_errors

    def test_lint_multi_record(self):
        result = lint_file(FIXTURES_DIR / "multi_record.mb", check_sources=False)
        assert not result.has_errors

    def test_lint_missing_feedback_error(self):
        result = lint_file(ERRORS_DIR / "missing_feedback.mb")
        assert result.has_errors
        errors = [d for d in result.diagnostics if d.code == ErrorCode.E001]
        assert len(errors) == 1

    def test_lint_empty_feedback_error(self):
        result = lint_file(ERRORS_DIR / "empty_feedback.mb")
        assert result.has_errors
        errors = [d for d in result.diagnostics if d.code == ErrorCode.E009]
        assert len(errors) == 1

    def test_lint_id_plain_string_valid(self):
        """V2: plain string @id is valid, no E003."""
        result = lint_file(ERRORS_DIR / "malformed_uri.mb", check_sources=False)
        errors = [d for d in result.diagnostics if d.code == ErrorCode.E003]
        assert len(errors) == 0


class TestLintFiles:
    """Tests for lint_files function."""

    def test_lint_directory(self):
        results = lint_files([FIXTURES_DIR], check_sources=False)
        assert len(results) > 0

    def test_lint_multiple_files(self):
        files = [
            FIXTURES_DIR / "minimal.mb",
            FIXTURES_DIR / "with_uri.mb",
        ]
        results = lint_files(files, check_sources=False)
        assert len(results) == 2


class TestFormatDiagnostics:
    """Tests for format_diagnostics function."""

    def test_human_format(self):
        text = "@id example\n@unknown val\n\nContent.\n<<< good\n"
        result = lint_string(text, check_sources=False, check_canonical=False)
        output = format_diagnostics(result.diagnostics, format="human")
        assert "W002" in output

    def test_json_format(self):
        import json
        text = "@id example\n@unknown val\n\nContent.\n<<< good\n"
        result = lint_string(text, check_sources=False, check_canonical=False)
        output = format_diagnostics(result.diagnostics, format="json")
        data = json.loads(output)
        assert isinstance(data, list)


class TestSummarizeResults:
    """Tests for summarize_results function."""

    def test_summary(self):
        results = lint_files([FIXTURES_DIR / "minimal.mb"], check_sources=False)
        summary = summarize_results(results)
        assert "files" in summary
        assert "records" in summary
        assert "errors" in summary
        assert "warnings" in summary


class TestLineRangeSupport:
    """Tests for line range support in @file and @input."""

    def test_file_with_single_line(self):
        text = "@file ./code.py:42 <<< good\n"
        result = lint_string(text, check_sources=False, check_canonical=False)
        assert not result.has_errors
        assert result.records[0].file.path == "./code.py"
        assert result.records[0].file.start_line == 42

    def test_file_with_line_range(self):
        text = "@file ./code.py:10-20 <<< good\n"
        result = lint_string(text, check_sources=False, check_canonical=False)
        assert not result.has_errors
        assert result.records[0].file.start_line == 10
        assert result.records[0].file.end_line == 20

    def test_input_with_line_range(self):
        text = "@input ./prompts/template.txt:1-20\n@file ./output.txt\n<<< good\n"
        result = lint_string(text, check_sources=False, check_canonical=False)
        assert not result.has_errors
        assert result.records[0].input.path == "./prompts/template.txt"
        assert result.records[0].input.start_line == 1
        assert result.records[0].input.end_line == 20

    def test_invalid_line_range(self):
        text = "@file ./code.py:50-10 <<< good\n"
        result = lint_string(text, check_sources=False, check_canonical=False)
        assert result.has_errors
        errors = [d for d in result.diagnostics if d.code == ErrorCode.E011]
        assert len(errors) == 1

    def test_file_with_character_range(self):
        text = "@file ./code.py:10:5-15:20 <<< good\n"
        result = lint_string(text, check_sources=False, check_canonical=False)
        assert not result.has_errors
        assert result.records[0].file.start_line == 10
        assert result.records[0].file.start_column == 5
        assert result.records[0].file.end_line == 15
        assert result.records[0].file.end_column == 20

    def test_invalid_character_range(self):
        text = "@file ./code.py:42:25-42:10 <<< good\n"
        result = lint_string(text, check_sources=False, check_canonical=False)
        assert result.has_errors
        errors = [d for d in result.diagnostics if d.code == ErrorCode.E011]
        assert len(errors) == 1


class TestByHeader:
    """Tests for @by header support."""

    def test_by_header_basic(self):
        text = "@id example\n@by dan@example.com\n\nContent.\n<<< good\n"
        result = lint_string(text, check_sources=False, check_canonical=False)
        assert not result.has_errors
        assert result.records[0].by == "dan@example.com"

    def test_by_header_with_spaces(self):
        text = "@id example\n@by Dan Driscoll\n\nContent.\n<<< good\n"
        result = lint_string(text, check_sources=False, check_canonical=False)
        assert not result.has_errors
        assert result.records[0].by == "Dan Driscoll"

    def test_by_header_compact_record(self):
        text = "@id item-001\n@by reviewer@example.com\n@file ./file.txt <<< feedback\n"
        result = lint_string(text, check_sources=False, check_canonical=False)
        assert not result.has_errors
        assert result.records[0].by == "reviewer@example.com"


class TestReplyToLint:
    """Tests for @reply-to lint rules (W011)."""

    def test_valid_reply(self):
        text = (
            "@id c1\n@file ./a.txt <<< initial\n"
            "@id c2\n@reply-to c1\n@file ./a.txt <<< a reply\n"
        )
        result = lint_string(text, check_sources=False, check_canonical=False)
        w011 = [d for d in result.diagnostics if d.code == WarningCode.W011]
        assert not w011

    def test_orphan_reply_to_warns(self):
        text = "@id c1\n@reply-to ghost\n@file ./a.txt <<< oops\n"
        result = lint_string(text, check_sources=False, check_canonical=False)
        w011 = [d for d in result.diagnostics if d.code == WarningCode.W011]
        assert len(w011) == 1
        assert "ghost" in w011[0].message

    def test_cycle_detected(self):
        text = (
            "@id a\n@reply-to b\n@file ./x.txt <<< one\n"
            "@id b\n@reply-to a\n@file ./x.txt <<< two\n"
        )
        result = lint_string(text, check_sources=False, check_canonical=False)
        w011 = [d for d in result.diagnostics if d.code == WarningCode.W011]
        assert any("cycle" in d.message for d in w011)

    def test_deep_thread_ok(self):
        text = (
            "@id a\n@file ./x.txt <<< root\n"
            "@id b\n@reply-to a\n@file ./x.txt <<< child\n"
            "@id c\n@reply-to b\n@file ./x.txt <<< grandchild\n"
        )
        result = lint_string(text, check_sources=False, check_canonical=False)
        w011 = [d for d in result.diagnostics if d.code == WarningCode.W011]
        assert not w011
