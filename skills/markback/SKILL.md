---
name: markback
description: Load when reading or writing a Markback file — a `.mb` or a `name.ext.mb` sidecar carrying feedback on code, prose, data, or images. A record is optional `@` headers, then an optional blank line and content, then exactly one `<<< feedback` line that ends it; the blank line before inline content is MANDATORY, because a content line starting with `@` written without it is parsed as a header and the content is silently discarded with only a warning. Feedback is one line unless fenced with `<<< """`. Markback is hand-writable — write it directly, no tooling required; the `mb` CLI and the Python/JS libraries are for lint, normalize, and bulk work. Covers headers, the four layouts (full, compact, multi-segment section, sidecar), `%` file headers, position ranges, structured feedback, canonical form, and lint codes.
license: MIT
---

# Markback

The read/write manual for the Markback format at spec **v0.3.0** (format
version `2`). Markback pairs a piece of content with a single line of feedback,
in plain text that diffs in git. This file covers reading and writing the format
by hand; the CLI flags, the Python and Node APIs, and the VS Code extension are
in `references/tooling.md`.

**Write it by hand.** The format exists to be typed into a text editor. Reach
for tooling only for lint, normalize, bulk labeling, or when a library is
already in the loop.

## Critical links

| What | Where |
|---|---|
| Specification (authoritative) | https://markback.org/format/spec |
| Format overview | https://markback.org/format/ |
| Get started / examples | https://markback.org/get-started · https://markback.org/examples |
| Browser editor (no install) | https://markback.org/try-it · https://markback.org/editor |
| Source, issues | https://github.com/dandriscoll/markback |
| Python package + CLI | `pip install markback` → https://pypi.org/project/markback/ |
| Node/TS package | `npm install markbackjs` → https://www.npmjs.com/package/markbackjs |
| VS Code extension | Marketplace id `dandriscoll.markback-vscode` — https://markback.org/vscode |
| CLI / Python / Node how-tos | https://markback.org/cli · /python · /nodejs |

In a checkout of the repo, `SPEC.md` at its root is the authority; `README.md`
and `AGENTS.md` lag it and do not yet describe `@reply-to`, `@action`, fenced
feedback, or multi-segment sections.

## The record

One record = **optional headers → optional (blank line + content) → exactly one
feedback line**. The `<<<` line *is* the record terminator; there is no closing
token.

```
@id review-001
@by alice@company.com
@tag security p0
@file ./src/auth.py:45-67

def build_query(user_input):
    return f"SELECT * FROM t WHERE u='{user_input}'"
<<< vulnerable; sql-injection in query builder
```

Every field but `feedback` is optional. A bare content block plus a `<<<` line
is a valid record.

## Headers

Written `@keyword value`, one space after the keyword, value runs to end of
line (trailing whitespace trimmed). Lowercase, hyphens allowed, case-sensitive.

| Header | Repeatable | Meaning |
|---|---|---|
| `@id` | no | Record identifier. Plain string, no validation, spaces allowed. Should be unique per file (W001). |
| `@reply-to` | no | The `@id` of the record this replies to. Threading is the `@reply-to` chain. |
| `@by` | no | Who gave the feedback. Freeform. |
| `@action` | **yes, ordered** | `@action <verb> <timestamp> [actor]` — a lifecycle event. |
| `@tag` | yes, merged | Space-separated tags; multiple lines accumulate into one list. |
| `@input` | no | What produced the content (e.g. the prompt). Path or URI, supports ranges. |
| `@file` | no | The content being annotated — provenance. Path or URI, supports ranges. |

**Canonical order:** `@id`, `@reply-to`, `@by`, `@action`…, `@tag`, `@input`,
`@file`, then unknown headers alphabetically. Unknown headers parse and are
preserved, with a W002 warning.

`@file` and inline content **coexist**: the file is where it came from, the
content is what the reviewer actually saw — a full snapshot or just the quoted
excerpt. Use an excerpt when the source is mutable (a URL, a living doc) or has
no stable line numbers.

### `@action`

```
@action created  2026-06-17T10:00:00Z dan@example.com
@action resolved 2026-06-18T14:30:00Z Reviewer Two
@action reopened 2026-06-19T08:15:00Z
```

