"""MarkBack parser implementation."""

import re
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

from .types import (
    Diagnostic,
    ErrorCode,
    ParseResult,
    Record,
    Severity,
    SourceRef,
    WarningCode,
)


# Known header keywords
KNOWN_HEADERS = {"uri", "source"}

# Patterns
HEADER_PATTERN = re.compile(r"^@([a-z]+)\s+(.+)$")
FEEDBACK_DELIMITER = "<<<"
RECORD_SEPARATOR = "---"
COMPACT_PATTERN = re.compile(r"^@source\s+(.+?)\s+<<<\s+(.*)$")


class LineType:
    """Line classification types."""
    COMPACT_RECORD = "compact_record"
    HEADER = "header"
    FEEDBACK = "feedback"
    SEPARATOR = "separator"
    BLANK = "blank"
    CONTENT = "content"


def classify_line(line: str) -> str:
    """Classify a line according to MarkBack grammar."""
    stripped = line.rstrip()

    # Blank line
    if not stripped:
        return LineType.BLANK

    # Record separator
    if stripped == RECORD_SEPARATOR:
        return LineType.SEPARATOR

    # Compact record: @source ... <<<
    if stripped.startswith("@source") and FEEDBACK_DELIMITER in stripped:
        return LineType.COMPACT_RECORD

    # Header: @keyword value
    if stripped.startswith("@"):
        return LineType.HEADER

    # Feedback delimiter
    if stripped.startswith(FEEDBACK_DELIMITER):
        return LineType.FEEDBACK

    # Everything else is content
    return LineType.CONTENT


def parse_header(line: str) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """Parse a header line. Returns (keyword, value, error_message)."""
    stripped = line.rstrip()
    match = HEADER_PATTERN.match(stripped)
    if not match:
        return None, None, f"Malformed header syntax: {stripped}"
    return match.group(1), match.group(2), None


def validate_uri(uri: str) -> Optional[str]:
    """Validate a URI. Returns error message if invalid."""
    try:
        result = urlparse(uri)
        # Must have a scheme
        if not result.scheme:
            return f"URI missing scheme: {uri}"
        return None
    except Exception as e:
        return f"Invalid URI: {uri} ({e})"


def parse_compact_record(line: str) -> tuple[Optional[SourceRef], Optional[str], Optional[str]]:
    """Parse a compact record line. Returns (source, feedback, error_message)."""
    match = COMPACT_PATTERN.match(line.rstrip())
    if not match:
        return None, None, f"Invalid compact record syntax: {line}"

    source_path = match.group(1)
    feedback = match.group(2)

    return SourceRef(source_path), feedback, None


