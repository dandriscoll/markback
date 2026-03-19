# MarkBack

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
    print(f"{record.uri}: {record.feedback}")

# Parse a string
text = """
@uri local:example

Some content here.
<<< positive; good quality
"""
result = parse_string(text)
```

### Write MarkBack files

```python
from markback import Record, SourceRef, write_file, OutputMode

records = [
    Record(feedback="good", uri="local:1", content="First item"),
    Record(feedback="bad", uri="local:2", content="Second item"),
]

# Write multi-record file
write_file("output.mb", records, mode=OutputMode.MULTI)

# Write compact label list
write_file("labels.mb", records, mode=OutputMode.COMPACT)
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

The CLI is available via two commands:
- `markback` - Full command name
- `mb` - Convenient shorthand (works on all platforms including Windows)

Both commands are functionally identical. Examples below use `mb`, but you can substitute `markback` anywhere.

### Annotate files

The primary use of `mb` is entering feedback. Files are positional arguments.

```bash
# Single file — inline feedback, appends to myfile.txt.mb
mb myfile.txt "good; clear writing"

# Single file with prior reference
mb myfile.txt "good" --prior prompt.txt

# Multiple files — same feedback for all, creates feedback.mb
mb *.jpg -f "approved"
mb *.jpg -f "approved" --prior prompt.txt

# Interactive mode (no -f), steps through each file
mb *.jpg
mb *.jpg --print              # print file contents before prompting
mb *.jpg --prior prompt.txt   # set @prior on all records
```

Interactive mode steps through each matched file and prompts for feedback:

```
[1/24] ./images/001.jpg
Feedback: approved; scene=beach
[2/24] ./images/002.jpg
Feedback:                          ← empty enter skips this file
[3/24] ./images/003.jpg
Feedback: rejected; too dark
Wrote 2 record(s) to ./images/feedback.mb
```

### Utility options

```bash
# Lint
mb --lint myfile.mb
mb --lint ./data/
mb --lint --json myfile.mb
mb --lint --no-source-check --no-canonical-check myfile.mb

# List records
mb --list myfile.mb
mb --list --json ./data/

# Normalize to canonical format
mb --normalize input.mb                      # stdout
mb --normalize -o output.mb input.mb         # to file
mb --normalize --in-place input.mb           # in place

# Convert between formats
mb --convert --to multi -o output.mb input.mb
mb --convert --to compact -o output.mb input.mb
mb --convert --to paired -o ./output_dir/ input.mb

# Initialize config
mb --init                    # create .env
mb --init --force            # overwrite existing
```

## File Formats

### Single Record

```
@uri local:example

Content goes here.
<<< positive; quality=high
```

### Multi-Record

```
@uri local:item-1

First content.
<<< good

---
@uri local:item-2

Second content.
<<< bad; needs improvement
```

### Compact Label List

```
@source ./images/001.jpg <<< approved; scene=beach
@source ./images/002.jpg <<< rejected; too dark
@source ./images/003.jpg <<< approved; scene=mountain
```

### With Prior Reference

Use `@prior` to reference an item that precedes the source (e.g., a prompt that generated an image):

```
@uri local:generated-001
@prior ./prompts/sunset-prompt.txt
@source ./images/generated-sunset.jpg <<< accurate; matches prompt well
```

### Paired Files

**content.txt:**
```
The actual content goes here.
```

**content.label.txt:**
```
@uri local:content-id
<<< approved; reviewer=alice
```

## Configuration

Configuration is loaded from `.env`:

```bash
# File handling mode
FILE_MODE=git  # or "versioned"

# Label file discovery
LABEL_SUFFIXES=.label.txt,.feedback.txt,.mb

# Editor LLM
EDITOR_API_BASE=https://api.openai.com/v1
EDITOR_API_KEY=your-key
EDITOR_MODEL=gpt-4

# Operator LLM
OPERATOR_API_BASE=https://api.openai.com/v1
OPERATOR_API_KEY=your-key
OPERATOR_MODEL=gpt-4
```

## Development

### Run tests

```bash
pip install -e ".[dev]"
pytest
```

### Run with coverage

```bash
pytest --cov=markback
```

## License

MIT
