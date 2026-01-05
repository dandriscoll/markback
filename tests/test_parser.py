"""Tests for MarkBack parser."""

import pytest
from pathlib import Path

from markback import (
    parse_string,
    parse_file,
    parse_feedback,
    Record,
    SourceRef,
    ErrorCode,
    WarningCode,
    Severity,
)


FIXTURES_DIR = Path(__file__).parent / "fixtures"


class TestParseString:
    """Tests for parse_string function."""

    def test_minimal_record(self):
        """Test parsing a minimal record with no URI."""
        text = "This is some content.\n<<< positive\n"
        result = parse_string(text)

        assert len(result.records) == 1
        record = result.records[0]
        assert record.content == "This is some content."
        assert record.feedback == "positive"
        assert record.uri is None
        assert record.source is None

    def test_record_with_uri(self):
        """Test parsing a record with URI header."""
        text = """@uri https://example.com/item-1

What is 2 + 2?
<<< correct; answer=4
"""
        result = parse_string(text)

        assert len(result.records) == 1
        record = result.records[0]
        assert record.uri == "https://example.com/item-1"
        assert record.content == "What is 2 + 2?"
        assert record.feedback == "correct; answer=4"

    def test_record_with_source(self):
        """Test parsing a record with external source."""
        text = """@uri local:photo-001
@source ./images/photo.jpg
<<< approved; quality=high
"""
        result = parse_string(text)

        assert len(result.records) == 1
        record = result.records[0]
        assert record.uri == "local:photo-001"
        assert record.source == SourceRef("./images/photo.jpg")
        assert record.content is None  # No inline content
        assert record.feedback == "approved; quality=high"

    def test_compact_record(self):
        """Test parsing a compact single-line record."""
        text = "@source ./file.txt <<< positive\n"
        result = parse_string(text)

        assert len(result.records) == 1
        record = result.records[0]
        assert record.source == SourceRef("./file.txt")
        assert record.feedback == "positive"
        assert record._is_compact

    def test_compact_record_with_uri(self):
        """Test parsing a compact record with preceding URI."""
        text = """@uri local:item-1
@source ./file.txt <<< positive
"""
        result = parse_string(text)

        assert len(result.records) == 1
        record = result.records[0]
        assert record.uri == "local:item-1"
        assert record.source == SourceRef("./file.txt")
        assert record.feedback == "positive"

    def test_multi_record(self):
        """Test parsing multiple records."""
        text = """@uri local:item-1

First content.
<<< positive

---
@uri local:item-2

Second content.
<<< negative
"""
        result = parse_string(text)

        assert len(result.records) == 2
        assert result.records[0].uri == "local:item-1"
        assert result.records[0].content == "First content."
        assert result.records[0].feedback == "positive"
        assert result.records[1].uri == "local:item-2"
        assert result.records[1].content == "Second content."
        assert result.records[1].feedback == "negative"

    def test_label_list(self):
        """Test parsing a label list (multiple compact records)."""
        text = """@source ./a.txt <<< good
@source ./b.txt <<< bad
@source ./c.txt <<< neutral
"""
        result = parse_string(text)

        assert len(result.records) == 3
        assert result.records[0].source == SourceRef("./a.txt")
        assert result.records[0].feedback == "good"
        assert result.records[1].source == SourceRef("./b.txt")
        assert result.records[1].feedback == "bad"
        assert result.records[2].source == SourceRef("./c.txt")
        assert result.records[2].feedback == "neutral"

    def test_multiline_content(self):
        """Test parsing content with multiple lines."""
        text = """@uri local:example

Line one.
Line two.
Line three.
<<< positive
"""
        result = parse_string(text)

        assert len(result.records) == 1
        assert result.records[0].content == "Line one.\nLine two.\nLine three."

    def test_content_starting_with_at(self):
        """Test content that starts with @ (needs blank line)."""
        text = """@uri local:example

@twitter is a social network.
<<< positive
"""
        result = parse_string(text)

        assert len(result.records) == 1
        assert result.records[0].content == "@twitter is a social network."

    def test_freeform_feedback(self):
        """Test freeform feedback with semicolons."""
        text = "Content here.\n<<< negative; use more formal language\n"
        result = parse_string(text)

        assert len(result.records) == 1
        assert result.records[0].feedback == "negative; use more formal language"


class TestParseErrors:
    """Tests for parser error detection."""

    def test_missing_feedback(self):
        """Test detection of missing feedback."""
        text = "@uri local:example\n\nContent without feedback.\n"
        result = parse_string(text)

        assert result.has_errors
        errors = [d for d in result.diagnostics if d.severity == Severity.ERROR]
        assert any(d.code == ErrorCode.E001 for d in errors)

    def test_empty_feedback(self):
        """Test detection of empty feedback."""
        text = "Content here.\n<<<\n"
        result = parse_string(text)

        assert result.has_errors
        errors = [d for d in result.diagnostics if d.severity == Severity.ERROR]
        assert any(d.code == ErrorCode.E009 for d in errors)

    def test_malformed_uri(self):
        """Test detection of malformed URI."""
        text = "@uri not-a-valid-uri\n\nContent.\n<<< positive\n"
        result = parse_string(text)

        assert result.has_errors
        errors = [d for d in result.diagnostics if d.severity == Severity.ERROR]
        assert any(d.code == ErrorCode.E003 for d in errors)


