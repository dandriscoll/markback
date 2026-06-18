"""Markback V2 parser implementation."""

import re
from pathlib import Path
from typing import Optional

from .types import (
    Action,
    Diagnostic,
    ErrorCode,
    FileRef,
    ParseResult,
    Record,
    Severity,
    WarningCode,
)


# V2 known header keywords
KNOWN_HEADERS = {"id", "by", "file", "input", "tag", "reply-to", "action"}

# V1 header mapping for backward compatibility
V1_HEADER_MAP = {"uri": "id", "source": "file", "prior": "input"}

# Patterns
HEADER_PATTERN = re.compile(r"^@([a-z][a-z-]*)\s+(.+)$")
FEEDBACK_DELIMITER = "<<<"
FENCE_MARKER = '"""'
RECORD_SEPARATOR = "---"
COMPACT_PATTERN = re.compile(r"^@file\s+(.+?)\s+<<<\s+(.*)$")
V1_COMPACT_PATTERN = re.compile(r"^@source\s+(.+?)\s+<<<\s+(.*)$")

# File-level header pattern (% prefix)
FILE_HEADER_PATTERN = re.compile(r"^%([a-z]+)\s*(.*)$")


class LineType:
    """Line classification types."""
    COMPACT_RECORD = "compact_record"
    HEADER = "header"
    FEEDBACK = "feedback"
    SEPARATOR = "separator"
    BLANK = "blank"
    CONTENT = "content"
    FILE_HEADER = "file_header"


def classify_line(line: str) -> str:
    """Classify a line according to Markback grammar."""
    stripped = line.rstrip()

    if not stripped:
        return LineType.BLANK

    if stripped == RECORD_SEPARATOR:
        return LineType.SEPARATOR

    # File-level headers: %markback, %scope, %covers
    if stripped.startswith("%"):
        return LineType.FILE_HEADER

    # Compact record: @file ... <<< or @source ... <<< (V1)
    if FEEDBACK_DELIMITER in stripped:
        if stripped.startswith("@file") or stripped.startswith("@source"):
            return LineType.COMPACT_RECORD

    # Header: @keyword value
    if stripped.startswith("@"):
        return LineType.HEADER

    # Feedback delimiter
    if stripped.startswith(FEEDBACK_DELIMITER):
        return LineType.FEEDBACK

    return LineType.CONTENT


def parse_header(line: str) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """Parse a header line. Returns (keyword, value, error_message)."""
    stripped = line.rstrip()
    match = HEADER_PATTERN.match(stripped)
    if not match:
        return None, None, f"Malformed header syntax: {stripped}"
    return match.group(1), match.group(2), None


def parse_action_value(value: str) -> tuple[Optional[Action], Optional[str]]:
    """Parse an @action header value: "<verb> <timestamp> [actor]".

    The actor is everything after the timestamp (may contain spaces), preserved
    verbatim. Returns (action, None) or (None, error_message) when fewer than two
    tokens are present.
    """
    trimmed = value.strip()
    parts = trimmed.split()
    if len(parts) < 2:
        return None, (
            f"Malformed @action (expected: <verb> <timestamp> [actor]): {trimmed}"
        )
    verb = parts[0]
    timestamp = parts[1]
    after_verb = trimmed[len(verb):].lstrip()
    actor_raw = after_verb[len(timestamp):].lstrip()
    return Action(verb=verb, timestamp=timestamp, actor=actor_raw or None), None


def _read_fence_body(lines: list[str], start_idx: int) -> tuple[str, int, bool]:
    # Read lines starting at start_idx until a closing triple-quote line.
    # Returns (body, next_idx, closed): body is the raw content without the
    # closing fence; next_idx is the line index *after* the closer (or
    # len(lines) if unclosed).
    body: list[str] = []
    i = start_idx
    while i < len(lines):
        if lines[i].rstrip() == FENCE_MARKER:
            return '\n'.join(body), i + 1, True
        body.append(lines[i])
        i += 1
    return '\n'.join(body), i, False


