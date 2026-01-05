"""MarkBack linter implementation."""

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
from .writer import write_record_canonical, write_records_multi


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

    # Check for unclosed quotes
    in_quote = False
    escaped = False

    for i, char in enumerate(feedback):
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


def lint_source_exists(
    record: Record,
    base_path: Optional[Path],
    record_idx: int,
) -> list[Diagnostic]:
    """Check if @source file exists."""
    diagnostics: list[Diagnostic] = []

    if record.source and not record.source.is_uri:
        try:
            resolved = record.source.resolve(base_path)
            if not resolved.exists():
                diagnostics.append(Diagnostic(
                    file=record._source_file,
                    line=record._start_line,
                    column=None,
                    severity=Severity.WARNING,
                    code=WarningCode.W003,
                    message=f"@source file not found: {record.source}",
                    record_index=record_idx,
                ))
        except ValueError:
            pass  # URI that can't be resolved to path

    return diagnostics


def lint_canonical_format(
    records: list[Record],
    original_text: str,
    file: Optional[Path],
) -> list[Diagnostic]:
    """Check if file is in canonical format."""
    diagnostics: list[Diagnostic] = []

    # Generate canonical version
    if len(records) == 1:
        canonical = write_record_canonical(records[0]) + "\n"
    else:
        canonical = write_records_multi(records)

    # Normalize line endings for comparison
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
    """Lint a MarkBack string.

    This runs the parser (which generates many diagnostics) and then
    performs additional linting checks.
    """
    # Parse first - this catches structural issues
    result = parse_string(text, source_file=source_file)

    # Additional linting for each record
    for idx, record in enumerate(result.records):
        # Lint JSON feedback
        result.diagnostics.extend(lint_feedback_json(
            record.feedback,
            source_file,
            record._end_line,  # Feedback is at end
            idx,
        ))

        # Lint structured feedback for unclosed quotes
        if not record.feedback.startswith("json:"):
            result.diagnostics.extend(lint_feedback_structured(
                record.feedback,
                source_file,
                record._end_line,
                idx,
            ))

        # Check source file existence
        if check_sources:
            base_path = source_file.parent if source_file else None
            result.diagnostics.extend(lint_source_exists(record, base_path, idx))

    # Check canonical format
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
        if path.is_dir():
            # Lint all .mb files in directory
            for mb_file in path.glob("**/*.mb"):
                results.append(lint_file(
                    mb_file,
                    check_sources=check_sources,
                    check_canonical=check_canonical,
                ))
            # Also lint .label.txt and .feedback.txt files
            for pattern in ["**/*.label.txt", "**/*.feedback.txt"]:
                for label_file in path.glob(pattern):
                    results.append(lint_file(
                        label_file,
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
    """Format diagnostics for output.

    Args:
        diagnostics: List of diagnostics to format
        format: Output format ("human" or "json")

    Returns:
        Formatted string
    """
    if format == "json":
        return json.dumps([d.to_dict() for d in diagnostics], indent=2)

    lines: list[str] = []
    for d in diagnostics:
        lines.append(str(d))

    return '\n'.join(lines)


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
