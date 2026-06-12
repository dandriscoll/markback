"""Markback V2 writer implementation."""

import os
from enum import Enum
from pathlib import Path
from typing import Optional

from .types import Record, FileRef


def _resolve_eol(path: Path) -> str:
    """Line ending to write ``path`` with: preserve an existing file's
    convention, otherwise the OS-native ending (CRLF on Windows, LF elsewhere).

    Reads raw bytes — ``read_text`` would translate CRLF to LF and hide the
    file's real convention.
    """
    try:
        existing = path.read_bytes()
    except (FileNotFoundError, NotADirectoryError, IsADirectoryError, OSError):
        existing = b""
    if existing:
        return "\r\n" if b"\r\n" in existing else "\n"
    return os.linesep


def _write_text_eol(path: Path, content: str) -> None:
    """Write ``content`` to ``path`` with OS-correct line endings.

    Records are built internally with LF; translate to the resolved EOL and
    write with ``newline=""`` so Python performs no further translation.
    """
    eol = _resolve_eol(path)
    if eol != "\n":
        content = content.replace("\r\n", "\n").replace("\n", eol)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(content)


def _feedback_is_multiline(feedback: str) -> bool:
    return '\n' in feedback


def _format_feedback(feedback: str) -> str:
    """Render feedback for appending after `<<< `. Handles fenced multi-line."""
    if _feedback_is_multiline(feedback):
        return '"""\n' + feedback + '\n"""'
    return feedback


class OutputMode(Enum):
    """Output format modes."""
    SINGLE = "single"
    MULTI = "multi"
    COMPACT = "compact"


def _write_record_canonical(
    record: Record,
    prefer_compact: bool = True,
) -> str:
    """Write a single record in canonical V2 format."""
    lines: list[str] = []

    use_compact = (
        prefer_compact
        and record.file is not None
        and not record.has_inline_content()
        and not _feedback_is_multiline(record.feedback)
    )

    if use_compact:
        # Compact format: headers on own lines, then @file ... <<<
        if record.id:
            lines.append(f"@id {record.id}")
        if record.reply_to:
            lines.append(f"@reply-to {record.reply_to}")
        if record.by:
            lines.append(f"@by {record.by}")
        if record.tags:
            lines.append(f"@tag {' '.join(record.tags)}")
        if record.input:
            lines.append(f"@input {record.input}")
        lines.append(f"@file {record.file} <<< {record.feedback}")
    else:
        # Full format
        if record.id:
            lines.append(f"@id {record.id}")
        if record.reply_to:
            lines.append(f"@reply-to {record.reply_to}")
        if record.by:
            lines.append(f"@by {record.by}")
        if record.tags:
            lines.append(f"@tag {' '.join(record.tags)}")
        if record.input:
            lines.append(f"@input {record.input}")
        if record.file:
            lines.append(f"@file {record.file}")

        if record.has_inline_content():
            lines.append("")  # Blank line before content
            content_lines = record.content.split('\n')
            while content_lines and not content_lines[0].strip():
                content_lines.pop(0)
            while content_lines and not content_lines[-1].strip():
                content_lines.pop()
            lines.extend(content_lines)

        lines.append(f"<<< {_format_feedback(record.feedback)}")

    return '\n'.join(lines)


def _section_signature(record: Record) -> tuple:
    """Headers that determine section grouping for multi-segment writes."""
    return (
        str(record.file) if record.file else None,
        record.by,
        str(record.input) if record.input else None,
        tuple(record.tags),
    )


def _can_continue_section(prev: Record, current: Record) -> bool:
    """True if `current` can be written as a continuation segment of `prev`.

    Continuations skip the `---` separator and inherit section headers.
    Requirements:
    - Records share a @file (sections are about a single source)
    - Both have inline content (each segment is an excerpt)
    - Continuation has no @id of its own — the parser supports per-item @id,
      but the writer omits it to keep the compact form unambiguous.
    """
    if prev.file is None or current.file is None:
        return False
    return (
        _section_signature(prev) == _section_signature(current)
        and prev.has_inline_content()
        and current.has_inline_content()
        and current.id is None
        and current.reply_to is None
    )


def _write_continuation(record: Record) -> str:
    """Render a continuation segment: blank line, content, <<< feedback."""
    content_lines = record.content.split('\n')
    while content_lines and not content_lines[0].strip():
        content_lines.pop(0)
    while content_lines and not content_lines[-1].strip():
        content_lines.pop()
    return '\n'.join(['', '', *content_lines, f'<<< {_format_feedback(record.feedback)}'])


def _write_file_headers(
    version: bool = True,
    scope: Optional[list[str]] = None,
    covers: Optional[str] = None,
) -> str:
    """Write file-level % headers."""
    lines: list[str] = []
    if version:
        lines.append("%markback 2")
    if scope:
        lines.append(f"%scope {' '.join(scope)}")
    if covers:
        lines.append(f"%covers {covers}")
    return '\n'.join(lines)


def write(
    path,
    records: list[Record],
    compact: bool = False,
    scope: Optional[list[str]] = None,
    covers: Optional[str] = None,
    version_header: bool = True,
) -> None:
    """Write records to a file.

    Auto-detects format: uses compact when all records have @file and no inline content,
    or when compact=True. Otherwise uses multi-record format with --- separators.
    """
    path = Path(path)
    content = write_string(
        records,
        compact=compact,
        scope=scope,
        covers=covers,
        version_header=version_header,
    )
    _write_text_eol(path, content)


