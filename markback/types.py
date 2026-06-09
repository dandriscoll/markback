"""Core types for Markback V2 format."""

import re
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
    E003 = "E003"  # Malformed URI (kept for V1 compat, not emitted in V2)
    E004 = "E004"  # Content after <<< delimiter
    E005 = "E005"  # (V1 only: content with @source; in V2 @file+content coexist)
    E006 = "E006"  # Malformed header syntax
    E007 = "E007"  # Invalid JSON after json: prefix
    E008 = "E008"  # Unclosed quote in structured attribute value
    E009 = "E009"  # Empty feedback (nothing after <<< )
    E010 = "E010"  # Missing blank line before inline content
    E011 = "E011"  # Invalid line range (end < start)
    E012 = "E012"  # Unclosed fenced feedback block (""")


class WarningCode(Enum):
    """Lint warning codes (SHOULD fix)."""
    W001 = "W001"  # Duplicate ID within same file
    W002 = "W002"  # Unknown header keyword
    W003 = "W003"  # @file file not found
    W004 = "W004"  # Trailing whitespace on line
    W005 = "W005"  # Multiple blank lines
    W006 = "W006"  # Missing @id (record has no identifier)
    W007 = "W007"  # Paired feedback file not found
    W008 = "W008"  # Non-canonical formatting detected
    W009 = "W009"  # @input file not found
    W010 = "W010"  # V1 format detected
    W011 = "W011"  # @reply-to points at unknown id (or cycle)


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

    @property
    def is_error(self) -> bool:
        return self.severity == Severity.ERROR


# Regex to parse line/character range from a path
# Supports: path:line, path:line:col, path:line-line, path:line:col-line:col
_LINE_RANGE_PATTERN = re.compile(r'^(.+?):(\d+)(?::(\d+))?(?:-(\d+)(?::(\d+))?)?$')


@dataclass
class FileRef:
    """Reference to a file path or URI, optionally with line/col ranges."""
    value: str
    is_uri: bool = False
    start_line: Optional[int] = None
    end_line: Optional[int] = None
    start_column: Optional[int] = None
    end_column: Optional[int] = None
    _path_only: str = ""

    def __post_init__(self):
        self._parse_line_range()
        if not self.is_uri:
            parsed = urlparse(self._path_only)
            self.is_uri = bool(parsed.scheme) and len(parsed.scheme) > 1

    def _parse_line_range(self):
        """Parse optional line/character range from value."""
        match = _LINE_RANGE_PATTERN.match(self.value)
        if match:
            self._path_only = match.group(1)
            self.start_line = int(match.group(2))
            if match.group(3):
                self.start_column = int(match.group(3))
            if match.group(4):
                self.end_line = int(match.group(4))
                if match.group(5):
                    self.end_column = int(match.group(5))
            else:
                self.end_line = self.start_line
                self.end_column = self.start_column
        else:
            self._path_only = self.value

    @property
    def path(self) -> str:
        """Return path without line range."""
        return self._path_only

    @property
    def line_range_str(self) -> Optional[str]:
        """Return formatted line/character range string, or None if no range."""
        if self.start_line is None:
            return None

        if self.start_column is not None:
            start = f":{self.start_line}:{self.start_column}"
        else:
            start = f":{self.start_line}"

        if self.start_line == self.end_line and self.start_column == self.end_column:
            return start

        if self.end_column is not None:
            end = f"-{self.end_line}:{self.end_column}"
        else:
            end = f"-{self.end_line}"

        return f"{start}{end}"

    def resolve(self, base_path: Optional[Path] = None) -> Path:
        """Resolve to a file path (relative paths resolved against base_path)."""
        if self.is_uri:
            parsed = urlparse(self._path_only)
            if parsed.scheme == "file":
                return Path(parsed.path)
            raise ValueError(f"Cannot resolve non-file URI to path: {self.value}")

        path = Path(self._path_only)
        if path.is_absolute():
            return path
        if base_path:
            return base_path / path
        return path

    def __str__(self) -> str:
        return self.value

    def __eq__(self, other: object) -> bool:
        if isinstance(other, FileRef):
            return self.value == other.value
        return False

    def __hash__(self) -> int:
        return hash(self.value)


# V1 backward compatibility alias
SourceRef = FileRef


@dataclass
class Record:
    """A Markback record containing content and feedback."""
    feedback: str
    id: Optional[str] = None
    by: Optional[str] = None
    reply_to: Optional[str] = None
    file: Optional[FileRef] = None
    input: Optional[FileRef] = None
    tags: list[str] = field(default_factory=list)
    content: Optional[str] = None
    metadata: dict = field(default_factory=dict)

    # Parsing metadata (not part of logical record)
    _source_file: Optional[Path] = field(default=None, repr=False, compare=False)
    _start_line: Optional[int] = field(default=None, repr=False, compare=False)
    _end_line: Optional[int] = field(default=None, repr=False, compare=False)

    # V1 backward compatibility properties
    @property
    def uri(self) -> Optional[str]:
        return self.id

    @uri.setter
    def uri(self, value: Optional[str]):
        self.id = value

    @property
    def source(self) -> Optional[FileRef]:
        return self.file

    @source.setter
    def source(self, value: Optional[FileRef]):
        self.file = value

    @property
    def prior(self) -> Optional[FileRef]:
        return self.input

    @prior.setter
    def prior(self, value: Optional[FileRef]):
        self.input = value

    def get_identifier(self) -> Optional[str]:
        """Get the record identifier (ID or file path)."""
        if self.id:
            return self.id
        if self.file:
            return str(self.file)
        return None

    def has_inline_content(self) -> bool:
        """Check if record has inline content."""
        return self.content is not None and len(self.content.strip()) > 0

    def to_dict(self) -> dict:
        """Convert to JSON-serializable dict."""
        return {
            "id": self.id,
            "by": self.by,
            "reply_to": self.reply_to,
            "file": str(self.file) if self.file else None,
            "input": str(self.input) if self.input else None,
            "tags": self.tags,
            "content": self.content,
            "feedback": self.feedback,
            "metadata": self.metadata,
        }


@dataclass
class ParseResult:
    """Result of parsing a Markback file or set of files."""
    records: list[Record]
    diagnostics: list[Diagnostic]
    source_file: Optional[Path] = None
    scope: Optional[list[str]] = None
    covers: Optional[str] = None
    version: Optional[int] = None

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

    def covered_files(self, base_path: Optional[Path] = None) -> set[Path]:
        """Resolve the %covers glob to actual file paths."""
        if not self.covers:
            return set()
        import glob as glob_module
        base = base_path or (self.source_file.parent if self.source_file else Path("."))
        pattern = str(base / self.covers)
        return {Path(p) for p in glob_module.glob(pattern)}


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
            pass
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
            eq_pos = segment.index('=')
            key = segment[:eq_pos]
            value = segment[eq_pos + 1:]
            if value.startswith('"') and value.endswith('"'):
                value = value[1:-1].replace('\\"', '"').replace('\\\\', '\\')
            result.attributes[key] = value
        else:
            if result.label is None:
                result.label = segment
            else:
                if result.comment:
                    result.comment += "; " + segment
                else:
                    result.comment = segment

    return result
