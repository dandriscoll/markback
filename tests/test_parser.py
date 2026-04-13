"""Tests for MarkBack V2 parser."""

import pytest
from pathlib import Path

from markback import (
    parse_string,
    parse_file,
    parse_feedback,
    Record,
    FileRef,
    SourceRef,
    ErrorCode,
    WarningCode,
    Severity,
)


FIXTURES_DIR = Path(__file__).parent / "fixtures"


class TestParseString:
    """Tests for parse_string function."""

    def test_minimal_record(self):
        text = "This is some content.\n<<< positive\n"
        result = parse_string(text)

        assert len(result.records) == 1
        record = result.records[0]
        assert record.content == "This is some content."
        assert record.feedback == "positive"
        assert record.id is None
        assert record.file is None

    def test_record_with_id(self):
        text = "@id my-item-1\n\nWhat is 2 + 2?\n<<< correct; answer=4\n"
        result = parse_string(text)

        assert len(result.records) == 1
        record = result.records[0]
        assert record.id == "my-item-1"
        assert record.content == "What is 2 + 2?"
        assert record.feedback == "correct; answer=4"

    def test_id_is_plain_string(self):
        """V2: @id values are plain strings, no URI validation."""
        text = "@id just-a-name\n\nContent.\n<<< good\n"
        result = parse_string(text)

        assert len(result.records) == 1
        assert result.records[0].id == "just-a-name"
        # No E003 error for plain string IDs
        errors = [d for d in result.diagnostics if d.code == ErrorCode.E003]
        assert len(errors) == 0

    def test_record_with_file(self):
        text = "@id local:photo-001\n@file ./images/photo.jpg\n<<< approved; quality=high\n"
        result = parse_string(text)

        assert len(result.records) == 1
        record = result.records[0]
        assert record.id == "local:photo-001"
        assert record.file == FileRef("./images/photo.jpg")
        assert record.feedback == "approved; quality=high"

    def test_file_and_content_coexist(self):
        """V2: @file + inline content can coexist."""
        text = "@id item-1\n@file ./doc.txt\n\nSnapshot content here.\n<<< good\n"
        result = parse_string(text)

        assert len(result.records) == 1
        record = result.records[0]
        assert record.file == FileRef("./doc.txt")
        assert record.content == "Snapshot content here."
        # No E005 error in V2
        errors = [d for d in result.diagnostics if d.code == ErrorCode.E005]
        assert len(errors) == 0

    def test_compact_record(self):
        text = "@file ./file.txt <<< positive\n"
        result = parse_string(text)

        assert len(result.records) == 1
        record = result.records[0]
        assert record.file == FileRef("./file.txt")
        assert record.feedback == "positive"

    def test_compact_record_with_id(self):
        text = "@id local:item-1\n@file ./file.txt <<< positive\n"
        result = parse_string(text)

        assert len(result.records) == 1
        record = result.records[0]
        assert record.id == "local:item-1"
        assert record.file == FileRef("./file.txt")

    def test_multi_record(self):
        text = "@id item-1\n\nFirst content.\n<<< positive\n\n---\n@id item-2\n\nSecond content.\n<<< negative\n"
        result = parse_string(text)

        assert len(result.records) == 2
        assert result.records[0].id == "item-1"
        assert result.records[0].feedback == "positive"
        assert result.records[1].id == "item-2"
        assert result.records[1].feedback == "negative"

    def test_label_list(self):
        text = "@file ./a.txt <<< good\n@file ./b.txt <<< bad\n@file ./c.txt <<< neutral\n"
        result = parse_string(text)

        assert len(result.records) == 3
        assert result.records[0].file == FileRef("./a.txt")
        assert result.records[0].feedback == "good"

    def test_multiline_content(self):
        text = "@id example\n\nLine one.\nLine two.\nLine three.\n<<< positive\n"
        result = parse_string(text)

        assert len(result.records) == 1
        assert result.records[0].content == "Line one.\nLine two.\nLine three."

    def test_content_starting_with_at(self):
        text = "@id example\n\n@twitter is a social network.\n<<< positive\n"
        result = parse_string(text)

        assert len(result.records) == 1
        assert result.records[0].content == "@twitter is a social network."

    def test_tag_header(self):
        text = "@id item-1\n@tag review p1 security\n\nContent.\n<<< good\n"
        result = parse_string(text)

        assert len(result.records) == 1
        assert result.records[0].tags == ["review", "p1", "security"]

    def test_multiple_tag_headers_merge(self):
        text = "@id item-1\n@tag review\n@tag security\n\nContent.\n<<< good\n"
        result = parse_string(text)

        assert len(result.records) == 1
        assert result.records[0].tags == ["review", "security"]

    def test_input_header(self):
        text = "@id gen-001\n@input ./prompts/prompt.txt\n@file ./images/gen.jpg\n<<< accurate\n"
        result = parse_string(text)

        assert len(result.records) == 1
        record = result.records[0]
        assert record.input == FileRef("./prompts/prompt.txt")
        assert record.file == FileRef("./images/gen.jpg")

    def test_input_with_inline_content(self):
        text = "@id text-001\n@input ./prompts/haiku.txt\n\nCherry blossoms fall\n<<< creative\n"
        result = parse_string(text)

        assert len(result.records) == 1
        record = result.records[0]
        assert record.input == FileRef("./prompts/haiku.txt")
        assert "Cherry blossoms fall" in record.content

    def test_by_header(self):
        text = "@id item-1\n@by dan@example.com\n\nContent.\n<<< good\n"
        result = parse_string(text)

        assert len(result.records) == 1
        assert result.records[0].by == "dan@example.com"


