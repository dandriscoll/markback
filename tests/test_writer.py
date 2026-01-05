"""Tests for MarkBack writer."""

import pytest
from pathlib import Path
import tempfile

from markback import (
    Record,
    SourceRef,
    parse_string,
    parse_file,
    write_record_canonical,
    write_records_multi,
    write_records_compact,
    write_label_file,
    write_file,
    normalize_file,
    OutputMode,
)


FIXTURES_DIR = Path(__file__).parent / "fixtures"


class TestWriteRecordCanonical:
    """Tests for write_record_canonical function."""

    def test_minimal_record(self):
        """Test writing a minimal record."""
        record = Record(feedback="positive", content="Hello world")
        result = write_record_canonical(record)

        assert "Hello world" in result
        assert "<<< positive" in result

    def test_record_with_uri(self):
        """Test writing a record with URI."""
        record = Record(
            feedback="good",
            uri="local:example",
            content="Content here",
        )
        result = write_record_canonical(record)

        assert "@uri local:example" in result
        assert "Content here" in result
        assert "<<< good" in result

    def test_record_with_source_compact(self):
        """Test writing a record with source in compact form."""
        record = Record(
            feedback="approved",
            source=SourceRef("./file.txt"),
        )
        result = write_record_canonical(record, prefer_compact=True)

        assert "@source ./file.txt <<< approved" in result

    def test_record_with_source_full(self):
        """Test writing a record with source in full form."""
        record = Record(
            feedback="approved",
            source=SourceRef("./file.txt"),
        )
        result = write_record_canonical(record, prefer_compact=False)

        assert "@source ./file.txt" in result
        assert "<<< approved" in result
        # Should NOT be on the same line
        lines = result.strip().split('\n')
        assert len(lines) == 2

    def test_record_with_uri_and_source_compact(self):
        """Test writing a record with both URI and source."""
        record = Record(
            feedback="good",
            uri="local:item-1",
            source=SourceRef("./data.txt"),
        )
        result = write_record_canonical(record, prefer_compact=True)

        assert "@uri local:item-1" in result
        assert "@source ./data.txt <<< good" in result

    def test_multiline_content(self):
        """Test writing multiline content."""
        record = Record(
            feedback="positive",
            content="Line 1\nLine 2\nLine 3",
        )
        result = write_record_canonical(record)

        assert "Line 1" in result
        assert "Line 2" in result
        assert "Line 3" in result


class TestWriteRecordsMulti:
    """Tests for write_records_multi function."""

    def test_single_record(self):
        """Test writing a single record in multi format."""
        records = [Record(feedback="positive", content="Content")]
        result = write_records_multi(records)

        assert "Content" in result
        assert "<<< positive" in result
        assert "---" not in result  # No separator for single record

    def test_multiple_records(self):
        """Test writing multiple records."""
        records = [
            Record(feedback="good", uri="local:1", content="First"),
            Record(feedback="bad", uri="local:2", content="Second"),
        ]
        result = write_records_multi(records)

        assert "---" in result
        assert "First" in result
        assert "Second" in result

    def test_compact_records(self):
        """Test writing multiple compact records."""
        records = [
            Record(feedback="good", source=SourceRef("./a.txt")),
            Record(feedback="bad", source=SourceRef("./b.txt")),
        ]
        result = write_records_multi(records, prefer_compact=True)

        assert "@source ./a.txt <<< good" in result
        assert "@source ./b.txt <<< bad" in result


class TestWriteRecordsCompact:
    """Tests for write_records_compact function."""

    def test_compact_list(self):
        """Test writing a compact label list."""
        records = [
            Record(feedback="good", source=SourceRef("./a.txt")),
            Record(feedback="bad", source=SourceRef("./b.txt")),
            Record(feedback="neutral", source=SourceRef("./c.txt")),
        ]
        result = write_records_compact(records)

        lines = [l for l in result.strip().split('\n') if l]
        assert len(lines) == 3