Verb is the first token, timestamp the second (ISO-8601, stored verbatim, never
validated), actor is everything after that (may contain spaces; omitted
means unknown). Well-known verbs: `created`, `viewed`, `resolved`, `reopened` — a
record is *resolved* when its most recent `resolved`/`reopened` action is
`resolved`. Other verbs are preserved but carry no defined meaning. Lines
accumulate in written order and are never merged or deduplicated. Fewer than
two tokens → W012 and the line is skipped, not an error.

### Position ranges on `@file` / `@input`

1-indexed, appended to the path with colons:

```
@file ./code.py:42          line 42
@file ./code.py:42-50       lines 42 through 50, inclusive
@file ./code.py:42:10       line 42, column 10
@file ./code.py:10:5-15:20  line 10 col 5 through line 15 col 20
@file ./code.py:10:5-20     start column given, end column omitted
```

End must not precede start (E011). Ranges are metadata — nothing checks that
the position exists. Relative paths resolve against the `.mb` file's own
directory. A Windows drive letter is not mistaken for a range (scheme detection
requires more than one character).

## Feedback

Everything after `<<< ` on that line, to end of line. Exactly one space after
`<<<`. Freeform text; no escaping needed; any character except a newline.

```
<<< positive
<<< negative; use more formal language
<<< REJECTED - contains factual errors about the timeline
```

### Multi-line: the fence

When the text immediately after `<<< ` is exactly `"""`, feedback becomes a
fenced block running until a line whose only content is `"""`.

```
@id c1
@file ./login.py:42
<<< """
This branch looks dead, but I want to double-check before
suggesting removal — can you point me at any tests that
exercise it?
"""
```

The compact one-liner may open the fence too (`@file ./x.py:42 <<< """`), with
body and closer on following lines. Rules: the opener must be *exactly*
`<<< """` — any other trailing text makes it ordinary single-line feedback that
happens to contain `"""`. Inline `"""` inside a body line, and internal blank
lines, are preserved. Unclosed fence → E012. Empty fence → E009. Use the fence
only when the text genuinely contains a newline; otherwise stay on one line.

### Structured convention (optional)

Split the feedback on `; ` (semicolon + space). Segments containing `=` are
attributes; the first segment without `=` is the label; later non-attribute
segments are the comment.

| Feedback | Reads as |
|---|---|
| `<<< positive` | label `positive` |
| `<<< negative; use more formal language` | label + comment |
| `<<< good; quality=high` | label + attribute |
| `<<< sentiment=positive; confidence=0.9` | attributes only |
| `<<< bad; tone=casual; needs more detail` | label + attribute + comment |

Quote any attribute value containing `; ` or `=` — `note="value; like this"` —
escaping `"` as `\"` and `\` as `\\`. For anything richer, prefix the whole line
with `json:` and put valid JSON after it:

```
<<< json:{"rating":4.5,"tags":["important"],"scores":{"accuracy":0.9}}
```

Invalid JSON behind a `json:` prefix is E007. This whole layer is a convention —
plain prose feedback is equally valid and lints identically.

## The four layouts

### 1. Full record

Headers, blank line, content, `<<<`. Separate consecutive full records with
`---` alone on a line, directly after the preceding `<<<`.

```
@id sample-001
@tag training

The quick brown fox jumps over the lazy dog.
<<< neutral; standard pangram
---
@id sample-002

I absolutely love this product! Best purchase ever!
<<< positive; overly enthusiastic but genuine
```

### 2. Compact — one record per line

For labeling many files. `@file`, the path, ` <<< `, the feedback, all on one
line. **No `---` between compact records.** Other headers go on their own lines
immediately above.

```
@file ./photos/IMG_001.jpg <<< approved; scene=beach
@file ./photos/IMG_002.jpg <<< rejected; too dark
@id review-003
@by dan@example.com
@tag batch-1
@file ./photos/IMG_003.jpg <<< approved; scene=city; time=night
```

The line must start with `@file`; the path ends at the space before `<<<`.

**Do not put a blank line before a compact record's headers.** The spec says
blank lines between compact records are ignored; in 0.3.0 they are not — a
blank line makes the parser discard the following record's own `@id`, `@by`,
and `@tag` and inherit the previous record's values instead
([#15](https://github.com/dandriscoll/markback/issues/15)). Pack the records
together as above, or separate them with `---`.

### 3. Multi-segment section — several comments on one source

Write successive *content + `<<<`* pairs with **no `---` between them**. The
first segment's `@file`, `@by`, `@tag`, and `@input` are inherited by every
later segment in the section. A `---` ends the section.

```
@file ./essay.txt
@by dan

