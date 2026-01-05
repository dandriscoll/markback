"""MarkBack canonical writer implementation."""

from enum import Enum
from pathlib import Path
from typing import Optional

from .types import Record, SourceRef


class OutputMode(Enum):
    """Output format modes."""
    SINGLE = "single"      # One record per file
    MULTI = "multi"        # Multiple records in one file
    COMPACT = "compact"    # Compact label list format
    PAIRED = "paired"      # Separate content and label files


def write_record_canonical(
    record: Record,
    prefer_compact: bool = True,
) -> str:
    """Write a single record in canonical format.

    Args:
        record: The record to write
        prefer_compact: If True, use compact format when possible (source + no content)

    Returns:
        Canonical string representation
    """
    lines: list[str] = []

    # Determine if we should use compact format
    use_compact = (
        prefer_compact
        and record.source is not None
        and not record.has_inline_content()
    )

    if use_compact:
        # Compact format: @uri on its own line (if present), then @source ... <<<
        if record.uri:
            lines.append(f"@uri {record.uri}")
        lines.append(f"@source {record.source} <<< {record.feedback}")
    else:
        # Full format
        # Headers: @uri first, then @source
        if record.uri:
            lines.append(f"@uri {record.uri}")
        if record.source:
            lines.append(f"@source {record.source}")

        # Content block (with blank line if content present)
        if record.has_inline_content():
            lines.append("")  # Blank line before content
            # Normalize content: trim leading/trailing blank lines
            content_lines = record.content.split('\n')
            while content_lines and not content_lines[0].strip():
                content_lines.pop(0)
            while content_lines and not content_lines[-1].strip():
                content_lines.pop()
            lines.extend(content_lines)

        # Feedback line
        lines.append(f"<<< {record.feedback}")

    return '\n'.join(lines)


def write_records_multi(
    records: list[Record],
    prefer_compact: bool = True,
) -> str:
    """Write multiple records in multi-record format.

    Args:
        records: List of records to write
        prefer_compact: If True, use compact format when possible

    Returns:
        Canonical multi-record string
    """
    if not records:
        return ""

    result_parts: list[str] = []
    prev_was_compact = False

    for i, record in enumerate(records):
        is_compact = (
            prefer_compact
            and record.source is not None
            and not record.has_inline_content()
        )

        # Add separator between records
        if i > 0:
            # Compact records in sequence don't need separators
            if is_compact and prev_was_compact:
                result_parts.append("\n")
            else:
                # Add blank line then separator then newline
                result_parts.append("\n---\n")

        record_str = write_record_canonical(record, prefer_compact=prefer_compact)
        result_parts.append(record_str)
        prev_was_compact = is_compact

    return ''.join(result_parts) + "\n"


def write_records_compact(records: list[Record]) -> str:
    """Write records in compact label list format.

    All records are written as single-line @source ... <<< entries.
    Records without source will have source derived from URI or index.
    """
    lines: list[str] = []

    for i, record in enumerate(records):
        if record.uri and record.source:
            lines.append(f"@uri {record.uri}")
            lines.append(f"@source {record.source} <<< {record.feedback}")
            lines.append("")  # Blank line for grouping
        elif record.source:
            lines.append(f"@source {record.source} <<< {record.feedback}")
        else:
            # No source - need to create a placeholder or use full format
            if record.uri:
                lines.append(f"@uri {record.uri}")
            if record.has_inline_content():
                # Can't use compact for this record
                lines.append("")
                lines.extend(record.content.split('\n'))
            lines.append(f"<<< {record.feedback}")

    # Remove trailing empty lines and add final newline
    while lines and not lines[-1]:
        lines.pop()

    return '\n'.join(lines) + "\n" if lines else ""


def write_label_file(record: Record) -> str:
    """Write a label file for paired mode (no content, just headers + feedback)."""
    lines: list[str] = []

    if record.uri:
        lines.append(f"@uri {record.uri}")

    lines.append(f"<<< {record.feedback}")

    return '\n'.join(lines) + "\n"


def write_file(
    path: Path,
    records: list[Record],
    mode: OutputMode = OutputMode.MULTI,
    prefer_compact: bool = True,
) -> None:
    """Write records to a file.

    Args:
        path: Output file path
        records: Records to write
        mode: Output format mode
        prefer_compact: For MULTI mode, prefer compact format when possible
    """
    if mode == OutputMode.SINGLE:
        if len(records) != 1:
            raise ValueError(f"SINGLE mode requires exactly 1 record, got {len(records)}")
        content = write_record_canonical(records[0], prefer_compact=prefer_compact) + "\n"

    elif mode == OutputMode.MULTI:
        content = write_records_multi(records, prefer_compact=prefer_compact)

    elif mode == OutputMode.COMPACT:
        content = write_records_compact(records)

    elif mode == OutputMode.PAIRED:
        if len(records) != 1:
            raise ValueError(f"PAIRED mode requires exactly 1 record, got {len(records)}")
        content = write_label_file(records[0])

    else:
        raise ValueError(f"Unknown output mode: {mode}")

    path.write_text(content, encoding="utf-8")


def write_paired_files(
    label_path: Path,
    content_path: Optional[Path],
    record: Record,
    write_content: bool = False,
) -> None:
    """Write paired label + content files.

    Args:
        label_path: Path for the label file
        content_path: Path for the content file (optional)
        record: The record to write
        write_content: If True, write content to content_path (only for text content)
    """
    # Write label file
    label_content = write_label_file(record)
    label_path.write_text(label_content, encoding="utf-8")

    # Optionally write content file
    if write_content and content_path and record.content:
        content_path.write_text(record.content, encoding="utf-8")


def normalize_file(
    input_path: Path,
    output_path: Optional[Path] = None,
    in_place: bool = False,
) -> str:
    """Read a MarkBack file and write it in canonical form.

    Args:
        input_path: Input file path
        output_path: Output file path (if None and in_place=True, overwrites input)
        in_place: If True and output_path is None, overwrite input file

    Returns:
        The canonical content
    """
    from .parser import parse_file

    result = parse_file(input_path)

    if result.has_errors:
        raise ValueError(f"Cannot normalize file with errors: {input_path}")

    # Determine output format based on input
    if len(result.records) == 1:
        content = write_record_canonical(result.records[0]) + "\n"
    else:
        content = write_records_multi(result.records)

    # Write output
    if output_path:
        output_path.write_text(content, encoding="utf-8")
    elif in_place:
        input_path.write_text(content, encoding="utf-8")

    return content
