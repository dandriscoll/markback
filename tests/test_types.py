"""Tests for MarkBack core types."""

import pytest
from pathlib import Path

from markback import (
    Record,
    SourceRef,
    Diagnostic,
    ParseResult,
    Severity,
    ErrorCode,
    WarningCode,
    parse_feedback,
)


class TestSourceRef:
    """Tests for SourceRef class."""

    def test_file_path(self):
        """Test file path source ref."""
        ref = SourceRef("./path/to/file.txt")

        assert ref.value == "./path/to/file.txt"
        assert not ref.is_uri

    def test_uri(self):
        """Test URI source ref."""
        ref = SourceRef("https://example.com/file.txt")

        assert ref.is_uri

    def test_file_uri(self):
        """Test file:// URI."""
        ref = SourceRef("file:///absolute/path/file.txt")

        assert ref.is_uri

    def test_resolve_relative(self):
        """Test resolving relative path."""
        ref = SourceRef("./subdir/file.txt")
        base = Path("/base/dir")

        resolved = ref.resolve(base)

        assert resolved == Path("/base/dir/subdir/file.txt")

    def test_resolve_absolute(self):
        """Test resolving absolute path."""
        ref = SourceRef("/absolute/path/file.txt")

        resolved = ref.resolve()

        assert resolved == Path("/absolute/path/file.txt")

    def test_resolve_file_uri(self):
        """Test resolving file:// URI."""
        ref = SourceRef("file:///path/to/file.txt")

        resolved = ref.resolve()

        assert resolved == Path("/path/to/file.txt")

    def test_resolve_http_uri_raises(self):
        """Test that resolving HTTP URI raises error."""
        ref = SourceRef("https://example.com/file.txt")

        with pytest.raises(ValueError):
            ref.resolve()

    def test_equality(self):
        """Test SourceRef equality."""
        ref1 = SourceRef("./file.txt")
        ref2 = SourceRef("./file.txt")
        ref3 = SourceRef("./other.txt")

        assert ref1 == ref2
        assert ref1 != ref3

    def test_string_representation(self):
        """Test string representation."""
        ref = SourceRef("./file.txt")

        assert str(ref) == "./file.txt"


class TestRecord:
    """Tests for Record class."""

    def test_minimal_record(self):
        """Test creating a minimal record."""
        record = Record(feedback="positive")

        assert record.feedback == "positive"
        assert record.uri is None
        assert record.source is None
        assert record.content is None

    def test_full_record(self):
        """Test creating a full record."""
        record = Record(
            feedback="good",
            uri="local:example",
            source=SourceRef("./file.txt"),
            content="Some content",
            metadata={"key": "value"},
        )

        assert record.feedback == "good"
        assert record.uri == "local:example"
        assert record.source.value == "./file.txt"
        assert record.content == "Some content"
        assert record.metadata == {"key": "value"}

    def test_get_identifier_uri(self):
        """Test get_identifier returns URI when present."""
        record = Record(
            feedback="good",
            uri="local:example",
            source=SourceRef("./file.txt"),
        )

        assert record.get_identifier() == "local:example"

    def test_get_identifier_source(self):
        """Test get_identifier returns source when no URI."""
        record = Record(
            feedback="good",
            source=SourceRef("./file.txt"),
        )

        assert record.get_identifier() == "./file.txt"

    def test_get_identifier_none(self):
        """Test get_identifier returns None when no identifier."""
        record = Record(feedback="good")

        assert record.get_identifier() is None

    def test_has_inline_content_true(self):
        """Test has_inline_content with content."""
        record = Record(feedback="good", content="Some content")

        assert record.has_inline_content()

    def test_has_inline_content_false_none(self):
        """Test has_inline_content without content."""
        record = Record(feedback="good")

        assert not record.has_inline_content()

    def test_has_inline_content_false_empty(self):
        """Test has_inline_content with empty content."""
        record = Record(feedback="good", content="   ")

        assert not record.has_inline_content()

    def test_to_dict(self):
        """Test to_dict serialization."""
        record = Record(
            feedback="good",
            uri="local:example",
            content="Content",
        )

        d = record.to_dict()

        assert d["feedback"] == "good"
        assert d["uri"] == "local:example"
        assert d["content"] == "Content"


