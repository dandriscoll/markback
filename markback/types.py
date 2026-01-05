"""Core types for MarkBack format."""

from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Optional, Union
from urllib.parse import urlparse


class Severity(Enum):
    """Diagnostic severity levels."""
    ERROR = "error"
    WARNING = "warning"


class ErrorCode(Enum):
    """Lint error codes (MUST fix)."""
    E001 = "E001"  # Missing feedback (no <<< delimiter found)
    E002 = "E002"  # Multiple <<< delimiters in one record
    E003 = "E003"  # Malformed URI in @uri header
    E004 = "E004"  # Content after <<< delimiter
    E005 = "E005"  # Content present when @source specified
    E006 = "E006"  # Malformed header syntax
    E007 = "E007"  # Invalid JSON after json: prefix
    E008 = "E008"  # Unclosed quote in structured attribute value
    E009 = "E009"  # Empty feedback (nothing after <<< )
    E010 = "E010"  # Missing blank line before inline content


class WarningCode(Enum):
    """Lint warning codes (SHOULD fix)."""
    W001 = "W001"  # Duplicate URI within same file
    W002 = "W002"  # Unknown header keyword
    W003 = "W003"  # @source file not found
    W004 = "W004"  # Trailing whitespace on line
    W005 = "W005"  # Multiple blank lines
    W006 = "W006"  # Missing @uri (record has no identifier)
    W007 = "W007"  # Paired feedback file not found
    W008 = "W008"  # Non-canonical formatting detected


@dataclass
class Diagnostic:
    """A lint diagnostic message."""
    file: Optional[Path]
    line: Optional[int]
    column: Optional[int]
    severity: Severity
    code: Union[ErrorCode, WarningCode]
    message: str
    record_index: Optional[int] = None

    def __str__(self) -> str:
        parts = []
        if self.file:
            parts.append(str(self.file))
        if self.line is not None:
            parts.append(str(self.line))
            if self.column is not None:
                parts.append(str(self.column))

        location = ":".join(parts) if parts else "<unknown>"
        return f"{location}: {self.code.value} {self.message}"

    def to_dict(self) -> dict:
        """Convert to JSON-serializable dict."""
        return {
            "file": str(self.file) if self.file else None,
            "line": self.line,
            "column": self.column,
            "severity": self.severity.value,
            "code": self.code.value,
            "message": self.message,
            "record_index": self.record_index,
        }


@dataclass
class SourceRef:
    """Reference to external content (file path or URI)."""
    value: str
    is_uri: bool = False

    def __post_init__(self):
        # Determine if this is a URI or file path
        if not self.is_uri:
            parsed = urlparse(self.value)
            # Consider it a URI if it has a scheme that's not a Windows drive letter
            self.is_uri = bool(parsed.scheme) and len(parsed.scheme) > 1

    def resolve(self, base_path: Optional[Path] = None) -> Path:
        """Resolve to a file path (relative paths resolved against base_path)."""
        if self.is_uri:
            parsed = urlparse(self.value)
            if parsed.scheme == "file":
                # file:// URI
                return Path(parsed.path)
            raise ValueError(f"Cannot resolve non-file URI to path: {self.value}")

        path = Path(self.value)
        if path.is_absolute():
            return path
        if base_path:
            return base_path / path
        return path

    def __str__(self) -> str:
        return self.value

    def __eq__(self, other: object) -> bool:
        if isinstance(other, SourceRef):
            return self.value == other.value
        return False

    def __hash__(self) -> int:
        return hash(self.value)


