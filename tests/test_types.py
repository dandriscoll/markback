"""Tests for MarkBack V2 core types."""

import pytest
from pathlib import Path

from markback import (
    Record,
    FileRef,
    SourceRef,
    Diagnostic,
    ParseResult,
    Severity,
    ErrorCode,
    WarningCode,
    parse_feedback,
)


class TestFileRef:
    """Tests for FileRef class."""

    def test_file_path(self):
        ref = FileRef("./path/to/file.txt")
        assert ref.value == "./path/to/file.txt"
        assert not ref.is_uri

    def test_uri(self):
        ref = FileRef("https://example.com/file.txt")
        assert ref.is_uri

    def test_file_uri(self):
        ref = FileRef("file:///absolute/path/file.txt")
        assert ref.is_uri

    def test_resolve_relative(self):
        ref = FileRef("./subdir/file.txt")
        base = Path("/base/dir")
        resolved = ref.resolve(base)
        assert resolved == Path("/base/dir/subdir/file.txt")

    def test_resolve_absolute(self):
        ref = FileRef("/absolute/path/file.txt")
        resolved = ref.resolve()
        assert resolved == Path("/absolute/path/file.txt")

    def test_resolve_file_uri(self):
        ref = FileRef("file:///path/to/file.txt")
        resolved = ref.resolve()
        assert resolved == Path("/path/to/file.txt")

    def test_resolve_http_uri_raises(self):
        ref = FileRef("https://example.com/file.txt")
        with pytest.raises(ValueError):
            ref.resolve()

    def test_equality(self):
        ref1 = FileRef("./file.txt")
        ref2 = FileRef("./file.txt")
        ref3 = FileRef("./other.txt")
        assert ref1 == ref2
        assert ref1 != ref3

    def test_string_representation(self):
        ref = FileRef("./file.txt")
        assert str(ref) == "./file.txt"

    def test_sourceref_alias(self):
        """Test V1 backward compat alias."""
        ref = SourceRef("./file.txt")
        assert isinstance(ref, FileRef)


class TestRecord:
    """Tests for Record class."""

    def test_minimal_record(self):
        record = Record(feedback="positive")
        assert record.feedback == "positive"
        assert record.id is None
        assert record.file is None
        assert record.content is None
        assert record.tags == []

    def test_full_record(self):
        record = Record(
            feedback="good",
            id="local:example",
            file=FileRef("./file.txt"),
            content="Some content",
            tags=["review", "p1"],
            metadata={"key": "value"},
        )
        assert record.feedback == "good"
        assert record.id == "local:example"
        assert record.file.value == "./file.txt"
        assert record.content == "Some content"
        assert record.tags == ["review", "p1"]

    def test_v1_compat_properties(self):
        """Test V1 backward compat property aliases."""
        record = Record(feedback="good", id="local:example", file=FileRef("./f.txt"), input=FileRef("./i.txt"))
        assert record.uri == "local:example"
        assert record.source == FileRef("./f.txt")
        assert record.prior == FileRef("./i.txt")

        # Setters
        record.uri = "new-id"
        assert record.id == "new-id"
        record.source = FileRef("./new.txt")
        assert record.file == FileRef("./new.txt")

    def test_get_identifier_id(self):
        record = Record(feedback="good", id="local:example", file=FileRef("./file.txt"))
        assert record.get_identifier() == "local:example"

    def test_get_identifier_file(self):
        record = Record(feedback="good", file=FileRef("./file.txt"))
        assert record.get_identifier() == "./file.txt"

    def test_get_identifier_none(self):
        record = Record(feedback="good")
        assert record.get_identifier() is None

    def test_has_inline_content_true(self):
        record = Record(feedback="good", content="Some content")
        assert record.has_inline_content()

    def test_has_inline_content_false_none(self):
        record = Record(feedback="good")
        assert not record.has_inline_content()

    def test_has_inline_content_false_empty(self):
        record = Record(feedback="good", content="   ")
        assert not record.has_inline_content()

    def test_to_dict(self):
        record = Record(
            feedback="good",
            id="local:example",
            content="Content",
            tags=["t1"],
        )
        d = record.to_dict()
        assert d["feedback"] == "good"
        assert d["id"] == "local:example"
        assert d["content"] == "Content"
        assert d["tags"] == ["t1"]

    def test_id_is_plain_string(self):
        """V2: @id values are plain strings, not validated URIs."""
        record = Record(feedback="good", id="my-simple-id")
        assert record.id == "my-simple-id"

    def test_file_and_content_coexist(self):
        """V2: @file + inline content can coexist."""
        record = Record(
            feedback="good",
            file=FileRef("./doc.pdf"),
            content="Snapshot of content",
        )
        assert record.file is not None
        assert record.has_inline_content()


class TestDiagnostic:
    """Tests for Diagnostic class."""

    def test_error_diagnostic(self):
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
        assert diag.is_error

    def test_warning_diagnostic(self):
        diag = Diagnostic(
            file=Path("test.mb"),
            line=1,
            column=None,
            severity=Severity.WARNING,
            code=WarningCode.W006,
            message="Missing ID",
        )
        assert diag.severity == Severity.WARNING
        assert not diag.is_error

    def test_str_representation(self):
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

    def test_to_dict(self):
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
        result = ParseResult(records=[], diagnostics=[])
        assert not result.has_errors
        assert not result.has_warnings
        assert result.error_count == 0
        assert result.warning_count == 0

    def test_result_with_errors(self):
        result = ParseResult(
            records=[],
            diagnostics=[
                Diagnostic(file=None, line=1, column=None, severity=Severity.ERROR, code=ErrorCode.E001, message="Error"),
            ],
        )
        assert result.has_errors
        assert result.error_count == 1

    def test_result_with_scope_and_covers(self):
        result = ParseResult(
            records=[],
            diagnostics=[],
            scope=["issue-A", "issue-B"],
            covers="./gen/batch1/*.txt",
        )
        assert result.scope == ["issue-A", "issue-B"]
        assert result.covers == "./gen/batch1/*.txt"


class TestParseFeedback:
    """Tests for parse_feedback function."""

    def test_simple_label(self):
        result = parse_feedback("positive")
        assert result.raw == "positive"
        assert result.label == "positive"
        assert not result.attributes
        assert result.comment is None

    def test_label_with_comment(self):
        result = parse_feedback("negative; needs more detail")
        assert result.label == "negative"
        assert result.comment == "needs more detail"

    def test_key_value_pairs(self):
        result = parse_feedback("quality=high; score=0.9")
        assert result.attributes == {"quality": "high", "score": "0.9"}
        assert result.label is None

    def test_mixed_format(self):
        result = parse_feedback("good; rating=5; very helpful")
        assert result.label == "good"
        assert result.attributes == {"rating": "5"}
        assert result.comment == "very helpful"

    def test_json_mode(self):
        result = parse_feedback('json:{"key": "value", "num": 42}')
        assert result.is_json
        assert result.json_data == {"key": "value", "num": 42}

    def test_invalid_json(self):
        result = parse_feedback("json:{invalid}")
        assert result.is_json
        assert result.json_data is None

    def test_quoted_values(self):
        result = parse_feedback('note="value; with semicolon"')
        assert result.attributes == {"note": "value; with semicolon"}

    def test_escaped_quotes(self):
        result = parse_feedback('note="contains \\"quotes\\""')
        assert result.attributes == {"note": 'contains "quotes"'}