class TestExcerptHeader:
    """Tests for @excerpt header."""

    def test_single_line_excerpt(self):
        text = "@excerpt the quick brown fox\n@file ./foo.txt <<< awkward\n"
        result = parse_string(text)
        assert not result.has_errors
        assert result.records[0].excerpt == "the quick brown fox"

    def test_multi_line_excerpt(self):
        text = (
            '@excerpt """\n'
            'line one\n'
            'line two\n'
            'line three\n'
            '"""\n'
            '@file ./foo.txt <<< unclear\n'
        )
        result = parse_string(text)
        assert not result.has_errors
        assert result.records[0].excerpt == "line one\nline two\nline three"

    def test_excerpt_with_file_range(self):
        text = "@excerpt the lazy dog\n@file ./foo.txt:5:10-5:30 <<< note\n"
        result = parse_string(text)
        assert not result.has_errors
        record = result.records[0]
        assert record.excerpt == "the lazy dog"
        assert record.file.start_line == 5
        assert record.file.start_column == 10

    def test_unclosed_excerpt_block(self):
        text = (
            '@excerpt """\n'
            'unterminated\n'
            '@file ./foo.txt <<< note\n'
        )
        result = parse_string(text)
        assert result.has_errors
        assert any(d.code == ErrorCode.E012 for d in result.diagnostics)

    def test_excerpt_in_full_record(self):
        text = (
            "@id item-1\n"
            "@excerpt a phrase\n"
            "@file ./foo.txt\n"
            "\n"
            "inline content\n"
            "<<< feedback\n"
        )
        result = parse_string(text)
        assert not result.has_errors
        record = result.records[0]
        assert record.excerpt == "a phrase"
        assert record.content == "inline content"

    def test_empty_excerpt_block(self):
        text = '@excerpt """\n"""\n@file ./foo.txt <<< note\n'
        result = parse_string(text)
        assert not result.has_errors
        assert result.records[0].excerpt == ""


class TestFileLevelHeaders:
    """Tests for file-level % headers."""

    def test_version_header(self):
        text = "%markback 2\n\nContent.\n<<< good\n"
        result = parse_string(text)

        assert result.version == 2
        assert len(result.records) == 1

    def test_scope_header(self):
        text = "%markback 2\n%scope issue-A issue-B\n\n@file ./f1.txt <<< issue-A; found\n"
        result = parse_string(text)

        assert result.scope == ["issue-A", "issue-B"]
        assert len(result.records) == 1

    def test_covers_header(self):
        text = "%markback 2\n%covers ./gen/batch1/*.txt\n\n@file ./gen/batch1/f1.txt <<< issue-A\n"
        result = parse_string(text)

        assert result.covers == "./gen/batch1/*.txt"

    def test_sweep_pattern(self):
        """Full sweep: %scope + %covers + records."""
        text = (
            "%markback 2\n"
            "%scope issue-A issue-B\n"
            "%covers ./gen/batch3/*.txt\n"
            "\n"
            "@file ./gen/batch3/file2.txt <<< issue-B; tone is off\n"
            "@file ./gen/batch3/file5.txt <<< issue-A; issue-B; both problems\n"
        )
        result = parse_string(text)

        assert result.version == 2
        assert result.scope == ["issue-A", "issue-B"]
        assert result.covers == "./gen/batch3/*.txt"
        assert len(result.records) == 2


