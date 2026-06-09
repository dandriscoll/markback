"""Tests for Markback V2 writer."""

import pytest
from pathlib import Path
import tempfile

from markback import (
    Record,
    FileRef,
    parse_string,
    parse_file,
    write,
    write_string,
    write_record_canonical,
    write_records_multi,
    append,
    normalize,
    normalize_file,
    write_file,
    OutputMode,
)


FIXTURES_DIR = Path(__file__).parent / "fixtures"


class TestWriteRecordCanonical:
    """Tests for write_record_canonical function."""

    def test_minimal_record(self):
        record = Record(feedback="positive", content="Hello world")
        result = write_record_canonical(record)
        assert "Hello world" in result
        assert "<<< positive" in result

    def test_record_with_id(self):
        record = Record(feedback="good", id="local:example", content="Content here")
        result = write_record_canonical(record)
        assert "@id local:example" in result
        assert "Content here" in result
        assert "<<< good" in result

    def test_record_with_file_compact(self):
        record = Record(feedback="approved", file=FileRef("./file.txt"))
        result = write_record_canonical(record, prefer_compact=True)
        assert "@file ./file.txt <<< approved" in result

    def test_record_with_file_full(self):
        record = Record(feedback="approved", file=FileRef("./file.txt"))
        result = write_record_canonical(record, prefer_compact=False)
        assert "@file ./file.txt" in result
        assert "<<< approved" in result
        lines = result.strip().split('\n')
        assert len(lines) == 2

    def test_record_with_tags(self):
        record = Record(feedback="good", id="item-1", tags=["review", "p1"], content="Content")
        result = write_record_canonical(record)
        assert "@tag review p1" in result

    def test_record_with_input(self):
        record = Record(
            feedback="accurate",
            id="gen-001",
            input=FileRef("./prompts/prompt.txt"),
            file=FileRef("./images/gen.jpg"),
        )
        result = write_record_canonical(record, prefer_compact=True)
        assert "@id gen-001" in result
        assert "@input ./prompts/prompt.txt" in result
        assert "@file ./images/gen.jpg <<< accurate" in result

    def test_record_with_file_and_content(self):
        """V2: file + content coexist."""
        record = Record(
            feedback="good",
            id="item-1",
            file=FileRef("./doc.txt"),
            content="Snapshot of content",
        )
        result = write_record_canonical(record, prefer_compact=False)
        assert "@file ./doc.txt" in result
        assert "Snapshot of content" in result
        assert "<<< good" in result


class TestWriteString:
    """Tests for write_string function."""

    def test_single_record(self):
        records = [Record(feedback="positive", content="Content")]
        result = write_string(records, version_header=False)
        assert "Content" in result
        assert "<<< positive" in result

    def test_multiple_records(self):
        records = [
            Record(feedback="good", id="1", content="First"),
            Record(feedback="bad", id="2", content="Second"),
        ]
        result = write_string(records, version_header=False)
        assert "---" in result
        assert "First" in result
        assert "Second" in result

    def test_compact_records(self):
        records = [
            Record(feedback="good", file=FileRef("./a.txt")),
            Record(feedback="bad", file=FileRef("./b.txt")),
        ]
        result = write_string(records, version_header=False)
        assert "@file ./a.txt <<< good" in result
        assert "@file ./b.txt <<< bad" in result

    def test_with_version_header(self):
        records = [Record(feedback="good", content="Content")]
        result = write_string(records, version_header=True)
        assert result.startswith("%markback 2\n")

    def test_with_scope_and_covers(self):
        records = [Record(feedback="issue-A", file=FileRef("./f1.txt"))]
        result = write_string(
            records,
            scope=["issue-A", "issue-B"],
            covers="./gen/*.txt",
        )
        assert "%scope issue-A issue-B" in result
        assert "%covers ./gen/*.txt" in result


class TestWrite:
    """Tests for write function."""

    def test_write_basic(self):
        with tempfile.NamedTemporaryFile(mode='w', suffix='.mb', delete=False) as f:
            path = Path(f.name)
        try:
            records = [Record(feedback="good", content="Test content")]
            write(path, records)
            content = path.read_text()
            assert "%markback 2" in content
            assert "Test content" in content
            assert "<<< good" in content
        finally:
            path.unlink()


class TestAppend:
    """Tests for append function."""

    def test_append_to_new_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "test.mb"
            record = Record(feedback="good", content="First")
            append(path, record)
            assert path.exists()
            content = path.read_text()
            assert "<<< good" in content

    def test_append_to_existing_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "test.mb"
            append(path, Record(feedback="good", content="First"))
            append(path, Record(feedback="great", content="Second"))
            content = path.read_text()
            assert "good" in content
            assert "great" in content


class TestNormalize:
    """Tests for normalize function."""

    def test_normalize_minimal(self):
        result = normalize(FIXTURES_DIR / "minimal.mb")
        assert "<<< positive" in result

    def test_normalize_idempotent(self):
        result1 = normalize(FIXTURES_DIR / "minimal.mb")
        parsed = parse_string(result1)
        result2 = write_string(parsed.records, version_header=False)
        # Normalize adds version header, so compare without it
        assert "<<< positive" in result1
        assert "<<< positive" in result2


