# Writing Markback V2 (.mb) Files

Markback pairs content with single-line feedback using `<<<` as the delimiter.

## Minimal record

```
Some content here.
<<< positive
```

## Record with headers

```
@id item-001
@by reviewer@example.com
@file ./file.txt
@input ./prompt.txt
@tag review p1

Inline content goes here.
<<< good; quality=high
```

Headers: `@id`, `@by`, `@tag`, `@input`, `@file`. All optional. Order: id, by, tag, input, file.

## Rules

- `<<<` must be followed by one space then feedback text — all on one line
- A blank line is **required** between headers and inline content
- `@file` + inline content can coexist (file is provenance, content is snapshot)
- Records in multi-record files are separated by `---`
- Files must be UTF-8 with LF line endings
- `@id` values are plain strings (no URI validation)

## Compact format (one record per line)

```
@file ./images/001.jpg <<< approved; scene=beach
@file ./images/002.jpg <<< rejected; too dark
```

No `---` separator needed between compact records. `@id` can go on the line above:

```
@id item-001
@file ./file.txt <<< good
```

## Multi-record file

```
@id first

First content.
<<< positive

---
@id second

Second content.
<<< negative; needs work
```

## File-level headers (% prefix)

```
%markback 2
%scope issue-A issue-B
%covers ./gen/batch3/*.txt

@file ./gen/batch3/file2.txt <<< issue-B; tone is off
```

- `%markback 2` — version declaration
- `%scope` — what issues are being checked (sweep pattern)
- `%covers` — glob of all files reviewed (absence = clean for scope)

## Tags

```
@id item-001
@tag training positive-examples batch-2024-03
@file ./data/example.txt
<<< approved
```

Space-separated. Multiple `@tag` lines merge.

## Feedback format

Feedback is freeform text. Optional structured convention:

| Pattern | Meaning |
|---------|---------|
| `<<< positive` | label |
| `<<< negative; too vague` | label + comment |
| `<<< good; quality=high` | label + attribute |
| `<<< quality=high; confidence=0.9` | attributes only |
| `<<< json:{"key":"value"}` | JSON mode |

Segments are separated by `; ` (semicolon + space). Segments with `=` are key-value attributes; without are labels or comments.

## Sidecar files

Content in `name.ext`, annotation in `name.ext.mb`:

**report.pdf** — the content
**report.pdf.mb:**
```
@id report-001
<<< good; grade=B+
```

## Line/character ranges

`@file` and `@input` support position references:

```
@file ./code.py:42          ← line 42
@file ./code.py:42-50       ← lines 42–50
@file ./code.py:10:5-15:20  ← line 10 col 5 to line 15 col 20
```

## V1 backward compatibility

V1 headers (`@uri`, `@source`, `@prior`) are automatically mapped to V2 (`@id`, `@file`, `@input`) with a W010 warning.

## Quick checklist

- [ ] Every record has exactly one `<<<` line
- [ ] Feedback is a single line (no newlines)
- [ ] Blank line before inline content
- [ ] `---` between full records; not needed between compact records
- [ ] File ends with a newline