def parse_string(
    text: str,
    source_file: Optional[Path] = None,
) -> ParseResult:
    """Parse a MarkBack string into records.

    Handles single-record, multi-record, and compact formats.
    """
    lines = text.split('\n')
    # Remove trailing empty line if present (from final newline)
    if lines and lines[-1] == '':
        lines = lines[:-1]

    records: list[Record] = []
    diagnostics: list[Diagnostic] = []

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
    current_headers: dict[str, str] = {}
    current_content_lines: list[str] = []
    current_start_line: int = 1
    pending_uri: Optional[str] = None  # For compact records with preceding @uri
    in_content: bool = False
    had_blank_line: bool = False

    def finalize_record(feedback: str, end_line: int, is_compact: bool = False):
        """Create a record from current state."""
        nonlocal current_headers, current_content_lines, current_start_line
        nonlocal pending_uri, in_content, had_blank_line

        uri = current_headers.get("uri") or pending_uri
        source_str = current_headers.get("source")
        source = SourceRef(source_str) if source_str else None

        content = None
        if current_content_lines:
            content = '\n'.join(current_content_lines)
            # Trim leading/trailing blank lines from content
            content_lines = content.split('\n')
            while content_lines and not content_lines[0].strip():
                content_lines.pop(0)
            while content_lines and not content_lines[-1].strip():
                content_lines.pop()
            content = '\n'.join(content_lines) if content_lines else None

        record = Record(
            feedback=feedback,
            uri=uri,
            source=source,
            content=content,
            _source_file=source_file,
            _start_line=current_start_line,
            _end_line=end_line,
            _is_compact=is_compact,
        )
        records.append(record)

        # Reset state
        current_headers = {}
        current_content_lines = []
        current_start_line = end_line + 1
        pending_uri = None
        in_content = False
        had_blank_line = False

    line_num = 0
    while line_num < len(lines):
        line = lines[line_num]
        line_num += 1  # 1-indexed for diagnostics
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

        if line_type == LineType.SEPARATOR:
            # Record separator - finalize any pending record
            if current_headers or current_content_lines:
                # Missing feedback
                add_diagnostic(
                    Severity.ERROR,
                    ErrorCode.E001,
                    "Missing feedback (no <<< delimiter found)",
                    current_start_line,
                    record_idx=len(records),
                )
            current_start_line = line_num + 1
            pending_uri = None
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
            # Compact record: @source ... <<<
            source, feedback, error = parse_compact_record(line)
            if error:
                add_diagnostic(
                    Severity.ERROR,
                    ErrorCode.E006,
                    error,
                    line_num,
                )
                continue

            if feedback is not None and not feedback:
                add_diagnostic(
                    Severity.ERROR,
                    ErrorCode.E009,
                    "Empty feedback (nothing after <<< )",
                    line_num,
                )

            # Use any pending @uri from previous line
            uri = pending_uri or current_headers.get("uri")

            record = Record(
                feedback=feedback or "",
                uri=uri,
                source=source,
                content=None,
                _source_file=source_file,
                _start_line=current_start_line,
                _end_line=line_num,
                _is_compact=True,
            )
            records.append(record)

            # Reset state
            current_headers = {}
            current_content_lines = []
            current_start_line = line_num + 1
            pending_uri = None
            in_content = False
            had_blank_line = False
            continue

        if line_type == LineType.HEADER:
            # If we've seen a blank line, treat @-starting lines as content
            # (content that starts with @ requires the blank line separator)
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

            if keyword not in KNOWN_HEADERS:
                add_diagnostic(
                    Severity.WARNING,
                    WarningCode.W002,
                    f"Unknown header keyword: @{keyword}",
                    line_num,
                )

            if keyword == "uri":
                uri_error = validate_uri(value)
                if uri_error:
                    add_diagnostic(
                        Severity.ERROR,
                        ErrorCode.E003,
                        uri_error,
                        line_num,
                    )
                # Check if next non-blank line is compact record
                # Store as pending_uri for potential compact record
                pending_uri = value

            current_headers[keyword] = value
            continue

        if line_type == LineType.FEEDBACK:
            # Extract feedback content
            stripped = line.rstrip()
            if stripped == FEEDBACK_DELIMITER:
                add_diagnostic(
                    Severity.ERROR,
                    ErrorCode.E009,
                    "Empty feedback (nothing after <<< )",
                    line_num,
                )
                feedback = ""
            elif stripped.startswith(FEEDBACK_DELIMITER + " "):
                feedback = stripped[len(FEEDBACK_DELIMITER) + 1:]
            else:
                # <<< with content but no space - try to parse anyway
                feedback = stripped[len(FEEDBACK_DELIMITER):].lstrip()

            # Check for content when @source is present
            if current_headers.get("source") and current_content_lines:
                content_text = '\n'.join(current_content_lines).strip()
                if content_text:
                    add_diagnostic(
                        Severity.ERROR,
                        ErrorCode.E005,
                        "Content present when @source specified",
                        current_start_line,
                        record_idx=len(records),
                    )

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

            finalize_record(feedback, line_num)
            continue

        if line_type == LineType.CONTENT:
            in_content = True
            current_content_lines.append(line)
            continue

    # Check for unterminated record at end of file
    if current_headers or current_content_lines:
        add_diagnostic(
            Severity.ERROR,
            ErrorCode.E001,
            "Missing feedback (no <<< delimiter found)",
            current_start_line,
            record_idx=len(records),
        )

    # Check for duplicate URIs
    seen_uris: dict[str, int] = {}
    for idx, record in enumerate(records):
        if record.uri:
            if record.uri in seen_uris:
                add_diagnostic(
                    Severity.WARNING,
                    WarningCode.W001,
                    f"Duplicate URI: {record.uri} (first seen in record {seen_uris[record.uri]})",
                    record._start_line,
                    record_idx=idx,
                )
            else:
                seen_uris[record.uri] = idx

    # Check for missing URIs
    for idx, record in enumerate(records):
        if not record.uri:
            add_diagnostic(
                Severity.WARNING,
                WarningCode.W006,
                "Missing @uri (record has no identifier)",
                record._start_line,
                record_idx=idx,
            )

    return ParseResult(
        records=records,
        diagnostics=diagnostics,
        source_file=source_file,
    )


