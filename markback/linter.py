"""MarkBack V2 linter implementation."""

import json
from pathlib import Path
from typing import Optional

from .parser import parse_file, parse_string
from .types import (
    Diagnostic,
    ErrorCode,
    ParseResult,
    Record,
    Severity,
    WarningCode,
    parse_feedback,
)
from .writer import _write_record_canonical, write_string


def lint_feedback_json(
    feedback: str,
    file: Optional[Path],
    line: Optional[int],
    record_idx: Optional[int],
) -> list[Diagnostic]:
    """Lint JSON-formatted feedback."""
    diagnostics: list[Diagnostic] = []

    if feedback.startswith("json:"):
        json_str = feedback[5:]
        try:
            json.loads(json_str)
        except json.JSONDecodeError as e:
            diagnostics.append(Diagnostic(
                file=file,
                line=line,
                column=None,
                severity=Severity.ERROR,
                code=ErrorCode.E007,
                message=f"Invalid JSON after json: prefix: {e}",
                record_index=record_idx,
            ))

    return diagnostics


def lint_feedback_structured(
    feedback: str,
    file: Optional[Path],
    line: Optional[int],
    record_idx: Optional[int],
) -> list[Diagnostic]:
    """Lint structured feedback for unclosed quotes."""
    diagnostics: list[Diagnostic] = []

    in_quote = False
    escaped = False

    for char in feedback:
        if escaped:
            escaped = False
            continue
        if char == '\\':
            escaped = True
            continue
        if char == '"':
            in_quote = not in_quote

    if in_quote:
        diagnostics.append(Diagnostic(
            file=file,
            line=line,
            column=None,
            severity=Severity.ERROR,
            code=ErrorCode.E008,
            message="Unclosed quote in structured attribute value",
            record_index=record_idx,
        ))

    return diagnostics


def lint_file_exists(
    record: Record,
    base_path: Optional[Path],
    record_idx: int,
) -> list[Diagnostic]:
    """Check if @file reference exists."""
    diagnostics: list[Diagnostic] = []

    if record.file and not record.file.is_uri:
        try:
            resolved = record.file.resolve(base_path)
            if not resolved.exists():
                diagnostics.append(Diagnostic(
                    file=record._source_file,
                    line=record._start_line,
                    column=None,
                    severity=Severity.WARNING,
                    code=WarningCode.W003,
                    message=f"@file not found: {record.file}",
                    record_index=record_idx,
                ))
        except ValueError:
            pass

    return diagnostics


def lint_input_exists(
    record: Record,
    base_path: Optional[Path],
    record_idx: int,
) -> list[Diagnostic]:
    """Check if @input reference exists."""
    diagnostics: list[Diagnostic] = []

    if record.input and not record.input.is_uri:
        try:
            resolved = record.input.resolve(base_path)
            if not resolved.exists():
                diagnostics.append(Diagnostic(
                    file=record._source_file,
                    line=record._start_line,
                    column=None,
                    severity=Severity.WARNING,
                    code=WarningCode.W009,
                    message=f"@input not found: {record.input}",
                    record_index=record_idx,
                ))
        except ValueError:
            pass

    return diagnostics


# V1 compat aliases
lint_source_exists = lint_file_exists
lint_prior_exists = lint_input_exists


def _is_position_invalid(ref) -> tuple[bool, str]:
    """Check if a FileRef has an invalid position range."""
    if ref.start_line is None or ref.end_line is None:
        return False, ""

    if ref.end_line < ref.start_line:
        return True, f"end line {ref.end_line} is less than start line {ref.start_line}"

    if ref.end_line == ref.start_line:
        if (ref.start_column is not None and
            ref.end_column is not None and
            ref.end_column < ref.start_column):
            return True, f"end column {ref.end_column} is less than start column {ref.start_column} on line {ref.start_line}"

    return False, ""


def lint_line_range(
    record: Record,
    record_idx: int,
) -> list[Diagnostic]:
    """Check if line/character ranges are valid."""
    diagnostics: list[Diagnostic] = []

    if record.file and record.file.start_line is not None:
        is_invalid, error_msg = _is_position_invalid(record.file)
        if is_invalid:
            diagnostics.append(Diagnostic(
                file=record._source_file,
                line=record._start_line,
                column=None,
                severity=Severity.ERROR,
                code=ErrorCode.E011,
                message=f"Invalid range in @file: {error_msg}",
                record_index=record_idx,
            ))

    if record.input and record.input.start_line is not None:
        is_invalid, error_msg = _is_position_invalid(record.input)
        if is_invalid:
            diagnostics.append(Diagnostic(
                file=record._source_file,
                line=record._start_line,
                column=None,
                severity=Severity.ERROR,
                code=ErrorCode.E011,
                message=f"Invalid range in @input: {error_msg}",
                record_index=record_idx,
            ))

    return diagnostics


