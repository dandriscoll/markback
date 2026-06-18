"""Tests for the @action header (issue #11)."""

from markback import parse_string, write_string, Record, FileRef, Action
from markback.writer import write_record_canonical


def test_parses_single_action_with_actor():
    r = parse_string("@id c1\n@action created 2026-06-17T10:00:00Z dan@example.com\n<<< note")
    assert not r.has_errors
    assert r.records[0].actions == [
        Action(verb="created", timestamp="2026-06-17T10:00:00Z", actor="dan@example.com")
    ]


def test_parses_action_without_actor():
    r = parse_string("@id c1\n@action created 2026-06-17T10:00:00Z\n<<< note")
    assert r.records[0].actions[0].actor is None


def test_multiple_actions_accumulate_in_order():
    r = parse_string(
        "@id c1\n@action created 2026-06-17T10:00:00Z a\n"
        "@action resolved 2026-06-18T09:00:00Z b\n<<< note"
    )
    assert [a.verb for a in r.records[0].actions] == ["created", "resolved"]


def test_actor_may_contain_spaces():
    r = parse_string("@id c1\n@action resolved 2026-06-18T09:00:00Z Reviewer Two\n<<< note")
    assert r.records[0].actions[0].actor == "Reviewer Two"


def test_malformed_action_emits_w012_and_is_skipped():
    r = parse_string("@id c1\n@action created\n<<< note")
    assert any(d.code.value == "W012" for d in r.diagnostics)
    assert r.records[0].actions == []


def test_action_is_known_header_no_w002():
    r = parse_string("@id c1\n@action created 2026-06-17T10:00:00Z\n<<< note")
    assert not any(d.code.value == "W002" for d in r.diagnostics)


def test_action_is_per_record_not_inherited():
    r = parse_string(
        "@file ./x.txt\n@action created 2026-06-17T10:00:00Z\n\nfirst\n<<< a\n\nsecond\n<<< b"
    )
    assert len(r.records) == 2
    assert len(r.records[0].actions) == 1
    assert r.records[1].actions == []  # continuation must not inherit the action


def test_writer_emits_action_after_by_before_tag():
    rec = Record(
        feedback="note",
        id="c1",
        by="dan",
        tags=["x"],
        actions=[Action(verb="created", timestamp="2026-06-17T10:00:00Z", actor="dan")],
        file=FileRef("./a.txt:1"),
    )
    out = write_record_canonical(rec)
    lines = out.split("\n")
    by_idx = next(i for i, l in enumerate(lines) if l.startswith("@by"))
    act_idx = next(i for i, l in enumerate(lines) if l.startswith("@action"))
    tag_idx = next(i for i, l in enumerate(lines) if l.startswith("@tag"))
    assert by_idx < act_idx < tag_idx, out


def test_roundtrip_fixpoint_multi_action_and_space_actor_non_first_line():
    src = (
        "%markback 2\n\n@id c1\n@by dan@example.com\n"
        "@action created 2026-06-17T10:00:00Z dan@example.com\n"
        "@action resolved 2026-06-18T14:30:00Z Reviewer Two\n"
        "@file ./login.py:42\n\nif user.is_admin:\n<<< this branch never fires\n"
    )
    first = parse_string(src)
    assert not first.has_errors
    out = write_string(first.records)
    second = parse_string(out)
    assert second.records[0].actions == first.records[0].actions
    assert write_string(second.records) == out


def test_record_with_actions_writes_full_form_not_dropped_continuation():
    records = [
        Record(feedback="a", file=FileRef("./x.txt"), content="first"),
        Record(
            feedback="b",
            file=FileRef("./x.txt"),
            content="second",
            actions=[Action(verb="created", timestamp="2026-06-17T10:00:00Z")],
        ),
    ]
    out = write_string(records)
    back = parse_string(out)
    assert len(back.records) == 2
    assert len(back.records[1].actions) == 1