the lazy fox
<<< awkward

weak ending
<<< needs punch

dragging middle paragraph
<<< trim this
```

That is **three** records, all on `./essay.txt`, all by `dan`. Use this layout
for code review and prose review.

`@id`, `@reply-to`, and `@action` are per-record and are **never inherited**.
To give a continuation segment its own `@id`, put it immediately after the
previous `<<<` line with no blank line between:

```
@file ./doc.txt
@id seg1

first
<<< note 1
@id seg2

second
<<< note 2
```

A compact record can seed a section too; later full segments inherit its
`@file`. A per-segment header overrides for that segment only; the section's
value resumes afterward.

### 4. Sidecar — `name.ext.mb`

Annotate any file, including binaries, by writing a sibling file with `.mb`
appended to the *whole* filename: `report.pdf` → `report.pdf.mb`,
`app.py` → `app.py.mb`.

```
@id architecture-diagram-v2
@by jane@example.com
@tag architecture approved
<<< approved; type=diagram; category=architecture
```

`@file` is implicit (the adjacent content file), though tools that generate
sidecars often write it explicitly plus a content snapshot — both are valid.
Per the spec, a pure sidecar carries headers and feedback only. A sidecar may
hold several records separated by `---` (e.g. several reviewers). Absent `@id`,
the content filename is the de-facto identifier.

## File-level `%` headers

```
%markback 2
%scope correctness style naming
%covers ./src/batch3/*.py

@file ./src/batch3/handler.py:15-20 <<< style; function too long
@file ./src/batch3/utils.py:8 <<< naming; rename `x`
```

- `%markback 2` — format version, an integer. Optional but write it.
- `%scope <tokens>` — the issues being checked in this file.
- `%covers <glob>` — the complete set of files reviewed, resolved relative to
  the `.mb` file.

All `%` lines must sit at the very top, before any record. Once a non-blank,
non-`%` line appears the section is closed and any later `%` line is **content**.
Unknown `%` keywords → W002.

### The sweep pattern

`%scope` + `%covers` together make **absence meaningful**: every file matching
the glob that has no record is implicitly clean for every item in `%scope`.
That is the mechanism for "I reviewed all 40 files for these three concerns and
only these two had problems" without writing 38 empty records. Use it whenever
you sweep a batch; without it, a missing record means nothing.

## Reading a `.mb` file

Classify each line, in this order:

| Line | Test |
|---|---|
| File header | starts with `%` (only at top of file) |
| Compact record | starts with `@file` (or V1 `@source`) **and** contains `<<<` |
| Header | starts with `@`, not a compact record |
| Feedback | starts with `<<<` |
| Separator | exactly `---` |
| Blank | empty or whitespace only |
| Content | anything else |

Then: consume `%` headers until the first non-blank non-`%` line. Walk the rest
sequentially. A compact line is a whole record. `---` closes the current section
and starts a fresh one. Otherwise accumulate headers, then content, and close
the record at the first `<<<` — carrying the section's inherited `@file`/`@by`/
`@tag`/`@input` into any segment that does not set its own.

## Writing correctly — the canonical checklist

1. UTF-8, **LF** line endings, single newline at end of file, no BOM.
2. No trailing whitespace on any line (W004).
3. Exactly one space after a header keyword; exactly one space after `<<<`.
4. **Blank line between headers and inline content — always when content is
   present**, and never when it is absent.
5. Headers in canonical order; merge multiple `@tag` lines into one.
6. `---` alone on its line, between full records that do not share a section —
   and **directly after the preceding `<<<` line, with no blank line before
   it**. A blank line there parses fine but is flagged non-canonical (W008).
7. No `---` between compact records.
8. Feedback on one line, or fenced — never a bare newline.
9. Exactly one `<<<` per record; nothing after the feedback line in that record.
10. Prefer the compact layout when a record has `@file` and no inline content.

## Traps

These are verified against the current implementation, not just the spec.

- **The missing blank line silently eats content.** A content line starting
  with `@`, written with no blank line above it, is parsed as an unknown header:
  you get a W002 warning, no error, and the content is **gone from the record**.
  Nothing fails loudly. Always write the blank line.
- Content that does *not* start with `@` survives a missing blank line, but the
  file is flagged non-canonical (W008). Do not rely on it.
- **A blank line before a compact record's headers loses them.** The next
  record's `@id`, `@by`, and `@tag` are discarded and the previous record's
  values are inherited in their place — wrong attribution, not missing
  attribution, with no warning above W006. Known bug
  ([#15](https://github.com/dandriscoll/markback/issues/15)); SPEC.md §3.5 and
  §5.2 describe and show the shape that breaks. Pack compact records with no
  blank line, or use `---`.
- **A `%` line below the first record is content**, not a file header — file
  headers only exist at the top.
- **`mb --normalize` reformats more than whitespace.** It expands multi-segment
  sections into separate `---`-separated full records, and it only uses the
  compact layout when *every* record in the file qualifies for it. Hand-authored
  sections and mixed files do not round-trip byte-for-byte. That is cosmetic,
  not semantic — but do not normalize a file whose hand layout you care about.
- **W008 is noisy — do not chase it.** The check is a byte comparison of the
  file against what the writer would emit, *with the `%` headers stripped*. So
  **any file containing `%markback`, `%scope`, or `%covers` always reports
  W008**, correctly written or not. It also fires on a blank line before `---`,
  on a `@file`-only record written in full layout rather than compact, and on a
  fence whose body has no newline (that collapses back to a single line). Treat
  W008 as "differs from `mb --normalize`", not as an error, and silence it with
  `--no-canonical-check` when linting a file with `%` headers. The spec's own
  `---` examples do not lint clean either.
- **Line endings on write.** The libraries preserve an existing file's
  convention and otherwise use the OS default (CRLF on Windows). Writing by
  hand, use LF; a CRLF file is accepted and normalized on read.
- `@id` is a plain string with no validation — a URL, a sentence, whatever. Do
  not assume it is a slug.
- A record with no `@id` is valid (W006 only). Do not add one just to silence
  the warning if the file has a natural key like `@file`.

## Lint codes

**Errors — the file is invalid:**

| Code | Meaning |
|---|---|
| E001 | No `<<<` in a record |
| E002 | Two or more `<<<` in one record |
| E004 | Content after the `<<<` line within the record |
| E006 | Malformed header syntax, or bad encoding |
| E007 | Invalid JSON after a `json:` prefix |
| E008 | Unclosed quote in a structured attribute value |
| E009 | Empty feedback |
| E010 | Missing blank line before inline content |
| E011 | Position range whose end precedes its start |
| E012 | Unclosed `"""` fence |

**Warnings — the file parses:**

| Code | Meaning |
|---|---|
| W001 | Duplicate `@id` in one file |
| W002 | Unknown `@` or `%` keyword |
| W003 | `@file` target not found |
| W004 | Trailing whitespace |
| W005 | Consecutive blank lines |
| W006 | Record has no `@id` |
| W007 | No sidecar found for a content file |
| W008 | Non-canonical formatting — byte-differs from the writer's output; see Traps |
| W009 | `@input` target not found |
| W010 | V1 header encountered and mapped |
| W011 | `@reply-to` points at an unknown `@id`, or forms a cycle |
| W012 | Malformed `@action` (no timestamp) |

Output format: `<file>:<line>:<column>: <code> <message>`.

## Tooling

Hand-writing is the default. Use tooling when it earns its keep: `mb --lint`
before handing a file over, `mb --stats`/`--list` to read a large file, the
libraries when you are generating records programmatically. Commands, flags,
and the Python/JS APIs are in `references/tooling.md`.

The fastest checks:

```bash
mb --lint path.mb            # validate
mb --list path.mb            # one line per record
mb --normalize path.mb       # print canonical form (add --in-place to write)
```