@dataclass
class Record:
    """A MarkBack record containing content and feedback."""
    feedback: str
    uri: Optional[str] = None
    source: Optional[SourceRef] = None
    content: Optional[str] = None
    metadata: dict = field(default_factory=dict)

    # Parsing metadata (not part of logical record)
    _source_file: Optional[Path] = field(default=None, repr=False, compare=False)
    _start_line: Optional[int] = field(default=None, repr=False, compare=False)
    _end_line: Optional[int] = field(default=None, repr=False, compare=False)
    _is_compact: bool = field(default=False, repr=False, compare=False)

    def __post_init__(self):
        # Validate: must have either content or source
        if self.content is None and self.source is None:
            # This is allowed - feedback-only record
            pass

    def get_identifier(self) -> Optional[str]:
        """Get the record identifier (URI or source path)."""
        if self.uri:
            return self.uri
        if self.source:
            return str(self.source)
        return None

    def has_inline_content(self) -> bool:
        """Check if record has inline content (vs external source)."""
        return self.content is not None and len(self.content.strip()) > 0

    def to_dict(self) -> dict:
        """Convert to JSON-serializable dict."""
        return {
            "uri": self.uri,
            "source": str(self.source) if self.source else None,
            "content": self.content,
            "feedback": self.feedback,
            "metadata": self.metadata,
        }


@dataclass
class ParseResult:
    """Result of parsing a MarkBack file or set of files."""
    records: list[Record]
    diagnostics: list[Diagnostic]
    source_file: Optional[Path] = None

    @property
    def has_errors(self) -> bool:
        return any(d.severity == Severity.ERROR for d in self.diagnostics)

    @property
    def has_warnings(self) -> bool:
        return any(d.severity == Severity.WARNING for d in self.diagnostics)

    @property
    def error_count(self) -> int:
        return sum(1 for d in self.diagnostics if d.severity == Severity.ERROR)

    @property
    def warning_count(self) -> int:
        return sum(1 for d in self.diagnostics if d.severity == Severity.WARNING)


@dataclass
class FeedbackParsed:
    """Parsed structured feedback."""
    raw: str
    label: Optional[str] = None
    attributes: dict = field(default_factory=dict)
    comment: Optional[str] = None
    is_json: bool = False
    json_data: Optional[dict] = None


def parse_feedback(feedback: str) -> FeedbackParsed:
    """Parse feedback string into structured components.

    Supports:
    - Simple label: "positive"
    - Label + comment: "negative; use more formal language"
    - Attributes: "sentiment=positive; confidence=0.9"
    - Mixed: "good; quality=high; needs more detail"
    - JSON: "json:{...}"
    """
    import json as json_module

    result = FeedbackParsed(raw=feedback)

    # Check for JSON mode
    if feedback.startswith("json:"):
        result.is_json = True
        try:
            result.json_data = json_module.loads(feedback[5:])
        except json_module.JSONDecodeError:
            pass  # Invalid JSON, leave as raw
        return result

    # Split on "; " (semicolon + space)
    segments = []
    current = []
    in_quotes = False
    i = 0

    while i < len(feedback):
        char = feedback[i]

        if char == '"' and (i == 0 or feedback[i-1] != '\\'):
            in_quotes = not in_quotes
            current.append(char)
        elif char == ';' and not in_quotes and i + 1 < len(feedback) and feedback[i + 1] == ' ':
            segments.append(''.join(current))
            current = []
            i += 1  # Skip the space after semicolon
        else:
            current.append(char)
        i += 1

    if current:
        segments.append(''.join(current))

    # Classify segments
    for segment in segments:
        segment = segment.strip()
        if not segment:
            continue

        if '=' in segment:
            # Key-value attribute
            eq_pos = segment.index('=')
            key = segment[:eq_pos]
            value = segment[eq_pos + 1:]
            # Remove quotes if present
            if value.startswith('"') and value.endswith('"'):
                value = value[1:-1].replace('\\"', '"').replace('\\\\', '\\')
            result.attributes[key] = value
        else:
            # Label or comment
            if result.label is None:
                result.label = segment
            else:
                # Additional non-attribute segment is a comment
                if result.comment:
                    result.comment += "; " + segment
                else:
                    result.comment = segment

    return result