class TestDiagnostic:
    """Tests for Diagnostic class."""

    def test_error_diagnostic(self):
        """Test creating an error diagnostic."""
        diag = Diagnostic(
            file=Path("test.mb"),
            line=10,
            column=5,
            severity=Severity.ERROR,
            code=ErrorCode.E001,
            message="Missing feedback",
        )

        assert diag.severity == Severity.ERROR
        assert diag.code == ErrorCode.E001

    def test_warning_diagnostic(self):
        """Test creating a warning diagnostic."""
        diag = Diagnostic(
            file=Path("test.mb"),
            line=1,
            column=None,
            severity=Severity.WARNING,
            code=WarningCode.W006,
            message="Missing URI",
        )

        assert diag.severity == Severity.WARNING
        assert diag.code == WarningCode.W006

    def test_str_representation(self):
        """Test string representation."""
        diag = Diagnostic(
            file=Path("test.mb"),
            line=10,
            column=5,
            severity=Severity.ERROR,
            code=ErrorCode.E001,
            message="Missing feedback",
        )

        s = str(diag)
        assert "test.mb" in s
        assert "10" in s
        assert "E001" in s
        assert "Missing feedback" in s

    def test_to_dict(self):
        """Test to_dict serialization."""
        diag = Diagnostic(
            file=Path("test.mb"),
            line=10,
            column=5,
            severity=Severity.ERROR,
            code=ErrorCode.E001,
            message="Missing feedback",
            record_index=0,
        )

        d = diag.to_dict()

        assert d["file"] == "test.mb"
        assert d["line"] == 10
        assert d["severity"] == "error"
        assert d["code"] == "E001"


class TestParseResult:
    """Tests for ParseResult class."""

    def test_empty_result(self):
        """Test empty parse result."""
        result = ParseResult(records=[], diagnostics=[])

        assert not result.has_errors
        assert not result.has_warnings
        assert result.error_count == 0
        assert result.warning_count == 0

    def test_result_with_errors(self):
        """Test parse result with errors."""
        result = ParseResult(
            records=[],
            diagnostics=[
                Diagnostic(
                    file=None,
                    line=1,
                    column=None,
                    severity=Severity.ERROR,
                    code=ErrorCode.E001,
                    message="Error",
                ),
            ],
        )

        assert result.has_errors
        assert result.error_count == 1

    def test_result_with_warnings(self):
        """Test parse result with warnings."""
        result = ParseResult(
            records=[],
            diagnostics=[
                Diagnostic(
                    file=None,
                    line=1,
                    column=None,
                    severity=Severity.WARNING,
                    code=WarningCode.W006,
                    message="Warning",
                ),
            ],
        )

        assert result.has_warnings
        assert result.warning_count == 1

    def test_mixed_diagnostics(self):
        """Test parse result with mixed diagnostics."""
        result = ParseResult(
            records=[],
            diagnostics=[
                Diagnostic(
                    file=None, line=1, column=None,
                    severity=Severity.ERROR, code=ErrorCode.E001, message="Error",
                ),
                Diagnostic(
                    file=None, line=2, column=None,
                    severity=Severity.WARNING, code=WarningCode.W006, message="Warning",
                ),
            ],
        )

        assert result.has_errors
        assert result.has_warnings
        assert result.error_count == 1
        assert result.warning_count == 1


class TestParseFeedback:
    """Tests for parse_feedback function."""

    def test_simple_label(self):
        """Test parsing simple label."""
        result = parse_feedback("positive")

        assert result.raw == "positive"
        assert result.label == "positive"
        assert not result.attributes
        assert result.comment is None

    def test_label_with_comment(self):
        """Test parsing label with freeform comment."""
        result = parse_feedback("negative; needs more detail")

        assert result.label == "negative"
        assert result.comment == "needs more detail"

    def test_key_value_pairs(self):
        """Test parsing key=value pairs."""
        result = parse_feedback("quality=high; score=0.9")

        assert result.attributes == {"quality": "high", "score": "0.9"}
        assert result.label is None

    def test_mixed_format(self):
        """Test parsing mixed label + attributes + comment."""
        result = parse_feedback("good; rating=5; very helpful")

        assert result.label == "good"
        assert result.attributes == {"rating": "5"}
        assert result.comment == "very helpful"

    def test_json_mode(self):
        """Test parsing JSON feedback."""
        result = parse_feedback('json:{"key": "value", "num": 42}')

        assert result.is_json
        assert result.json_data == {"key": "value", "num": 42}

    def test_invalid_json(self):
        """Test parsing invalid JSON feedback."""
        result = parse_feedback("json:{invalid}")

        assert result.is_json
        assert result.json_data is None  # Failed to parse

    def test_quoted_values(self):
        """Test parsing quoted attribute values."""
        result = parse_feedback('note="value; with semicolon"')

        assert result.attributes == {"note": "value; with semicolon"}

    def test_escaped_quotes(self):
        """Test parsing escaped quotes in values."""
        result = parse_feedback('note="contains \\"quotes\\""')

        assert result.attributes == {"note": 'contains "quotes"'}