class TestWriteLabelFile:
    """Tests for write_label_file function."""

    def test_label_only(self):
        """Test writing a label-only file."""
        record = Record(feedback="approved")
        result = write_label_file(record)

        assert result.strip() == "<<< approved"

    def test_label_with_uri(self):
        """Test writing a label file with URI."""
        record = Record(feedback="approved", uri="local:item-1")
        result = write_label_file(record)

        assert "@uri local:item-1" in result
        assert "<<< approved" in result


class TestWriteFile:
    """Tests for write_file function."""

    def test_write_single(self):
        """Test writing in SINGLE mode."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.mb', delete=False) as f:
            path = Path(f.name)

        try:
            record = Record(feedback="good", content="Test content")
            write_file(path, [record], mode=OutputMode.SINGLE)

            content = path.read_text()
            assert "Test content" in content
            assert "<<< good" in content
        finally:
            path.unlink()

    def test_write_multi(self):
        """Test writing in MULTI mode."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.mb', delete=False) as f:
            path = Path(f.name)

        try:
            records = [
                Record(feedback="good", content="First"),
                Record(feedback="bad", content="Second"),
            ]
            write_file(path, records, mode=OutputMode.MULTI)

            content = path.read_text()
            assert "First" in content
            assert "Second" in content
            assert "---" in content
        finally:
            path.unlink()

    def test_write_paired(self):
        """Test writing in PAIRED mode."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.label.txt', delete=False) as f:
            path = Path(f.name)

        try:
            record = Record(feedback="approved", uri="local:item")
            write_file(path, [record], mode=OutputMode.PAIRED)

            content = path.read_text()
            assert "@uri local:item" in content
            assert "<<< approved" in content
        finally:
            path.unlink()


class TestNormalizeFile:
    """Tests for normalize_file function."""

    def test_normalize_minimal(self):
        """Test normalizing a minimal file."""
        result = normalize_file(FIXTURES_DIR / "minimal.mb")
        assert "<<< positive" in result

    def test_normalize_idempotent(self):
        """Test that normalization is idempotent."""
        # First normalization
        result1 = normalize_file(FIXTURES_DIR / "minimal.mb")

        # Parse and normalize again
        parsed = parse_string(result1)
        result2 = write_record_canonical(parsed.records[0]) + "\n"

        assert result1 == result2

    def test_normalize_multi_record_idempotent(self):
        """Test that multi-record normalization is idempotent."""
        result1 = normalize_file(FIXTURES_DIR / "freeform_feedback.mb")

        parsed = parse_string(result1)
        result2 = write_records_multi(parsed.records)

        assert result1 == result2


class TestRoundTrip:
    """Tests for parse/write roundtrip."""

    def test_roundtrip_minimal(self):
        """Test roundtrip for minimal fixture."""
        original = parse_file(FIXTURES_DIR / "minimal.mb")
        written = write_record_canonical(original.records[0])
        reparsed = parse_string(written)

        assert len(reparsed.records) == 1
        assert reparsed.records[0].feedback == original.records[0].feedback
        assert reparsed.records[0].content == original.records[0].content

    def test_roundtrip_with_uri(self):
        """Test roundtrip for with_uri fixture."""
        original = parse_file(FIXTURES_DIR / "with_uri.mb")
        written = write_record_canonical(original.records[0])
        reparsed = parse_string(written)

        assert reparsed.records[0].uri == original.records[0].uri

    def test_roundtrip_multi_record(self):
        """Test roundtrip for multi_record fixture."""
        original = parse_file(FIXTURES_DIR / "multi_record.mb")
        written = write_records_multi(original.records)
        reparsed = parse_string(written)

        assert len(reparsed.records) == len(original.records)
        for orig, new in zip(original.records, reparsed.records):
            assert orig.feedback == new.feedback
            assert orig.uri == new.uri

    def test_roundtrip_label_list(self):
        """Test roundtrip for label_list fixture."""
        original = parse_file(FIXTURES_DIR / "label_list.mb")
        written = write_records_multi(original.records, prefer_compact=True)
        reparsed = parse_string(written)

        assert len(reparsed.records) == len(original.records)
