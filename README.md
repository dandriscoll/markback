# MarkBack V2

A compact, human-writable format for storing content paired with feedback/labels.

## Installation

```bash
pip install -e .
```

## Quick Start

### Parse a MarkBack file

```python
from markback import parse_file, parse_string

# Parse a file
result = parse_file("labels.mb")
for record in result.records:
    print(f"{record.id}: {record.feedback}")

# Parse a string
text = """
@id example

Some content here.
<<< positive; good quality
"""
result = parse_string(text)
```

### Write MarkBack files

```python
from markback import Record, FileRef, write, append

# Write records to a file
records = [
    Record(feedback="good", id="item-1", content="First item"),
    Record(feedback="bad", id="item-2", content="Second item"),
]
write("output.mb", records)

# Append a single record
append("output.mb", Record(feedback="great", id="item-3", content="Third"))
```

### Lint files

```python
from markback import lint_file

result = lint_file("myfile.mb")
if result.has_errors:
    for d in result.diagnostics:
        print(d)
```

## CLI Usage

The CLI is available via `markback` or `mb` (shorthand).

### Annotate files

```bash
# Single file — inline feedback, appends to myfile.txt.mb
mb myfile.txt "good; clear writing"

# With input reference (what produced the file)
mb output.txt "accurate" --input prompt.txt

# With tags and attribution
mb file.txt "good" --tag "review p1" --by alice@example.com

# Multiple files — same feedback for all
mb *.jpg -f "approved"

# Interactive mode — steps through each file
mb *.jpg --print

# Sweep pattern — track issues across batches
mb *.txt -f "issue-A" --scope "issue-A issue-B" --covers "./*.txt"
```

### Utility commands

```bash
# Lint
mb --lint myfile.mb
mb --lint --json ./data/

# List records
mb --list myfile.mb

# Statistics
mb --stats myfile.mb

# Normalize to canonical format
mb --normalize input.mb
mb --normalize --in-place input.mb

# Convert between formats
mb --convert --to multi -o output.mb input.mb
mb --convert --to compact -o output.mb input.mb

# Upgrade V1 files to V2
mb --upgrade *.mb              # preview
mb --upgrade --apply --in-place *.mb  # apply

# Initialize config
mb --init
```

## File Format

### V2 Headers

| Header | Purpose |
|--------|---------|
| `@id` | Record identifier (plain string) |
| `@by` | Who provided feedback |
| `@tag` | Space-separated tags |
| `@input` | What produced the content (e.g., a prompt) |
| `@file` | Path to the content being annotated |

### File-level headers (% prefix)

```
%markback 2
%scope issue-A issue-B
%covers ./gen/batch3/*.txt
```

### Record examples

```
@id review-001
@by alice@company.com
@file ./src/auth.py:45-67
@tag security p0

<<< vulnerable; sql-injection in query builder
```

### Compact label list

```
@file ./images/001.jpg <<< approved; scene=beach
@file ./images/002.jpg <<< rejected; too dark
```

### Sidecar files

Content in `report.pdf`, annotation in `report.pdf.mb`:

```
@id report-001
<<< good; grade=B+
```

### Sweep pattern

Track issues across batches with meaningful absence:

```
%markback 2
%scope issue-A issue-B
%covers ./gen/batch3/*.txt

@file ./gen/batch3/file2.txt <<< issue-B; tone is off
@file ./gen/batch3/file5.txt <<< issue-A; issue-B; both problems
```

Files matching `%covers` without annotations are implicitly clean for all `%scope` items.

## V1 Backward Compatibility

V1 headers (`@uri`, `@source`, `@prior`) are automatically mapped to V2 equivalents with a W010 warning. The V2 parser reads V1 files transparently.

## Development

```bash
pip install -e ".[dev]"
pytest
```

## License

MIT