class TestV1BackwardCompat:
    """Tests for V1 backward compatibility."""

    def test_v1_uri_mapped_to_id(self):
        text = "@uri local:example\n\nContent.\n<<< good\n"
        result = parse_string(text)

        assert len(result.records) == 1
        assert result.records[0].id == "local:example"
        # Should have W010 warning
        w010 = [d for d in result.diagnostics if d.code == WarningCode.W010]
        assert len(w010) >= 1

    def test_v1_source_mapped_to_file(self):
        text = "@source ./file.txt\n<<< good\n"
        result = parse_string(text)

        assert len(result.records) == 1
        assert result.records[0].file == FileRef("./file.txt")
        w010 = [d for d in result.diagnostics if d.code == WarningCode.W010]
        assert len(w010) >= 1

    def test_v1_prior_mapped_to_input(self):
        text = "@prior ./prompt.txt\n@file ./output.txt\n<<< good\n"
        result = parse_string(text)

        assert len(result.records) == 1
        assert result.records[0].input == FileRef("./prompt.txt")
        w010 = [d for d in result.diagnostics if d.code == WarningCode.W010]
        assert len(w010) >= 1

    def test_v1_compact_source_mapped(self):
        text = "@source ./file.txt <<< positive\n"
        result = parse_string(text)

        assert len(result.records) == 1
        assert result.records[0].file == FileRef("./file.txt")
        w010 = [d for d in result.diagnostics if d.code == WarningCode.W010]
        assert len(w010) >= 1

    def test_v1_sourceref_alias(self):
        """SourceRef is an alias for FileRef."""
        ref = SourceRef("./file.txt")
        assert isinstance(ref, FileRef)


class TestParseErrors:
    """Tests for parser error detection."""

    def test_missing_feedback(self):
        text = "@id example\n\nContent without feedback.\n"
        result = parse_string(text)

        assert result.has_errors
        errors = [d for d in result.diagnostics if d.severity == Severity.ERROR]
        assert any(d.code == ErrorCode.E001 for d in errors)

    def test_empty_feedback(self):
        text = "Content here.\n<<<\n"
        result = parse_string(text)

        assert result.has_errors
        errors = [d for d in result.diagnostics if d.severity == Severity.ERROR]
        assert any(d.code == ErrorCode.E009 for d in errors)


class TestParseWarnings:
    """Tests for parser warning detection."""

    def test_duplicate_id(self):
        text = "@id same\n\nContent 1.\n<<< positive\n\n---\n@id same\n\nContent 2.\n<<< negative\n"
        result = parse_string(text)

        assert result.has_warnings
        warnings = [d for d in result.diagnostics if d.severity == Severity.WARNING]
        assert any(d.code == WarningCode.W001 for d in warnings)

    def test_missing_id_warning(self):
        text = "Content without ID.\n<<< positive\n"
        result = parse_string(text)

        warnings = [d for d in result.diagnostics if d.severity == Severity.WARNING]
        assert any(d.code == WarningCode.W006 for d in warnings)

    def test_unknown_header(self):
        text = "@id example\n@unknown value\n\nContent.\n<<< positive\n"
        result = parse_string(text)

        warnings = [d for d in result.diagnostics if d.severity == Severity.WARNING]
        assert any(d.code == WarningCode.W002 for d in warnings)


class TestParseFile:
    """Tests for parsing files from fixtures."""

    def test_parse_minimal(self):
        result = parse_file(FIXTURES_DIR / "minimal.mb")
        assert len(result.records) == 1
        assert result.records[0].content == "This is some content to be labeled."
        assert result.records[0].feedback == "positive"

    def test_parse_with_id(self):
        result = parse_file(FIXTURES_DIR / "with_uri.mb")
        assert len(result.records) == 1
        assert result.records[0].id == "https://example.com/items/prompt-42"

    def test_parse_external_file(self):
        result = parse_file(FIXTURES_DIR / "external_source.mb")
        assert len(result.records) == 1
        assert result.records[0].file == FileRef("./images/beach.jpg")

    def test_parse_compact_file(self):
        result = parse_file(FIXTURES_DIR / "compact_source.mb")
        assert len(result.records) == 1

    def test_parse_label_list(self):
        result = parse_file(FIXTURES_DIR / "label_list.mb")
        assert len(result.records) == 6

    def test_parse_multi_record(self):
        result = parse_file(FIXTURES_DIR / "multi_record.mb")
        assert len(result.records) == 5

    def test_parse_json_feedback(self):
        result = parse_file(FIXTURES_DIR / "json_feedback.mb")
        assert len(result.records) == 1
        assert result.records[0].feedback.startswith("json:")

    def test_parse_freeform_feedback(self):
        result = parse_file(FIXTURES_DIR / "freeform_feedback.mb")
        assert len(result.records) == 4
