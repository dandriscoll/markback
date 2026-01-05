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

### Initialize configuration

```bash
markback init
```

Creates a `.env` file with all configuration options.

### Lint files

```bash
# Lint a single file
markback lint myfile.mb

# Lint a directory
markback lint ./data/

# JSON output
markback lint myfile.mb --json
```

### Normalize to canonical format

```bash
# Output to stdout
markback normalize input.mb

# Output to file
markback normalize input.mb output.mb

# In-place normalization
markback normalize input.mb --in-place
```

### List records

```bash
markback list myfile.mb
markback list ./data/ --json
```

### Convert between formats

```bash
# Convert to multi-record format
markback convert input.mb output.mb --to multi

# Convert to compact label list
markback convert input.mb output.mb --to compact

# Convert to paired files
markback convert input.mb ./output_dir/ --to paired
```

### Run LLM workflow

```bash
# Run editor/operator workflow
markback workflow run dataset.mb --prompt "Initial prompt" --output results.json

# View evaluation results
markback workflow evaluate results.json

# Extract refined prompt
markback workflow prompt results.json --output refined_prompt.txt
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
