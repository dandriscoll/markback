"""MarkBack V2: A compact format for content + feedback."""

from .types import (
    Diagnostic,
    ErrorCode,
    FeedbackParsed,
    FileRef,
    ParseResult,
    Record,
    Severity,
    SourceRef,  # V1 compat alias
    WarningCode,
    parse_feedback,
)
from .parser import (
    parse_file,
    parse_string,
    parse_directory,
    discover_sidecars,
    discover_paired_files,  # V1 compat alias
)
from .writer import (
    OutputMode,
    append,
    normalize,
    normalize_file,  # V1 compat alias
    write,
    write_file,  # V1 compat
    write_label_file,  # V1 compat
    write_paired_files,  # V1 compat
    write_record_canonical,  # V1 compat
    write_records_compact,  # V1 compat
    write_records_multi,  # V1 compat
    write_string,
)
from .linter import (
    lint_file,
    lint_files,
    lint_string,
    format_diagnostics,
    summarize_results,
)

__version__ = "0.2.1"

__all__ = [
    # V2 Types
    "Diagnostic",
    "ErrorCode",
    "FeedbackParsed",
    "FileRef",
    "ParseResult",
    "Record",
    "Severity",
    "WarningCode",
    "parse_feedback",
    # V1 compat alias
    "SourceRef",
    # Parser
    "parse_file",
    "parse_string",
    "parse_directory",
    "discover_sidecars",
    "discover_paired_files",  # V1 compat
    # Writer
    "OutputMode",
    "append",
    "normalize",
    "write",
    "write_string",
    # V1 compat writer
    "normalize_file",
    "write_file",
    "write_label_file",
    "write_paired_files",
    "write_record_canonical",
    "write_records_compact",
    "write_records_multi",
    # Linter
    "lint_file",
    "lint_files",
    "lint_string",
    "format_diagnostics",
    "summarize_results",
    # Version
    "__version__",
]
