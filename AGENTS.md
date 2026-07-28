# Writing Markback (.mb) files

Markback pairs content with single-line feedback using `<<<` as the delimiter.

This is the quickstart. For the full read/write manual — including the traps
that cost real time — load `skills/markback/SKILL.md`. `SPEC.md` is the
authority.

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

Headers: `@id`, `@reply-to`, `@by`, `@action`, `@tag`, `@input`, `@file`. All
optional, and that is also their canonical order.

## Rules

- `<<<` must be followed by one space then feedback text
- a blank line is **required** between headers and inline content — omit it and
  a content line starting with `@` is parsed as a header, and the content is
  silently dropped
- `@file` + inline content can coexist (file is provenance, content is snapshot)
- full records are separated by `---`, written directly after the preceding
  `<<<` line with no blank line before it
- files must be UTF-8 with LF line endings
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

Do not leave a blank line before those headers — in 0.3.0 that makes the parser
discard the record's own `@id`, `@by`, and `@tag` and inherit the previous
record's instead ([#15](https://github.com/dandriscoll/markback/issues/15)).
Pack compact records together, or separate them with `---`.

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

## Multi-segment section

Several comments on one source, without repeating the headers. Write successive
content + `<<<` pairs with no `---` between them; the first segment's `@file`,
`@by`, `@tag`, and `@input` carry to the rest.

```
@file ./essay.txt
@by dan

the lazy fox
<<< awkward

weak ending
<<< needs punch
```

That is two records, both on `./essay.txt`. A `---` ends the section. `@id`,
`@reply-to`, and `@action` are per-record and never inherited.

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

All `%` lines go at the very top, before any record.

## Tags

```
@id item-001
@tag training positive-examples batch-2024-03
@file ./data/example.txt
<<< approved
```

Space-separated. Multiple `@tag` lines merge.

## Threading and lifecycle

`@reply-to` carries the `@id` of the record being replied to:

```
@id c1
@file ./login.py:42 <<< this branch never fires
---
@id c2
@reply-to c1
@file ./login.py:42 <<< it does — covered by test_login_edge()
```

`@action <verb> <timestamp> [actor]` records a lifecycle event. Repeatable and
order-preserving; the well-known verbs are `created`, `viewed`, `resolved`,
`reopened`.

```
@action created 2026-06-17T10:00:00Z dan@example.com
@action resolved 2026-06-18T14:30:00Z Reviewer Two
```

A record is resolved when its most recent `resolved`/`reopened` action is
`resolved`.

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

## Multi-line feedback

When the text right after `<<< ` is exactly `"""`, the feedback runs until a
line whose only content is `"""`:

```
@id c1
@file ./login.py:42
<<< """
This branch looks dead, but I want to double-check before
suggesting removal.
"""
```

Use it only when the feedback genuinely contains a newline.

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

- [ ] every record has exactly one `<<<` line
- [ ] feedback is a single line, or fenced with `"""`
- [ ] blank line before inline content
- [ ] `---` between full records, no blank line before it; not needed between compact records
- [ ] file ends with a newline

Validate with `mb --lint file.mb`. Add `--no-canonical-check` if the file has
`%` headers — W008 always fires on those.

## Hard-won constraints

- **markback ships the same logic three times — a parser, linter, or writer bug fixed in one almost always exists in the others.** There is a Python library, a hand-ported JS library (`packages/markbackjs`), and a VS Code extension. Fix and regression-test every port in the same commit; a single-language fix leaves the class live.
- **When two syntaxes must parse identically, assert their EQUALITY, not each one's absolute output.** The durable guard against a silent-corruption parser bug is a convergence test — "blank separator == no separator == `---` produce identical records" — because per-syntax golden assertions can all be individually wrong in the same direction.
- **Constants duplicated across the ports get one generated source plus a drift test.** Warning codes, error codes, V1 header maps: define them in a single JSON source, generate the per-language modules, and add a test that fails when they diverge.
- **Header-emitting code MUST iterate the canonical order registry, never its own list.** `write_label_file` silently dropped `@action` precisely because it kept a hand-maintained header list. Any new code that emits headers consumes the registry.
- **Close the issue in the commit that ships the fix.** A fix shipped in v0.3.6 stayed open and was re-investigated in a later sweep. Use a closing keyword in the fix commit, or close immediately after push.