class TestParseWarnings:
    """Tests for parser warning detection."""

    def test_duplicate_uri(self):
        """Test detection of duplicate URIs."""
        text = """@uri local:same

Content 1.
<<< positive

---
@uri local:same

Content 2.
<<< negative
"""
        result = parse_string(text)

        assert result.has_warnings
        warnings = [d for d in result.diagnostics if d.severity == Severity.WARNING]
        assert any(d.code == WarningCode.W001 for d in warnings)

    def test_missing_uri_warning(self):
        """Test warning for missing URI."""
        text = "Content without URI.\n<<< positive\n"
        result = parse_string(text)

        warnings = [d for d in result.diagnostics if d.severity == Severity.WARNING]
        assert any(d.code == WarningCode.W006 for d in warnings)

    def test_unknown_header(self):
        """Test warning for unknown header."""
        text = "@uri local:example\n@unknown value\n\nContent.\n<<< positive\n"
        result = parse_string(text)

        warnings = [d for d in result.diagnostics if d.severity == Severity.WARNING]
        assert any(d.code == WarningCode.W002 for d in warnings)


class TestParseFile:
    """Tests for parsing files from fixtures."""

    def test_parse_minimal(self):
        """Test parsing minimal.mb fixture."""
        result = parse_file(FIXTURES_DIR / "minimal.mb")

        assert len(result.records) == 1
        assert result.records[0].content == "This is some content to be labeled."
        assert result.records[0].feedback == "positive"

    def test_parse_with_uri(self):
        """Test parsing with_uri.mb fixture."""
        result = parse_file(FIXTURES_DIR / "with_uri.mb")

        assert len(result.records) == 1
        assert result.records[0].uri == "https://example.com/items/prompt-42"

    def test_parse_external_source(self):
        """Test parsing external_source.mb fixture."""
        result = parse_file(FIXTURES_DIR / "external_source.mb")

        assert len(result.records) == 1
        assert result.records[0].source == SourceRef("./images/beach.jpg")

    def test_parse_compact_source(self):
        """Test parsing compact_source.mb fixture."""
        result = parse_file(FIXTURES_DIR / "compact_source.mb")

        assert len(result.records) == 1
        assert result.records[0]._is_compact

    def test_parse_label_list(self):
        """Test parsing label_list.mb fixture."""
        result = parse_file(FIXTURES_DIR / "label_list.mb")

        assert len(result.records) == 6
        assert all(r._is_compact for r in result.records)

    def test_parse_multi_record(self):
        """Test parsing multi_record.mb fixture."""
        result = parse_file(FIXTURES_DIR / "multi_record.mb")

        assert len(result.records) == 5

    def test_parse_json_feedback(self):
        """Test parsing json_feedback.mb fixture."""
        result = parse_file(FIXTURES_DIR / "json_feedback.mb")

        assert len(result.records) == 1
        assert result.records[0].feedback.startswith("json:")

    def test_parse_freeform_feedback(self):
        """Test parsing freeform_feedback.mb fixture."""
        result = parse_file(FIXTURES_DIR / "freeform_feedback.mb")

        assert len(result.records) == 4


class TestParseFeedback:
    """Tests for feedback parsing."""

    def test_simple_label(self):
        """Test parsing a simple label."""
        parsed = parse_feedback("positive")

        assert parsed.label == "positive"
        assert parsed.comment is None
        assert parsed.attributes == {}

    def test_label_with_comment(self):
        """Test parsing label with comment."""
        parsed = parse_feedback("negative; use more formal language")

        assert parsed.label == "negative"
        assert parsed.comment == "use more formal language"

    def test_attributes(self):
        """Test parsing key=value attributes."""
        parsed = parse_feedback("sentiment=positive; confidence=0.9")

        assert parsed.label is None
        assert parsed.attributes == {"sentiment": "positive", "confidence": "0.9"}

    def test_mixed_format(self):
        """Test parsing mixed label + attributes + comment."""
        parsed = parse_feedback("good; quality=high; needs more detail")

        assert parsed.label == "good"
        assert parsed.attributes == {"quality": "high"}
        assert parsed.comment == "needs more detail"

    def test_json_feedback(self):
        """Test parsing JSON feedback."""
        parsed = parse_feedback('json:{"key": "value"}')

        assert parsed.is_json
        assert parsed.json_data == {"key": "value"}

    def test_quoted_value(self):
        """Test parsing quoted attribute value."""
        parsed = parse_feedback('note="value; with semicolon"')

        assert parsed.attributes == {"note": "value; with semicolon"}