def parse_compact_record(line: str) -> tuple[Optional[FileRef], Optional[str], Optional[str], bool]:
    """Parse a compact record line. Returns (file_ref, feedback, error_message, is_v1)."""
    stripped = line.rstrip()

    # Try V2 format first
    match = COMPACT_PATTERN.match(stripped)
    if match:
        return FileRef(match.group(1)), match.group(2), None, False

    # Try V1 format
    match = V1_COMPACT_PATTERN.match(stripped)
    if match:
        return FileRef(match.group(1)), match.group(2), None, True

    return None, None, f"Invalid compact record syntax: {line}", False


def parse_string(
    text: str,
    source_file: Optional[Path] = None,
) -> ParseResult:
    """Parse a Markback string into records.

    Handles V1 and V2 formats, single-record, multi-record, and compact formats.
    Line endings are normalized first, so CRLF and CR inputs parse identically
    to LF (no stray carriage returns leak into content or trip whitespace checks).
    """
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    lines = text.split('\n')
    if lines and lines[-1] == '':
        lines = lines[:-1]

    records: list[Record] = []
    diagnostics: list[Diagnostic] = []

    # File-level metadata
    file_version: Optional[int] = None
    file_scope: Optional[list[str]] = None
    file_covers: Optional[str] = None

    def add_diagnostic(
        severity: Severity,
        code: ErrorCode | WarningCode,
        message: str,
        line_num: Optional[int] = None,
        col: Optional[int] = None,
        record_idx: Optional[int] = None,
    ):
        diagnostics.append(Diagnostic(
            file=source_file,
            line=line_num,
            column=col,
            severity=severity,
            code=code,
            message=message,
            record_index=record_idx,
        ))

    # State for parsing
    # section_headers carries forward across <<< boundaries within a section.
    # A `---` separator clears them. @id is per-record and never inherited.
    section_headers: dict[str, str] = {}
    current_headers: dict[str, str] = {}
    # Actions are per-record and order-preserving — NOT section-inherited and NOT
    # merged like tags. Reset whenever current_headers is reset.
    current_actions: list[Action] = []
    current_content_lines: list[str] = []
    current_start_line: int = 1
    pending_id: Optional[str] = None
    in_content: bool = False
    had_blank_line: bool = False
    past_file_headers: bool = False

    SECTION_INHERITED = ("file", "by", "tag", "input")

    def finalize_record(feedback: str, end_line: int):
        """Create a record from current state, then reset for next segment."""
        nonlocal current_headers, current_actions, current_content_lines, current_start_line
        nonlocal pending_id, in_content, had_blank_line, section_headers

        record_id = current_headers.get("id") or pending_id
        by = current_headers.get("by")
        reply_to = current_headers.get("reply-to")
        file_str = current_headers.get("file")
        file_ref = FileRef(file_str) if file_str else None
        input_str = current_headers.get("input")
        input_ref = FileRef(input_str) if input_str else None
        tag_str = current_headers.get("tag")
        tags = tag_str.split() if tag_str else []

        content = None
        if current_content_lines:
            content = '\n'.join(current_content_lines)
            content_lines = content.split('\n')
            while content_lines and not content_lines[0].strip():
                content_lines.pop(0)
            while content_lines and not content_lines[-1].strip():
                content_lines.pop()
            content = '\n'.join(content_lines) if content_lines else None

        record = Record(
            feedback=feedback,
            id=record_id,
            by=by,
            reply_to=reply_to,
            file=file_ref,
            input=input_ref,
            tags=tags,
            actions=current_actions,
            content=content,
            _source_file=source_file,
            _start_line=current_start_line,
            _end_line=end_line,
        )
        records.append(record)

        # Section headers: if not yet established, capture from the first
        # finalized record's headers. Per-segment headers (id) are excluded.
        if not section_headers:
            section_headers = {
                k: v for k, v in current_headers.items()
                if k in SECTION_INHERITED
            }

        # Reset state for the next segment, inheriting section headers.
        current_headers = section_headers.copy()
        current_actions = []
        current_content_lines = []
        current_start_line = end_line + 1
        pending_id = None
        in_content = False
        had_blank_line = False

    line_num = 0
    while line_num < len(lines):
        line = lines[line_num]
        line_num += 1
        line_type = classify_line(line)

        # Check for trailing whitespace
        if line.rstrip() != line.rstrip('\n'):
            if line != line.rstrip():
                add_diagnostic(
                    Severity.WARNING,
                    WarningCode.W004,
                    "Trailing whitespace",
                    line_num,
                )

        # File-level headers (must be at top of file, before any records)
        if line_type == LineType.FILE_HEADER:
            if past_file_headers:
                # Treat as content if we're past the header section
                in_content = True
                current_content_lines.append(line)
                continue

            stripped = line.rstrip()
            match = FILE_HEADER_PATTERN.match(stripped)
            if match:
                keyword = match.group(1)
                value = match.group(2).strip()

                if keyword == "markback":
                    try:
                        file_version = int(value)
                    except ValueError:
                        add_diagnostic(
                            Severity.ERROR,
                            ErrorCode.E006,
                            f"Invalid version in %markback: {value}",
                            line_num,
                        )
                elif keyword == "scope":
                    file_scope = value.split() if value else []
                elif keyword == "covers":
                    file_covers = value if value else None
                else:
                    add_diagnostic(
                        Severity.WARNING,
                        WarningCode.W002,
                        f"Unknown file-level header: %{keyword}",
                        line_num,
                    )
            continue

        # Once we see a non-file-header, non-blank line, we're past file headers
        if line_type != LineType.BLANK:
            past_file_headers = True

        if line_type == LineType.SEPARATOR:
            # `---` ends the section: clear inheritable headers entirely.
            # Error only if user added headers/content since last finalize.
            if current_content_lines or current_headers != section_headers:
                add_diagnostic(
                    Severity.ERROR,
                    ErrorCode.E001,
                    "Missing feedback (no <<< delimiter found)",
                    current_start_line,
                    record_idx=len(records),
                )
            section_headers = {}
            current_headers = {}
            current_actions = []
            current_start_line = line_num + 1
            pending_id = None
            in_content = False
            had_blank_line = False
            continue

        if line_type == LineType.BLANK:
            if current_headers and not in_content:
                had_blank_line = True
            elif in_content:
                current_content_lines.append("")
            continue

        if line_type == LineType.COMPACT_RECORD:
            file_ref, feedback, error, is_v1 = parse_compact_record(line)
            if error:
                add_diagnostic(
                    Severity.ERROR,
                    ErrorCode.E006,
                    error,
                    line_num,
                )
                continue

            if is_v1:
                add_diagnostic(
                    Severity.WARNING,
                    WarningCode.W010,
                    "V1 format detected: @source mapped to @file",
                    line_num,
                )

            end_line = line_num
            if feedback == FENCE_MARKER:
                feedback, new_line_num, closed = _read_fence_body(lines, line_num)
                if not closed:
                    add_diagnostic(
                        Severity.ERROR,
                        ErrorCode.E012,
                        'Unclosed fenced feedback block (missing """)',
                        line_num,
                    )
                if not feedback:
                    add_diagnostic(
                        Severity.ERROR,
                        ErrorCode.E009,
                        "Empty feedback (empty fenced block)",
                        line_num,
                    )
                end_line = new_line_num
                line_num = new_line_num
            elif feedback is not None and not feedback:
                add_diagnostic(
                    Severity.ERROR,
                    ErrorCode.E009,
                    "Empty feedback (nothing after <<< )",
                    line_num,
                )

            record_id = pending_id or current_headers.get("id")
            by = current_headers.get("by")
            reply_to = current_headers.get("reply-to")
            input_str = current_headers.get("input")
            input_ref = FileRef(input_str) if input_str else None
            tag_str = current_headers.get("tag")
            tags = tag_str.split() if tag_str else []

            record = Record(
                feedback=feedback or "",
                id=record_id,
                by=by,
                reply_to=reply_to,
                file=file_ref,
                input=input_ref,
                tags=tags,
                actions=current_actions,
                content=None,
                _source_file=source_file,
                _start_line=current_start_line,
                _end_line=end_line,
            )
            records.append(record)

            # Compact records also seed a section: subsequent records that
            # don't redeclare @file inherit it.
            if not section_headers:
                section_headers = {
                    k: v for k, v in current_headers.items()
                    if k in SECTION_INHERITED
                }
                # The compact line itself supplied @file:
                section_headers["file"] = str(file_ref)
            current_headers = section_headers.copy()
            current_actions = []
            current_content_lines = []
            current_start_line = end_line + 1
            pending_id = None
            in_content = False
            had_blank_line = False
            continue

        if line_type == LineType.HEADER:
            if had_blank_line or in_content:
                in_content = True
                current_content_lines.append(line)
                continue

            keyword, value, error = parse_header(line)
            if error:
                add_diagnostic(
                    Severity.ERROR,
                    ErrorCode.E006,
                    error,
                    line_num,
                )
                continue

            # V1 backward compat: map old header names
            if keyword in V1_HEADER_MAP:
                new_keyword = V1_HEADER_MAP[keyword]
                add_diagnostic(
                    Severity.WARNING,
                    WarningCode.W010,
                    f"V1 format detected: @{keyword} mapped to @{new_keyword}",
                    line_num,
                )
                keyword = new_keyword

            if keyword not in KNOWN_HEADERS:
                add_diagnostic(
                    Severity.WARNING,
                    WarningCode.W002,
                    f"Unknown header keyword: @{keyword}",
                    line_num,
                )

            if keyword == "id":
                pending_id = value

            # Actions accumulate into an ordered, per-record list (not the
            # single-value header map, not merged like tags, not inherited).
            if keyword == "action":
                action, action_err = parse_action_value(value or "")
                if action_err:
                    add_diagnostic(
                        Severity.WARNING,
                        WarningCode.W012,
                        action_err,
                        line_num,
                    )
                elif action:
                    current_actions.append(action)
                continue

            # Merge tags if multiple @tag lines
            if keyword == "tag" and "tag" in current_headers:
                current_headers["tag"] = current_headers["tag"] + " " + value
            else:
                current_headers[keyword] = value
            continue

        if line_type == LineType.FEEDBACK:
            stripped = line.rstrip()
            fence_end_line = line_num
            if stripped == FEEDBACK_DELIMITER:
                add_diagnostic(
                    Severity.ERROR,
                    ErrorCode.E009,
                    "Empty feedback (nothing after <<< )",
                    line_num,
                )
                feedback = ""
            elif stripped == FEEDBACK_DELIMITER + " " + FENCE_MARKER:
                feedback, new_line_num, closed = _read_fence_body(lines, line_num)
                if not closed:
                    add_diagnostic(
                        Severity.ERROR,
                        ErrorCode.E012,
                        'Unclosed fenced feedback block (missing """)',
                        line_num,
                    )
                if not feedback:
                    add_diagnostic(
                        Severity.ERROR,
                        ErrorCode.E009,
                        "Empty feedback (empty fenced block)",
                        line_num,
                    )
                fence_end_line = new_line_num
                line_num = new_line_num
            elif stripped.startswith(FEEDBACK_DELIMITER + " "):
                feedback = stripped[len(FEEDBACK_DELIMITER) + 1:]
            else:
                feedback = stripped[len(FEEDBACK_DELIMITER):].lstrip()

            # Check for missing blank line before content that starts with @
            if current_content_lines and not had_blank_line:
                first_content = current_content_lines[0] if current_content_lines else ""
                if first_content.startswith("@"):
                    add_diagnostic(
                        Severity.ERROR,
                        ErrorCode.E010,
                        "Missing blank line before inline content (content starts with @)",
                        current_start_line,
                        record_idx=len(records),
                    )

            finalize_record(feedback, fence_end_line)
            continue

        if line_type == LineType.CONTENT:
            in_content = True
            current_content_lines.append(line)
            continue

    # Check for unterminated record at end of file
    if current_content_lines or current_headers != section_headers:
        add_diagnostic(
            Severity.ERROR,
            ErrorCode.E001,
            "Missing feedback (no <<< delimiter found)",
            current_start_line,
            record_idx=len(records),
        )

    # Check for duplicate IDs
    seen_ids: dict[str, int] = {}
    for idx, record in enumerate(records):
        if record.id:
            if record.id in seen_ids:
                add_diagnostic(
                    Severity.WARNING,
                    WarningCode.W001,
                    f"Duplicate ID: {record.id} (first seen in record {seen_ids[record.id]})",
                    record._start_line,
                    record_idx=idx,
                )
            else:
                seen_ids[record.id] = idx

    # Check for missing IDs
    for idx, record in enumerate(records):
        if not record.id:
            add_diagnostic(
                Severity.WARNING,
                WarningCode.W006,
                "Missing @id (record has no identifier)",
                record._start_line,
                record_idx=idx,
            )

    return ParseResult(
        records=records,
        diagnostics=diagnostics,
        source_file=source_file,
        scope=file_scope,
        covers=file_covers,
        version=file_version,
    )