def parse_file(path: Path) -> ParseResult:
    """Parse a MarkBack file."""
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


def discover_paired_files(
    directory: Path,
    content_patterns: Optional[list[str]] = None,
    label_suffixes: Optional[list[str]] = None,
) -> list[tuple[Path, Optional[Path]]]:
    """Discover content files and their paired label files.

    Returns list of (content_file, label_file) tuples.
    label_file may be None if not found.
    """
    if label_suffixes is None:
        label_suffixes = [".label.txt", ".feedback.txt", ".mb"]

    if content_patterns is None:
        content_patterns = ["*"]

    pairs: list[tuple[Path, Optional[Path]]] = []

    # Find all files in directory
    all_files = set(directory.iterdir()) if directory.is_dir() else set()

    # Identify label files
    label_files = set()
    for f in all_files:
        for suffix in label_suffixes:
            if f.name.endswith(suffix):
                label_files.add(f)
                break

    # Content files are everything else (excluding label files and hidden files)
    content_files = [
        f for f in all_files
        if f.is_file()
        and f not in label_files
        and not f.name.startswith(".")
    ]

    for content_file in content_files:
        # Look for corresponding label file
        label_file = None
        basename = content_file.stem  # filename without extension

        for suffix in label_suffixes:
            candidate = directory / (basename + suffix)
            if candidate.exists():
                label_file = candidate
                break

            # Also try with full name (for extensionless files)
            candidate = directory / (content_file.name + suffix)
            if candidate.exists():
                label_file = candidate
                break

        pairs.append((content_file, label_file))

    return pairs


def parse_paired_files(
    content_file: Path,
    label_file: Path,
) -> ParseResult:
    """Parse a paired content + label file combination."""
    diagnostics: list[Diagnostic] = []

    # Parse the label file
    label_result = parse_file(label_file)
    diagnostics.extend(label_result.diagnostics)

    if not label_result.records:
        return ParseResult(
            records=[],
            diagnostics=diagnostics,
            source_file=label_file,
        )

    # In paired mode, the label file should have exactly one record
    # with no inline content (content comes from the paired file)
    record = label_result.records[0]

    # Set the source to the content file
    if record.source is None:
        record.source = SourceRef(str(content_file))

    # The content should come from the content file
    if record.content:
        diagnostics.append(Diagnostic(
            file=label_file,
            line=record._start_line,
            column=None,
            severity=Severity.WARNING,
            code=WarningCode.W008,
            message="Paired label file should not contain inline content",
        ))

    # Load content from content file if it's text
    try:
        record.content = content_file.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        # Binary file - leave content as None, source points to file
        record.content = None

    record._source_file = label_file

    return ParseResult(
        records=[record],
        diagnostics=diagnostics,
        source_file=label_file,
    )


def parse_directory(
    directory: Path,
    label_suffixes: Optional[list[str]] = None,
    recursive: bool = False,
) -> ParseResult:
    """Parse all MarkBack files in a directory.

    Handles both standalone .mb files and paired file mode.
    """
    if label_suffixes is None:
        label_suffixes = [".label.txt", ".feedback.txt", ".mb"]

    all_records: list[Record] = []
    all_diagnostics: list[Diagnostic] = []

    # Find all .mb files (standalone MarkBack files)
    mb_files = list(directory.glob("**/*.mb" if recursive else "*.mb"))

    for mb_file in mb_files:
        # Check if this is a label file (paired mode)
        is_label_file = False
        for suffix in label_suffixes:
            if mb_file.name.endswith(suffix) and suffix != ".mb":
                is_label_file = True
                break

        if not is_label_file:
            result = parse_file(mb_file)
            all_records.extend(result.records)
            all_diagnostics.extend(result.diagnostics)

    # Find paired files
    pairs = discover_paired_files(directory, label_suffixes=label_suffixes)
    for content_file, label_file in pairs:
        if label_file:
            result = parse_paired_files(content_file, label_file)
            all_records.extend(result.records)
            all_diagnostics.extend(result.diagnostics)
        else:
            all_diagnostics.append(Diagnostic(
                file=content_file,
                line=None,
                column=None,
                severity=Severity.WARNING,
                code=WarningCode.W007,
                message=f"Paired feedback file not found for {content_file.name}",
            ))

    return ParseResult(
        records=all_records,
        diagnostics=all_diagnostics,
        source_file=directory,
    )
