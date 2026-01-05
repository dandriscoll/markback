"""MarkBack: A compact format for content + feedback."""

from .types import (
    Diagnostic,
    ErrorCode,
    FeedbackParsed,
    ParseResult,
    Record,
    Severity,
    SourceRef,
    WarningCode,
    parse_feedback,
)
from .parser import (
    parse_file,
    parse_string,
    parse_paired_files,
    parse_directory,
    discover_paired_files,
)
from .writer import (
    OutputMode,
    normalize_file,
    write_file,
    write_record_canonical,
    write_records_multi,
    write_records_compact,
    write_label_file,
    write_paired_files,
)
from .linter import (
    lint_file,
    lint_files,
    lint_string,
    format_diagnostics,
    summarize_results,
)
from .config import (
    Config,
    LLMConfig,
    load_config,
    init_env,
)

__version__ = "0.1.0"

__all__ = [
    # Types
    "Diagnostic",
    "ErrorCode",
    "FeedbackParsed",
    "ParseResult",
    "Record",
    "Severity",
    "SourceRef",
    "WarningCode",
    "parse_feedback",
    # Parser
    "parse_file",
    "parse_string",
    "parse_paired_files",
    "parse_directory",
    "discover_paired_files",
    # Writer
    "OutputMode",
    "normalize_file",
    "write_file",
    "write_record_canonical",
    "write_records_multi",
    "write_records_compact",
    "write_label_file",
    "write_paired_files",
    # Linter
    "lint_file",
    "lint_files",
    "lint_string",
    "format_diagnostics",
    "summarize_results",
    # Config
    "Config",
    "LLMConfig",
    "load_config",
    "init_env",
    # Version
    "__version__",
]