def parse_file(path: Path) -> ParseResult:
    """Parse a Markback file."""
    path = Path(path)
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return ParseResult(
            records=[],
            diagnostics=[
                Diagnostic(
                    file=path,
                    line=None,
                    column=None,
                    severity=Severity.ERROR,
                    code=ErrorCode.E006,
                    message="File is not valid UTF-8",
                )
            ],
            source_file=path,
        )

    return parse_string(text, source_file=path)


def discover_sidecars(
    directory: Path,
) -> list[tuple[Path, Path]]:
    """Discover content files and their sidecar .mb annotation files.

    V2 convention: content.ext -> content.ext.mb
    V1 legacy: also checks .label.txt, .feedback.txt, basename.mb

    Returns list of (content_file, sidecar_file) tuples.
    """
    directory = Path(directory)
    if not directory.is_dir():
        return []

    pairs: list[tuple[Path, Path]] = []
    all_files = set(directory.iterdir())

    # Identify sidecar .mb files (files ending in .ext.mb where .ext.mb content exists)
    mb_files = {f for f in all_files if f.is_file() and f.name.endswith(".mb")}
    v1_label_files = {
        f for f in all_files
        if f.is_file() and (f.name.endswith(".label.txt") or f.name.endswith(".feedback.txt"))
    }

    # V2: name.ext.mb -> name.ext
    for mb_file in mb_files:
        # Strip the .mb suffix to get potential content file name
        content_name = mb_file.name[:-3]  # Remove .mb
        if not content_name:
            continue
        content_file = directory / content_name
        if content_file.exists() and content_file.is_file() and content_file not in mb_files:
            pairs.append((content_file, mb_file))

    # V1 legacy: .label.txt and .feedback.txt
    for label_file in v1_label_files:
        if label_file.name.endswith(".label.txt"):
            basename = label_file.name[:-len(".label.txt")]
        else:
            basename = label_file.name[:-len(".feedback.txt")]

        # Find matching content file
        for f in all_files:
            if f.is_file() and f.stem == basename and f not in mb_files and f not in v1_label_files:
                pairs.append((f, label_file))
                break

    return pairs


# V1 backward compatibility aliases
discover_paired_files = discover_sidecars


def parse_directory(
    directory: Path,
    recursive: bool = False,
) -> ParseResult:
    """Parse all Markback files in a directory."""
    directory = Path(directory)
    all_records: list[Record] = []
    all_diagnostics: list[Diagnostic] = []

    mb_files = list(directory.glob("**/*.mb" if recursive else "*.mb"))

    for mb_file in mb_files:
        result = parse_file(mb_file)
        all_records.extend(result.records)
        all_diagnostics.extend(result.diagnostics)

    return ParseResult(
        records=all_records,
        diagnostics=all_diagnostics,
        source_file=directory,
    )
