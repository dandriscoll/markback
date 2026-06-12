"""OS-correct line endings: writers preserve an existing file's EOL and use the
OS-native ending for new files; parser and linter are EOL-agnostic."""

import os

from markback import (
    Record,
    FileRef,
    write,
    append,
    parse_file,
    parse_string,
    lint_string,
)


def _eols(raw: bytes) -> set:
    """Distinct line-ending styles present in raw bytes."""
    styles = set()
    if b"\r\n" in raw:
        styles.add("crlf")
    # a bare \n not part of \r\n
    if raw.replace(b"\r\n", b"").find(b"\n") != -1:
        styles.add("lf")
    return styles


def test_new_file_uses_os_native_eol(tmp_path):
    p = tmp_path / "new.txt.mb"
    write(p, [Record(feedback="good", file=FileRef("./new.txt"))])
    raw = p.read_bytes()
    if os.linesep == "\r\n":
        assert _eols(raw) == {"crlf"}
    else:
        assert _eols(raw) == {"lf"}


def test_append_preserves_crlf(tmp_path):
    p = tmp_path / "win.txt.mb"
    # Seed a CRLF file.
    p.write_bytes(b"%markback 2\r\n\r\n@file ./win.txt <<< first\r\n")
    append(p, Record(feedback="second", file=FileRef("./win.txt")))
    raw = p.read_bytes()
    assert _eols(raw) == {"crlf"}, raw
    # And it still parses cleanly to two records.
    result = parse_file(p)
    assert not result.has_errors
    assert len(result.records) == 2


def test_append_preserves_lf(tmp_path):
    p = tmp_path / "nix.txt.mb"
    p.write_bytes(b"%markback 2\n\n@file ./nix.txt <<< first\n")
    append(p, Record(feedback="second", file=FileRef("./nix.txt")))
    raw = p.read_bytes()
    assert _eols(raw) == {"lf"}, raw


def test_parser_normalizes_crlf_no_stray_cr(tmp_path):
    # CRLF content with a multi-line body must not leak \r into record content.
    text = "%markback 2\r\n\r\n@id x\r\n\r\nline one\r\nline two\r\n<<< note\r\n"
    result = parse_string(text)
    assert not result.has_errors
    rec = result.records[0]
    assert "\r" not in (rec.content or "")
    assert (rec.content or "").splitlines() == ["line one", "line two"]


def test_linter_canonical_is_eol_agnostic():
    # The same canonical document in CRLF must not be flagged non-canonical (W008).
    lf = "@file ./a.txt <<< ok\n"
    crlf = lf.replace("\n", "\r\n")
    diags_lf = [d.code for d in lint_string(lf).diagnostics]
    diags_crlf = [d.code for d in lint_string(crlf).diagnostics]
    assert diags_lf == diags_crlf
