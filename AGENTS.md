# Writing MarkBack (.mb) Files

MarkBack pairs content with single-line feedback using `<<<` as the delimiter.

## Minimal record

```
Some content here.
<<< positive
```

## Record with headers

```
@uri local:item-001
@by reviewer@example.com
@source ./file.txt
@prior ./prompt.txt

Inline content goes here.
<<< good; quality=high
```

Headers: `@uri`, `@by`, `@source`, `@prior`. All optional. Order: uri, by, prior, source.

## Rules

- `<<<` must be followed by one space then feedback text — all on one line
- A blank line is **required** between headers and inline content
- When `@source` is present, there must be **no** inline content
- Records in multi-record files are separated by `---`
- Files must be UTF-8 with LF line endings

## Compact format (one record per line)

```
@source ./images/001.jpg <<< approved; scene=beach
@source ./images/002.jpg <<< rejected; too dark
```

No `---` separator needed between compact records. `@uri` can go on the line above:

```
@uri local:item-001
@source ./file.txt <<< good
```

## Multi-record file

```
@uri local:first

First content.
<<< positive

---
@uri local:second

Second content.
<<< negative; needs work
```

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

## Paired files

Content in `name.ext`, feedback in `name.label.txt` (or `.feedback.txt` or `.mb`):

**essay.txt** — the content
**essay.label.txt:**
```
@uri local:essay-001
<<< good; grade=B+
```

## Line/character ranges

`@source` and `@prior` support position references:

```
@source ./code.py:42          ← line 42
@source ./code.py:42-50       ← lines 42–50
@source ./code.py:10:5-15:20  ← line 10 col 5 to line 15 col 20
```

## Quick checklist

- [ ] Every record has exactly one `<<<` line
- [ ] Feedback is a single line (no newlines)
- [ ] Blank line before inline content
- [ ] No inline content when `@source` is present
- [ ] `---` between full records; not needed between compact records
- [ ] File ends with a newline