class TestRoundTrip:
    """Tests for parse/write roundtrip."""

    def test_roundtrip_minimal(self):
        original = parse_file(FIXTURES_DIR / "minimal.mb")
        written = write_record_canonical(original.records[0])
        reparsed = parse_string(written)
        assert len(reparsed.records) == 1
        assert reparsed.records[0].feedback == original.records[0].feedback
        assert reparsed.records[0].content == original.records[0].content

    def test_roundtrip_with_id(self):
        original = parse_file(FIXTURES_DIR / "with_uri.mb")
        written = write_record_canonical(original.records[0])
        reparsed = parse_string(written)
        assert reparsed.records[0].id == original.records[0].id

    def test_roundtrip_multi_record(self):
        original = parse_file(FIXTURES_DIR / "multi_record.mb")
        written = write_string(original.records, version_header=False)
        reparsed = parse_string(written)
        assert len(reparsed.records) == len(original.records)
        for orig, new in zip(original.records, reparsed.records):
            assert orig.feedback == new.feedback

    def test_roundtrip_label_list(self):
        original = parse_file(FIXTURES_DIR / "label_list.mb")
        written = write_string(original.records, version_header=False)
        reparsed = parse_string(written)
        assert len(reparsed.records) == len(original.records)


class TestMultiSegmentWriter:
    """Tests for multi-segment section writing (one @file, multiple <<<)."""

    def test_groups_records_sharing_file(self):
        from markback import write_string
        records = [
            Record(file=FileRef("./essay.txt"), content="fox", feedback="awkward"),
            Record(file=FileRef("./essay.txt"), content="ending", feedback="weak"),
        ]
        text = write_string(records, version_header=False)
        assert text.count("@file ./essay.txt") == 1
        assert "---" not in text
        assert "<<< awkward" in text
        assert "<<< weak" in text

    def test_separator_between_different_files(self):
        from markback import write_string
        records = [
            Record(file=FileRef("./a.txt"), content="x", feedback="ok"),
            Record(file=FileRef("./b.txt"), content="y", feedback="ok"),
        ]
        text = write_string(records, version_header=False)
        assert "---" in text

    def test_id_on_continuation_falls_back_to_separator(self):
        """Writer doesn't emit per-item @id; falls back to --- for safety."""
        from markback import write_string
        records = [
            Record(file=FileRef("./doc.txt"), content="x", feedback="a"),
            Record(file=FileRef("./doc.txt"), id="r2", content="y", feedback="b"),
        ]
        text = write_string(records, version_header=False)
        assert "---" in text
        assert "@id r2" in text

    def test_records_without_file_are_not_grouped(self):
        from markback import write_string
        records = [
            Record(content="first", feedback="ok"),
            Record(content="second", feedback="ok"),
        ]
        text = write_string(records, version_header=False)
        assert "---" in text

    def test_roundtrip_multi_segment(self):
        from markback import parse_string, write_string
        originals = [
            Record(file=FileRef("./essay.txt"), content="fox", feedback="awkward"),
            Record(file=FileRef("./essay.txt"), content="ending", feedback="weak"),
            Record(file=FileRef("./essay.txt"), content="middle", feedback="trim"),
        ]
        text = write_string(originals)
        result = parse_string(text)
        assert not result.has_errors
        assert len(result.records) == 3
        for orig, parsed in zip(originals, result.records):
            assert str(parsed.file) == str(orig.file)
            assert parsed.content == orig.content
            assert parsed.feedback == orig.feedback


class TestV1CompatWriter:
    """Tests for V1 backward compat writer functions."""

    def test_write_file_single(self):
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

    def test_write_file_multi(self):
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

    def test_normalize_file_alias(self):
        result = normalize_file(FIXTURES_DIR / "minimal.mb")
        assert "<<< positive" in result


class TestReplyToWriter:
    """Tests for @reply-to writer output."""

    def test_reply_to_in_compact(self):
        record = Record(
            feedback="my reply",
            id="c2",
            reply_to="c1",
            file=FileRef("./a.txt"),
        )
        out = write_record_canonical(record)
        assert "@id c2" in out
        assert "@reply-to c1" in out
        # @reply-to appears immediately after @id
        lines = out.splitlines()
        id_idx = next(i for i, l in enumerate(lines) if l.startswith("@id"))
        rt_idx = next(i for i, l in enumerate(lines) if l.startswith("@reply-to"))
        assert rt_idx == id_idx + 1

    def test_reply_to_in_full(self):
        record = Record(
            feedback="my reply",
            id="c2",
            reply_to="c1",
            content="quoted text",
        )
        out = write_record_canonical(record, prefer_compact=False)
        assert "@reply-to c1" in out

    def test_multiline_feedback_emits_fence(self):
        record = Record(
            feedback="line one\nline two",
            id="c1",
            file=FileRef("./a.txt"),
        )
        out = write_record_canonical(record)
        assert '<<< """' in out
        assert out.rstrip().endswith('"""')
        # Must not be in compact form (compact puts <<< on the @file line)
        assert "@file ./a.txt <<<" not in out

    def test_singleline_feedback_stays_compact(self):
        record = Record(
            feedback="short",
            id="c1",
            file=FileRef("./a.txt"),
        )
        out = write_record_canonical(record)
        assert "@file ./a.txt <<< short" in out
        assert '"""' not in out

    def test_multiline_feedback_round_trip(self):
        text = (
            "%markback 2\n\n"
            '@id c1\n@file ./a.txt\n<<< """\n'
            "alpha\nbeta\ngamma\n"
            '"""\n'
        )
        result = parse_string(text)
        assert result.records[0].feedback == "alpha\nbeta\ngamma"
        written = write_string(result.records)
        assert written == text
        re_parsed = parse_string(written)
        assert re_parsed.records[0].feedback == "alpha\nbeta\ngamma"

    def test_round_trip_preserves_reply_to(self):
        text = (
            "%markback 2\n\n"
            "@id c1\n@file ./a.txt <<< initial\n"
            "@id c2\n@reply-to c1\n@file ./a.txt <<< a reply\n"
        )
        result = parse_string(text)
        assert [r.reply_to for r in result.records] == [None, "c1"]

        written = write_string(result.records)
        re_parsed = parse_string(written)
        assert [r.reply_to for r in re_parsed.records] == [None, "c1"]