def write_string(
    records: list[Record],
    compact: bool = False,
    scope: Optional[list[str]] = None,
    covers: Optional[str] = None,
    version_header: bool = True,
) -> str:
    """Write records to a string."""
    if not records and not scope and not covers:
        return ""

    parts: list[str] = []

    # File-level headers
    file_header = _write_file_headers(
        version=version_header,
        scope=scope,
        covers=covers,
    )
    if file_header:
        parts.append(file_header)
        parts.append("")  # blank line after file headers

    # Auto-detect compact if not explicitly set
    auto_compact = compact or all(
        r.file is not None and not r.has_inline_content()
        for r in records
    )

    if not records:
        return '\n'.join(parts) + "\n"

    record_parts: list[str] = []
    prev_was_compact = False
    prev_record: Optional[Record] = None

    for i, record in enumerate(records):
        is_compact = (
            auto_compact
            and record.file is not None
            and not record.has_inline_content()
        )

        if i > 0 and prev_record is not None and _can_continue_section(prev_record, record):
            # Continuation segment: no `---`, no repeated headers.
            record_parts.append(_write_continuation(record))
        else:
            if i > 0:
                if is_compact and prev_was_compact:
                    record_parts.append("\n")
                else:
                    record_parts.append("\n---\n")
            record_parts.append(_write_record_canonical(record, prefer_compact=is_compact))

        prev_was_compact = is_compact
        prev_record = record

    parts.append(''.join(record_parts))

    return '\n'.join(parts) + "\n" if parts else ""


def append(
    path,
    record: Record,
    version_header: bool = True,
) -> None:
    """Append a record to an existing file, or create it."""
    from .parser import parse_file

    path = Path(path)

    if path.exists():
        existing = parse_file(path)
        all_records = existing.records + [record]
        # Preserve scope/covers from existing file
        write(
            path,
            all_records,
            scope=existing.scope,
            covers=existing.covers,
            version_header=version_header,
        )
    else:
        write(path, [record], version_header=version_header)


def normalize(
    path,
    in_place: bool = False,
    output_path=None,
) -> str:
    """Read a Markback file and write it in canonical V2 form."""
    from .parser import parse_file

    path = Path(path)
    result = parse_file(path)

    if result.has_errors:
        raise ValueError(f"Cannot normalize file with errors: {path}")

    content = write_string(
        result.records,
        scope=result.scope,
        covers=result.covers,
    )

    if output_path:
        _write_text_eol(Path(output_path), content)
    elif in_place:
        _write_text_eol(path, content)

    return content


# === V1 backward compatibility aliases ===

def write_record_canonical(record: Record, prefer_compact: bool = True) -> str:
    """V1 compat: write a single record in canonical format."""
    return _write_record_canonical(record, prefer_compact=prefer_compact)


def write_records_multi(records: list[Record], prefer_compact: bool = True) -> str:
    """V1 compat: write multiple records in multi-record format."""
    return write_string(records, compact=False, version_header=False)


def write_records_compact(records: list[Record]) -> str:
    """V1 compat: write records in compact format."""
    return write_string(records, compact=True, version_header=False)


def write_label_file(record: Record) -> str:
    """V1 compat: write a label file for sidecar mode."""
    lines: list[str] = []
    if record.id:
        lines.append(f"@id {record.id}")
    if record.reply_to:
        lines.append(f"@reply-to {record.reply_to}")
    if record.by:
        lines.append(f"@by {record.by}")
    if record.tags:
        lines.append(f"@tag {' '.join(record.tags)}")
    if record.input:
        lines.append(f"@input {record.input}")
    lines.append(f"<<< {_format_feedback(record.feedback)}")
    return '\n'.join(lines) + "\n"


def write_file(
    path: Path,
    records: list[Record],
    mode: OutputMode = OutputMode.MULTI,
    prefer_compact: bool = True,
) -> None:
    """V1 compat: write records to a file."""
    path = Path(path)

    if mode == OutputMode.SINGLE:
        if len(records) != 1:
            raise ValueError(f"SINGLE mode requires exactly 1 record, got {len(records)}")
        content = _write_record_canonical(records[0], prefer_compact=prefer_compact) + "\n"
    elif mode == OutputMode.MULTI:
        content = write_string(records, version_header=False)
    elif mode == OutputMode.COMPACT:
        content = write_string(records, compact=True, version_header=False)
    else:
        raise ValueError(f"Unknown output mode: {mode}")

    _write_text_eol(path, content)


def write_paired_files(
    label_path: Path,
    content_path: Optional[Path],
    record: Record,
    write_content: bool = False,
) -> None:
    """V1 compat: write paired label + content files."""
    label_content = write_label_file(record)
    _write_text_eol(Path(label_path), label_content)

    if write_content and content_path and record.content:
        _write_text_eol(Path(content_path), record.content)


def normalize_file(
    input_path: Path,
    output_path: Optional[Path] = None,
    in_place: bool = False,
) -> str:
    """V1 compat: normalize a file."""
    return normalize(input_path, in_place=in_place, output_path=output_path)