def lint_reply_to(
    records: list[Record],
    source_file: Optional[Path],
) -> list[Diagnostic]:
    """Check @reply-to targets: must point at an @id in the same file; no cycles."""
    diagnostics: list[Diagnostic] = []

    id_to_idx: dict[str, int] = {}
    for idx, record in enumerate(records):
        if record.id and record.id not in id_to_idx:
            id_to_idx[record.id] = idx

    for idx, record in enumerate(records):
        if not record.reply_to:
            continue

        if record.reply_to not in id_to_idx:
            diagnostics.append(Diagnostic(
                file=source_file,
                line=record._start_line,
                column=None,
                severity=Severity.WARNING,
                code=WarningCode.W011,
                message=f"@reply-to points at unknown id: {record.reply_to}",
                record_index=idx,
            ))
            continue

        # Walk up the chain to detect cycles.
        seen = {idx}
        cursor = id_to_idx[record.reply_to]
        while True:
            if cursor in seen:
                diagnostics.append(Diagnostic(
                    file=source_file,
                    line=record._start_line,
                    column=None,
                    severity=Severity.WARNING,
                    code=WarningCode.W011,
                    message=f"@reply-to forms a cycle through: {record.reply_to}",
                    record_index=idx,
                ))
                break
            seen.add(cursor)
            parent = records[cursor].reply_to
            if not parent or parent not in id_to_idx:
                break
            cursor = id_to_idx[parent]

    return diagnostics


def lint_canonical_format(
    records: list[Record],
    original_text: str,
    file: Optional[Path],
) -> list[Diagnostic]:
    """Check if file is in canonical format."""
    diagnostics: list[Diagnostic] = []

    canonical = write_string(records, version_header=False)
    original_normalized = original_text.replace('\r\n', '\n')

    if original_normalized != canonical:
        diagnostics.append(Diagnostic(
            file=file,
            line=1,
            column=None,
            severity=Severity.WARNING,
            code=WarningCode.W008,
            message="Non-canonical formatting detected",
        ))

    return diagnostics


def lint_string(
    text: str,
    source_file: Optional[Path] = None,
    check_sources: bool = True,
    check_canonical: bool = True,
) -> ParseResult:
    """Lint a MarkBack string."""
    result = parse_string(text, source_file=source_file)

    for idx, record in enumerate(result.records):
        result.diagnostics.extend(lint_feedback_json(
            record.feedback,
            source_file,
            record._end_line,
            idx,
        ))

        if not record.feedback.startswith("json:"):
            result.diagnostics.extend(lint_feedback_structured(
                record.feedback,
                source_file,
                record._end_line,
                idx,
            ))

        if check_sources:
            base_path = source_file.parent if source_file else None
            result.diagnostics.extend(lint_file_exists(record, base_path, idx))
            result.diagnostics.extend(lint_input_exists(record, base_path, idx))

        result.diagnostics.extend(lint_line_range(record, idx))

    result.diagnostics.extend(lint_reply_to(result.records, source_file))

    if check_canonical and result.records and not result.has_errors:
        result.diagnostics.extend(lint_canonical_format(
            result.records,
            text,
            source_file,
        ))

    return result


def lint_file(
    path: Path,
    check_sources: bool = True,
    check_canonical: bool = True,
) -> ParseResult:
    """Lint a MarkBack file."""
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
    except FileNotFoundError:
        return ParseResult(
            records=[],
            diagnostics=[
                Diagnostic(
                    file=path,
                    line=None,
                    column=None,
                    severity=Severity.ERROR,
                    code=ErrorCode.E006,
                    message="File not found",
                )
            ],
            source_file=path,
        )

    return lint_string(
        text,
        source_file=path,
        check_sources=check_sources,
        check_canonical=check_canonical,
    )


def lint_files(
    paths: list[Path],
    check_sources: bool = True,
    check_canonical: bool = True,
) -> list[ParseResult]:
    """Lint multiple MarkBack files."""
    results: list[ParseResult] = []

    for path in paths:
        path = Path(path)
        if path.is_dir():
            for mb_file in path.glob("**/*.mb"):
                results.append(lint_file(
                    mb_file,
                    check_sources=check_sources,
                    check_canonical=check_canonical,
                ))
        else:
            results.append(lint_file(
                path,
                check_sources=check_sources,
                check_canonical=check_canonical,
            ))

    return results


def format_diagnostics(
    diagnostics: list[Diagnostic],
    format: str = "human",
) -> str:
    """Format diagnostics for output."""
    if format == "json":
        return json.dumps([d.to_dict() for d in diagnostics], indent=2)

    return '\n'.join(str(d) for d in diagnostics)


def summarize_results(results: list[ParseResult]) -> dict:
    """Summarize lint results."""
    total_records = sum(len(r.records) for r in results)
    total_errors = sum(r.error_count for r in results)
    total_warnings = sum(r.warning_count for r in results)
    files_with_errors = sum(1 for r in results if r.has_errors)
    files_with_warnings = sum(1 for r in results if r.has_warnings)

    return {
        "files": len(results),
        "records": total_records,
        "errors": total_errors,
        "warnings": total_warnings,
        "files_with_errors": files_with_errors,
        "files_with_warnings": files_with_warnings,
    }
