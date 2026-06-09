# Markback V2 Specification

**Version:** 0.2.0
**Status:** Draft
**Date:** 2026-03-20

## 1. Overview

Markback is a compact, human-writable format for storing content paired with single-line feedback. It is designed for managing training data, prompt engineering workflows, annotation tasks, and code review where content items need associated feedback.

### 1.1 Design Goals

- **Compact**: Minimal syntax overhead; one record can be a single line
- **Human-writable**: Easy to author and read in any text editor
- **Lintable**: Deterministic parsing with clear error detection and canonical formatting
- **Flexible storage**: Inline content, compact one-liners, and sidecar files
- **Sweep-capable**: Declare scope and coverage so absence of a record is meaningful
- **Backward-compatible**: V1 files parse transparently with warnings

### 1.2 Changes from V1

| V1 | V2 | Reason |
|----|-----|--------|
| `@uri` | `@id` | Shorter; no URI validation needed |
| `@source` | `@file` | Concrete, unambiguous |
| `@prior` | `@input` | Describes what was fed into a process |
| -- | `@tag` | New: space-separated categorization tags |
| -- | `%markback 2` | New: version declaration |
| -- | `%scope` / `%covers` | New: sweep pattern for meaningful absence |
| `@source` + content = E005 | `@file` + content = valid | File is provenance, content is snapshot |
| `@uri` requires RFC 3986 | `@id` is plain string | Simpler, no validation overhead |
| `.label.txt` / `.feedback.txt` sidecars | `name.ext.mb` sidecars | Simplified convention |

---

## 2. Record Model

A Markback **record** is the fundamental unit. Every record has:

| Field | Required | Description |
|-------|----------|-------------|
| `feedback` | Yes | Text after the `<<<` delimiter (always one line) |
| `id` | No | Plain string identifier for the record |
| `reply_to` | No | `@id` of the record this one replies to (threading) |
| `by` | No | Freeform identifier for who provided the feedback |
| `tags` | No | Space-separated tags for categorization |
| `input` | No | Reference to an item that preceded the content (e.g., a prompt) |
| `file` | No | Reference to external content (provenance); can coexist with inline content |
| `content` | No | Inline text content between headers and `<<<` |

### 2.1 Record Structure

A record ends when `<<<` is encountered. The `<<<` is the **feedback delimiter**.

**Full record (with inline content):**
```
[headers]
[blank line]
[content]
<<< feedback
```

**Full record (no inline content):**
```
[headers]
<<< feedback
```

**Compact record (`@file` + feedback on one line):**
```
[@id header]
@file <path> <<< feedback
```

---

## 3. Syntax Definition

### 3.1 Header Lines

Header lines appear at the start of a record and begin with `@`. They define metadata.

```
@id <string-value>
@reply-to <id-of-parent-record>
@by <freeform-text>
@tag <space-separated-tags>
@input <path-or-uri>
@file <path-or-uri>
```

**Rules:**
- Header lines MUST start with `@` followed by a lowercase keyword (hyphens permitted, e.g., `@reply-to`)
- One space MUST separate the keyword from the value
- Values extend to end of line (trailing whitespace trimmed)
- Unknown headers SHOULD generate a warning (W002, forward compatibility)
- Headers are case-sensitive (`@id` not `@ID`)

**Canonical header order:** `@id`, `@reply-to`, `@by`, `@tag`, `@input`, `@file`

#### 3.1.1 `@id` Header

Defines the identifier for this record. The value is a plain string with no validation requirements.

```
@id item-001
@id https://example.com/items/123
@id my project / review batch 7
```

**Rules:**
- Value is freeform text extending to end of line (trailing whitespace trimmed)
- No URI validation is performed (unlike V1's `@uri` which required RFC 3986)
- Optional -- records without `@id` are valid (W006 warning)
- SHOULD be unique within a file (W001 warning on duplicates)

#### 3.1.1a `@reply-to` Header

Marks this record as a reply to another record. The value is the `@id` of the parent record.

```
@id c1
@file ./login.py:42 <<< this branch never fires

@id c2
@reply-to c1
@file ./login.py:42 <<< it does — covered by test_login_edge()
```

**Rules:**
- Value is the `@id` of another record, resolved within the same file
- A record with `@reply-to` SHOULD also declare its own `@id` so it can be replied to in turn
- `@reply-to` is per-record and is NOT inherited by continuation segments of a multi-segment section
- Threading is reconstructed by walking `@reply-to` chains; tools render replies nested under their parent
- Linters SHOULD warn (W011) if the target id is not present in the file, or if a cycle is detected
- Optional — records without `@reply-to` are top-level comments

#### 3.1.2 `@by` Header

Identifies who provided the feedback. The value is freeform text.

```
@by dan@example.com
@by Dan Driscoll
@by reviewer-42
```

**Rules:**
- Value is freeform text extending to end of line (trailing whitespace trimmed)
- Can contain any characters including spaces and special characters
- Optional -- records without `@by` are valid

#### 3.1.3 `@tag` Header

Assigns tags to the record for categorization and filtering.

```
@tag training positive-examples batch-2024-03
@tag review
```

**Rules:**
- Tags are space-separated tokens on the same line
- Multiple `@tag` lines in the same record are merged (tags accumulate)
- Tag values are arbitrary non-whitespace strings
- Optional -- records without `@tag` are valid

#### 3.1.4 `@input` Header

References an item that precedes the content. For example, if the content is an image generated by an LLM, the input could be the prompt used to create it.

```
@input ./prompts/image-gen-prompt.txt
@input https://example.com/prompts/123
```

**Rules:**
- Relative paths are resolved relative to the Markback file location
- `@input` can be used with or without `@file`
- `@input` does not affect content handling (inline content and `@file` rules still apply)
- Parsers SHOULD verify referenced files exist (W009 warning if missing)
- Supports line/character ranges (see 3.1.6)

#### 3.1.5 `@file` Header

References external content. In V2, `@file` and inline content can coexist: `@file` indicates provenance (where the content came from) while inline content is a snapshot.

```
@file ./images/photo.jpg
@file ../data/prompt.txt
@file https://cdn.example.com/asset.png
```

**Rules:**
- Relative paths are resolved relative to the Markback file location
- `@file` and inline content MAY coexist (`@file` is provenance, inline content is snapshot)
- Parsers SHOULD verify referenced files exist (W003 warning if missing)
- Supports line/character ranges (see 3.1.6)

#### 3.1.6 Line and Character Range Specification

Both `@file` and `@input` headers support optional line and character range specifications using colon notation. This allows referencing specific positions within a file.

**Syntax:**
- Line only: `<path>:<line>` or `<path>:<start-line>-<end-line>`
- With columns: `<path>:<line>:<col>` or `<path>:<start-line>:<start-col>-<end-line>:<end-col>`

```
@file ./code.py:42
@file ./code.py:42-50
@file ./code.py:42:10
@file ./code.py:42:10-42:25
@file ./code.py:10:5-15:20
@input ./prompts/template.txt:1-20
```

**Rules:**
- Line and column numbers are 1-indexed (first line/column is 1)
- Single line: `:N` references line N only
- Line range: `:N-M` references lines N through M (inclusive)
- Single position: `:N:C` references line N, column C
- Character range: `:N:C-M:D` references from line N column C to line M column D (inclusive)
- End position must be greater than or equal to start position (E011 error otherwise)
  - If on same line: end column must be >= start column
  - If on different lines: end line must be >= start line
- Ranges are informational metadata; parsers do not validate that referenced positions exist in the file
- Windows drive letters (e.g., `C:\path`) are not confused with line ranges because scheme detection requires length > 1
- Column specification is optional; you can specify `:10:5-20` (start with column, end without)

### 3.2 Content Block

Content is everything between headers and the `<<<` feedback delimiter.

```
@id example

This is the content.
It can span multiple lines.
Any text is valid here.
<<< positive; quality=high
```

**Rules:**
- Content ends when `<<<` is encountered
- Content preserves internal whitespace exactly
- Leading/trailing blank lines in content are trimmed during canonicalization
- `@file` and inline content MAY coexist (file is provenance, content is what the reviewer saw)

When `@file` is present, the inline content can be either a full snapshot of the file or just an excerpt — a quoted passage. This is useful when the source is mutable (URLs, evolving documents) or has no useful line numbers (text copied from a browser), and you want the quoted passage visible in the `.mb` file itself:

```
@file https://example.com/post.html

The quick brown fox jumps over the lazy dog.
<<< awkward phrasing
```

Parsers do not distinguish snapshots from excerpts — both are stored as `content`.

#### 3.2.1 Blank Line Requirement

A blank line between headers and content is **required only when inline content is present**. This prevents ambiguity when content starts with `@`.

**With inline content (blank line required):**
```
@id example

@mentions are a Twitter feature worth studying.
<<< positive
```

**Without inline content (blank line optional):**
```
@id example
@file ./photo.jpg
<<< appropriate
```

```
@id example
<<< feedback with no content
```

### 3.3 Feedback Delimiter

The `<<<` delimiter marks where feedback begins. Everything after `<<<` (on that line) is the feedback content.

**Rules:**
- `<<<` MUST be followed by exactly one space, then feedback content
- Feedback content extends to end of line
- Feedback is single-line by default (see §3.3.3 for the fenced multi-line form)
- `<<<` can appear:
  - On its own line (full records)
  - After `@file <path>` on the same line (compact records)

#### 3.3.1 Feedback Content Encoding

Feedback content is **freeform text by default**. Any text after `<<< ` is valid feedback.

**Freeform examples:**
```
<<< positive
<<< negative; use more formal language
<<< This response was helpful but could be more concise
<<< REJECTED - contains factual errors about the timeline
```

All characters except newlines are allowed. No escaping required for freeform text.

#### 3.3.1a Fenced Multi-Line Feedback

When the text immediately after `<<< ` is exactly `"""`, the feedback becomes a **fenced block** and spans multiple lines until a line consisting solely of `"""` closes it.

**Full form:**
```
@id c1
@file ./login.py:42
<<< """
This branch looks dead, but I want to double-check before
suggesting removal — can you point me at any tests that
exercise it?
"""
```

**Compact form** (the compact one-liner opens the fence; body and closer follow):
```
@id c1
@file ./login.py:42 <<< """
multi-line
feedback
"""
```

**Rules:**
- The fence opener MUST be exactly `<<< """` (or `@file <path> <<< """` for compact records). Any other content on the opener line is treated as ordinary single-line feedback that happens to contain `"""`.
- The fence closer is a line whose only content (after trimming trailing whitespace) is `"""`.
- All lines between opener and closer become the feedback body, joined by `\n`. Internal blank lines and `"""` appearing inline within a line are preserved verbatim.
- An unclosed fence is an error (E012).
- An empty fenced block (opener immediately followed by closer) is an error (E009), same as empty single-line feedback.
- Writers emit the fenced form only when the feedback string contains a newline; otherwise single-line form is used. Multi-line feedback forces the full (non-compact) record layout because the closer must appear on its own line.

#### 3.3.2 Structured Feedback (Optional Convention)

For machine-readable feedback, Markback supports an optional structured convention. Parsers MAY interpret feedback using these rules:

**Format:** `<<< [label;] [key=value; ...] [comment]`

**Parsing rules:**
1. Split on `; ` (semicolon + space)
2. Segments containing `=` are **attributes** (key-value pairs)
3. Segments without `=` are **labels** or **freeform comments**
4. First non-attribute segment is typically the primary label
5. Last non-attribute segment (after any attributes) is typically a comment

**Examples with structured interpretation:**

| Feedback | Parsed as |
|----------|-----------|
| `<<< positive` | label: "positive" |
| `<<< negative; use more formal language` | label: "negative", comment: "use more formal language" |
| `<<< good; quality=high` | label: "good", attr: quality="high" |
| `<<< sentiment=positive; confidence=0.9` | attrs: sentiment="positive", confidence="0.9" |
| `<<< bad; tone=casual; needs more detail` | label: "bad", attr: tone="casual", comment: "needs more detail" |

**Attribute value escaping** (only needed for structured parsing):
- Values containing `; ` or `=` MUST be quoted: `note="value; with semicolon"`
- Escape `"` as `\"` inside quoted values
- Escape `\` as `\\`

**JSON mode** (for complex structures):
```
<<< json:{"sentiment":"positive","scores":[0.9,0.8]}
```

The `json:` prefix indicates the rest of the line is JSON. Parsers MUST validate JSON syntax when this prefix is present.

#### 3.3.3 Interpretation Modes

Parsers SHOULD support these modes:

| Mode | Behavior |
|------|----------|
| `raw` | Return feedback as-is (freeform string) |
| `structured` | Parse into label, attributes, comment |
| `auto` | Use `structured` if `=` present, otherwise `raw` |

Default mode is implementation-defined. Linting operates on raw text only.

### 3.4 Record Delimiter (Multi-Record Mode)

In multi-record files, records are separated by:

```
---
```

Three hyphens on a line by themselves. This is the **record separator**.

**Rules:**
- Record separator MUST be exactly `---` (no leading/trailing whitespace)
- Record separator is REQUIRED between full records that don't share a section (see 3.4.1)
- Record separator is OPTIONAL before the first record
- Record separator is OPTIONAL after the last record
- Blank lines around separators are ignored
- Record separator is NOT needed between consecutive compact records

#### 3.4.1 Multi-Segment Sections

Multiple records may share the same `@file` (and other section headers) by writing successive content + `<<<` segments without a `---` separator between them. This is convenient for code-review-style workflows where one source has several distinct comments.

```
@file ./essay.txt

the lazy fox
<<< awkward

weak ending
<<< needs punch

dragging middle paragraph
<<< trim this
```

The example above is **three records**, all referencing `./essay.txt`. A `---` separator ends the section; the next record must declare its own headers.

**Rules:**
- A "section" begins at the start of the file (or right after a `---` separator) and ends at the next `---` (or end of file).
- Headers `@file`, `@by`, `@tag`, `@input` set in the first record of a section are inherited by all subsequent segments in that section.
- `@id` is per-record and never inherited. To set an `@id` on a continuation segment, place it immediately after the previous `<<<` line (no blank line in between):
  ```
  @file ./doc.txt
  @id seg1

  first
  <<< note 1
  @id seg2

  second
  <<< note 2
  ```
- A compact record (`@file ... <<<`) seeds a section as well; subsequent full segments inherit its `@file`.
- Per-segment headers override only for that segment; the section's value resumes for the segment after.

### 3.5 Compact Single-Line Records

For labeling many external files efficiently, `@file` and `<<<` can appear on the **same line**:

```
@file <path-or-uri> <<< <feedback>
```

**Examples:**
```
@file ./images/cat.jpg <<< positive; animal=cat
@file ./images/dog.jpg <<< positive; animal=dog
@file ./images/blurry.jpg <<< rejected; too blurry to classify
@file ./audio/clip1.wav <<< transcription="hello world"
```

**Rules:**
- The line MUST start with `@file`
- `<<<` separates the file path from feedback
- Path ends at the space before `<<<`
- No record separator (`---`) needed between compact records
- Blank lines between compact records are ignored
- Other headers (`@id`, `@by`, `@tag`, `@input`) can precede the compact line on their own lines:
  ```
  @id item-001
  @by reviewer@example.com
  @tag batch-1 priority
  @file ./file.txt <<< feedback here
  ```

**Mixing formats:**

Compact and full records can coexist in one file, separated by `---`:

```
@file ./quick1.jpg <<< good
@file ./quick2.jpg <<< good

---
@id detailed-item

This item has inline content that needs
multiple lines to express properly.
<<< needs review; complex case

---
@file ./quick3.jpg <<< approved
```

---

## 4. File-Level Headers

File-level headers use the `%` prefix and appear at the top of a file, before any records. They declare metadata about the file as a whole.

### 4.1 `%markback` -- Version Declaration

Declares the Markback format version.

```
%markback 2
```

**Rules:**
- Value MUST be an integer
- Current version is `2`
- Optional but recommended for clarity
- MUST appear before any record-level content
- If absent, parsers attempt V2 then V1 parsing

### 4.2 `%scope` -- Issue Scope

Declares the set of issues or concerns being checked in this file.

```
%scope issue-A issue-B code-quality
```

**Rules:**
- Values are space-separated tokens
- Used with `%covers` to enable the sweep pattern (section 6)
- Optional

### 4.3 `%covers` -- Coverage Declaration

Declares a glob pattern identifying the complete set of files under review.

```
%covers ./gen/batch3/*.txt
%covers ./src/**/*.py
```

**Rules:**
- Value is a single glob pattern
- Files matching the pattern that have no record are implicitly clean for all `%scope` items
- Resolved relative to the Markback file location
- Optional; meaningful only when combined with `%scope`

### 4.4 File-Level Header Placement

All `%` headers MUST appear at the top of the file, before any blank lines that precede records. Once a non-blank, non-`%` line is encountered, the file-level header section is closed.

```
%markback 2
%scope correctness style
%covers ./src/*.py

@id review-001
@file ./src/app.py
<<< style; rename variable on line 42
```

Unknown `%` headers generate a W002 warning.

---

## 5. Storage Modes

Markback supports three storage modes. All produce the same logical record structure.

### 5.1 Inline Mode

Content and feedback stored together in a single `.mb` file. Records are separated by `---`.

**File:** `training-data.mb`
```
%markback 2

@id sample-001
@tag training

The quick brown fox jumps over the lazy dog.
<<< neutral; this is a standard pangram for testing

---
@id sample-002
@tag training

I absolutely love this product! Best purchase ever!
<<< positive; tone is overly enthusiastic but genuine
```

### 5.2 Compact Mode

One annotation per line using `@file ... <<<`. Each line is a complete record. No `---` separator needed between compact records.

**File:** `image-labels.mb`
```
%markback 2

@file ./photos/IMG_001.jpg <<< approved; scene=beach
@file ./photos/IMG_002.jpg <<< approved; scene=mountain
@file ./photos/IMG_003.jpg <<< rejected; too dark
@file ./photos/IMG_004.jpg <<< approved; scene=city; time=night
```

**With additional headers:**
```
%markback 2

@id review-001
@by dan@example.com
@tag batch-1
@file ./batch1/item1.txt <<< positive

@id review-002
@by dan@example.com
@tag batch-1
@file ./batch1/item2.txt <<< negative; confusing instructions
```

### 5.3 Sidecar Mode

Content lives in its original file; annotation lives in a sidecar `.mb` file alongside it.

**Convention:** `name.ext.mb` (append `.mb` to the full content filename).

| Content File | Sidecar File |
|--------------|--------------|
| `report.pdf` | `report.pdf.mb` |
| `diagram.png` | `diagram.png.mb` |
| `app.py` | `app.py.mb` |

**Sidecar file format:** Contains headers and feedback only (no `@file` needed since the content file is implicit).

**Content file:** `essay.txt`
```
The Industrial Revolution marked a major turning point in history.
```

**Sidecar file:** `essay.txt.mb`
```
@id essay-industrial-revolution
@by reviewer@example.com
<<< good; grade=B+; well structured but needs more specific examples
```

**Rules:**
- `@file` is implicit (the adjacent content file)
- Content MUST NOT appear in the sidecar file
- If `@id` is absent, the content filename becomes the de-facto identifier
- A sidecar file MAY contain multiple records (e.g., multiple reviewers) separated by `---`

---

## 6. Sweep Pattern

The **sweep pattern** enables "meaningful absence" -- the ability to confirm that a file was reviewed and found clean, without requiring an explicit record for every file.

### 6.1 Concept

When `%scope` and `%covers` are both present, files matching `%covers` that have **no** corresponding record are implicitly clean for all items declared in `%scope`.

### 6.2 Example

```
%markback 2
%scope correctness style
%covers ./gen/batch3/*.txt

@file ./gen/batch3/file2.txt <<< style; tone is off
@file ./gen/batch3/file5.txt <<< correctness; wrong output format
```

In this example:
- The reviewer checked all `.txt` files in `./gen/batch3/` for `correctness` and `style` issues
- `file2.txt` has a style issue; `file5.txt` has a correctness issue
- All other files matching the glob (e.g., `file1.txt`, `file3.txt`, `file4.txt`) are implicitly clean for both `correctness` and `style`

### 6.3 Programmatic Access

Implementations SHOULD provide a `covered_files()` method that resolves the `%covers` glob to actual file paths. The set difference between covered files and files with records gives the implicitly clean files.

---

## 7. Canonicalization

Canonical form ensures consistent output for comparison and version control.

### 7.1 Canonical Header Order

Headers MUST appear in this order:

1. `@id`
2. `@by`
3. `@tag`
4. `@input`
5. `@file`
6. Unknown headers (alphabetical)

### 7.2 Canonicalization Rules

1. **Line endings:** Normalize to `\n` (LF)
2. **Header order:** Follow canonical order (section 7.1)
3. **Header spacing:** Exactly one space after keyword
4. **Trailing whitespace:** Remove from all lines
5. **Content whitespace:** Preserve internal whitespace; trim leading/trailing blank lines
6. **Blank line:** Include only when inline content is present
7. **Feedback spacing:** Exactly one space after `<<<`
8. **Record separator:** `---` on its own line, one blank line before (except at file start)
9. **File ending:** Single newline at end of file
10. **Compact preference:** Use compact format when record has `@file` and no inline content
11. **Tag merging:** Multiple `@tag` lines merged to a single `@tag` line

### 7.3 Canonical Full Record

```
@id <id>
@by <by>
@tag <tags>
@input <input>
@file <file>

<content>
<<< <feedback>
```

Headers are omitted when absent. Blank line appears only when inline content is present.

### 7.4 Canonical Compact Record

```
@id <id>
@by <by>
@tag <tags>
@input <input>
@file <path> <<< <feedback>
```

### 7.5 Canonical Multi-Record File

**Full records separated by `---`:**
```
@id first

Content one.
<<< feedback-one

---
@id second

Content two.
<<< feedback-two
```

**Compact records (no separator):**
```
@file ./file1.txt <<< feedback-one
@file ./file2.txt <<< feedback-two
@file ./file3.txt <<< feedback-three
```

**Mixed (use `---` to transition between formats):**
```
@file ./quick1.txt <<< good
@file ./quick2.txt <<< good

---
@id full-record

Inline content here.
<<< detailed feedback
```

---

## 8. Parsing Algorithm

### 8.1 Line Classification

Each line is classified as one of:

| Type | Detection |
|------|-----------|
| **File header** | Starts with `%` (only valid at top of file) |
| **Compact record** | Starts with `@file` (or V1 `@source`) and contains `<<<` |
| **Header** | Starts with `@` (but not a compact record) |
| **Feedback** | Starts with `<<<` |
| **Separator** | Exactly `---` |
| **Blank** | Empty or whitespace only |
| **Content** | Anything else |

### 8.2 File-Level Header Parsing

```
1. Read lines from top of file
2. While line is blank or starts with %, process file-level headers:
   a. %markback <int> sets the version
   b. %scope <tokens> sets the scope list (space-separated)
   c. %covers <glob> sets the coverage pattern
   d. Unknown % headers emit W002 warning
3. Once a non-blank, non-% line is encountered, file-level section is closed
4. Any % line after the file-level section is treated as content
```

### 8.3 Single Record Parsing

**Full record:**
```
1. Read lines until <<< is encountered
2. Identify header lines (starting with @) at the beginning
3. Map V1 headers to V2 equivalents, emitting W010 for each
4. Content is everything between headers and <<<
5. If content is present, require blank line after headers
6. Extract feedback (everything after "<<< ")
```

**Compact record:**
```
1. Line starts with @file (or V1 @source) and contains <<<
2. Split on " <<< " to get file path and feedback
3. Check preceding lines for other headers (@id, @by, @tag, @input)
4. No inline content
```

### 8.4 Multi-Record Parsing

```
1. Process file-level headers at top of file
2. Process lines sequentially
3. Compact records (@file ... <<<) are complete on one line
4. --- separator starts a new record context
5. Full records end when <<< is encountered
6. Validate no duplicate IDs within file (W001)
7. Warn on records without @id (W006)
```

### 8.5 V1 Header Mapping

When a V1 header keyword is encountered, it is transparently mapped:

| V1 Header | V2 Header | Action |
|-----------|-----------|--------|
| `@uri` | `@id` | Map and emit W010 |
| `@source` | `@file` | Map and emit W010 |
| `@prior` | `@input` | Map and emit W010 |

V1 compact records (`@source ... <<<`) are also recognized and mapped with W010.

### 8.6 Sidecar Discovery

```
1. Given content file path, look for <filename>.mb sidecar
2. V1 legacy: also check {basename}.label.txt and {basename}.feedback.txt
3. Parse sidecar file (headers + feedback only)
4. Create record with implicit @file pointing to content file
```

Discovery priority:
1. `name.ext.mb` (V2)
2. `name.label.txt` (V1 legacy)
3. `name.feedback.txt` (V1 legacy)

---

## 9. Lint Rules

### 9.1 Errors (MUST fix)

| Code | Description |
|------|-------------|
| E001 | Missing feedback (no `<<<` delimiter found in record) |
| E002 | Multiple `<<<` delimiters in one record |
| E004 | Content after `<<<` delimiter (feedback must end the record) |
| E006 | Malformed header syntax or invalid file encoding |
| E007 | Invalid JSON after `json:` prefix (only when `json:` prefix present) |
| E008 | Unclosed quote in structured attribute value (only in `structured` parse mode) |
| E009 | Empty feedback (nothing after `<<<`) |
| E010 | Missing blank line before inline content (content starts with `@`) |
| E011 | Invalid line/character range (end position before start position) |
| E012 | Unclosed fenced feedback block (missing closing `"""`) |

### 9.2 Warnings (SHOULD fix)

| Code | Description |
|------|-------------|
| W001 | Duplicate `@id` within same file |
| W002 | Unknown header keyword (`@` or `%` prefix) |
| W003 | `@file` referenced file not found |
| W004 | Trailing whitespace on line |
| W005 | Multiple consecutive blank lines (will be normalized) |
| W006 | Missing `@id` (record has no identifier) |
| W007 | Paired sidecar file not found for content file |
| W008 | Non-canonical formatting detected |
| W009 | `@input` referenced file not found |
| W010 | V1 format detected (old header mapped to V2 equivalent) |
| W011 | `@reply-to` points at an unknown `@id` or forms a cycle |

### 9.3 Retired Error Codes

These V1 error codes are no longer emitted in V2:

| Code | V1 Description | V2 Status |
|------|---------------|-----------|
| E003 | Malformed URI in `@uri` | Retired: `@id` has no format validation |
| E005 | Content present when `@source` specified | Retired: `@file` + inline content coexist in V2 |

Implementations MAY retain these codes for V1 compatibility but MUST NOT emit them when parsing V2 files.

### 9.4 Lint Output Format

```
<file>:<line>:<column>: <E/W><code> <message>
```

Example:
```
labels.mb:15:1: E001 Missing feedback line in record starting at line 12
labels.mb:8:5: W004 Trailing whitespace
labels.mb:3:1: W010 V1 format detected: @uri mapped to @id
```

---

## 10. Examples

### 10.1 Minimal Record (No Headers)

```
This is some content to be labeled.
<<< positive
```

### 10.2 Record with All Headers

```
@id review-001
@by alice@company.com
@tag security p0 urgent
@input ./prompts/security-check.txt
@file ./src/auth.py:45-67

The auth module has potential SQL injection.
<<< vulnerable; sql-injection in query builder
```

### 10.3 File + Inline Content Coexistence

The `@file` header indicates provenance while inline content is a snapshot:

```
@id code-review-001
@file ./src/app.py:42-50

def add(a, b):
    return a + b
<<< approved; simple and correct
```

### 10.4 Record with Attribution

```
@id prompt-042
@by dan@example.com

What is the capital of France?
<<< correct; answer=Paris; difficulty=easy
```

### 10.5 Compact Label List

**File:** `image-annotations.mb`
```
%markback 2

@file ./photos/IMG_001.jpg <<< approved; scene=beach
@file ./photos/IMG_002.jpg <<< approved; scene=mountain
@file ./photos/IMG_003.jpg <<< rejected; too dark
@file ./photos/IMG_004.jpg <<< approved; scene=city; time=night
@file ./photos/IMG_005.jpg <<< needs review; possibly inappropriate
@file ./photos/IMG_006.jpg <<< approved; scene=forest
```

### 10.6 Compact Records with Additional Headers

```
%markback 2

@id review-001
@by dan@example.com
@tag batch-1
@file ./batch1/item1.txt <<< positive

@id review-002
@by dan@example.com
@tag batch-1
@file ./batch1/item2.txt <<< negative; confusing instructions
```

### 10.7 Multi-Record with Mixed Formats

**File:** `training-data.mb`
```
%markback 2

@id sample-001
@tag training

The quick brown fox jumps over the lazy dog.
<<< neutral; this is a standard pangram for testing

---
@id sample-002
@tag training

I absolutely love this product! Best purchase ever!
<<< positive; tone is overly enthusiastic but genuine

---
@file ./audio/sample-003.wav <<< transcription="Hello world"; quality=clear
```

### 10.8 Sweep Pattern

**File:** `code-review.mb`
```
%markback 2
%scope correctness style naming
%covers ./src/batch3/*.py

@file ./src/batch3/handler.py:15-20 <<< style; function too long
@file ./src/batch3/utils.py:8 <<< naming; rename `x` to something descriptive
```

All other `.py` files in `./src/batch3/` are implicitly clean for correctness, style, and naming.

### 10.9 Sidecar File

**Content file:** `diagram.png` (binary)

**Sidecar file:** `diagram.png.mb`
```
@id architecture-diagram-v2
@by jane@example.com
@tag architecture approved
<<< approved; type=diagram; category=architecture
```

### 10.10 Tags with Merging

```
@id item-001
@tag training positive-examples batch-2024-03
@file ./data/example.txt
<<< approved
```

Multiple `@tag` lines merge:
```
@id item-002
@tag training
@tag positive-examples
@tag batch-2024-03
@file ./data/example.txt
<<< approved
```

Both produce the same record with tags `["training", "positive-examples", "batch-2024-03"]`.

### 10.11 Character-Level References

Reference a specific line:
```
@file ./code.py:42 <<< potential bug at this position
```

Reference a line range:
```
@file ./code.py:42-50 <<< this block needs refactoring
```

Reference a character range:
```
@file ./code.py:10:5-15:20 <<< extract this into a helper function
```

Use with `@input`:
```
@input ./prompts/template.txt:1-20
@file ./output/result.txt
<<< good; followed template constraints
```

### 10.12 Complex Structured Feedback (JSON)

```
@id complex-example

Multi-attribute content with special characters.
<<< json:{"rating":4.5,"tags":["important","review"],"notes":"Contains \"quoted\" text","scores":{"accuracy":0.9,"relevance":0.85}}
```

### 10.13 File-Level Headers with Sweep

```
%markback 2
%scope tone accuracy completeness
%covers ./responses/*.txt

@id resp-007
@file ./responses/answer7.txt <<< tone; too informal for business context

@id resp-012
@file ./responses/answer12.txt <<< accuracy; incorrect date mentioned
```

### 10.14 Freeform Feedback Styles

```
@id review-a

This prompt is too vague.
<<< rejected; be more specific about the desired output format

---
@id review-b

Write a poem about nature.
<<< good; consider adding constraints like length or style

---
@id review-c

Explain machine learning to a child.
<<< needs work; the explanation assumes too much prior knowledge
```

### 10.15 LLM-Generated Content with Input Reference

```
@id generated-image-001
@input ./prompts/beach-sunset.txt
@file ./images/generated-beach.jpg
<<< accurate; matches prompt well; quality=high
```

With inline content:
```
@id generated-text-001
@input ./prompts/haiku-prompt.txt

Cherry blossoms fall,
Petals dance on gentle breeze,
Spring whispers goodbye.
<<< creative; follows haiku structure; quality=excellent
```

---

## 11. MIME Type and Encoding

### 11.1 MIME Type

- **MIME type:** `text/markback` (proposed)

### 11.2 File Extensions

- `.mb` -- Markback files (all modes: inline, compact, sidecar)
- `name.ext.mb` -- Sidecar annotation files

### 11.3 Encoding

- Files MUST be UTF-8 encoded
- BOM is optional but discouraged
- Line endings: LF (`\n`) preferred; CRLF (`\r\n`) accepted and normalized to LF

---

## 12. ABNF Grammar

```abnf
; === File Structure ===

markback-file     = [file-headers *blank-line] record-list
file-headers      = 1*file-header-line
file-header-line  = "%" keyword [SP value] LF

; === Record List ===

record-list       = record *(record-sep record) / compact-list
record-sep        = *blank-line "---" LF *blank-line
compact-list      = compact-record *(1*blank-line compact-record)

; === Records ===

record            = full-record / compact-record

full-record       = [headers] [content-block] feedback-line
headers           = 1*header-line
header-line       = "@" keyword SP value LF
keyword           = 1*LOWER
value             = *VCHAR

content-block     = blank-line content
content           = 1*content-line
content-line      = *VCHAR LF                       ; any line not starting with <<<

blank-line        = LF

; === Feedback ===

feedback-line     = "<<<" SP feedback-content LF
feedback-content  = *VCHAR                           ; no LF allowed

; === Compact Record ===

compact-record    = [id-line] [by-line] [tag-line] [input-line] file-feedback-line
id-line           = "@id" SP value LF
by-line           = "@by" SP value LF
tag-line          = "@tag" SP value LF
input-line        = "@input" SP path-with-range LF
file-feedback-line = "@file" SP path-with-range SP "<<<" SP feedback-content LF

; === Path with Optional Position Range ===

path-with-range   = path [position-range]
path              = 1*VCHAR                          ; ends at SP before <<< or position-range
position-range    = ":" 1*DIGIT [":" 1*DIGIT] ["-" 1*DIGIT [":" 1*DIGIT]]

; === Terminals ===

LOWER             = %x61-7A                          ; a-z
SP                = %x20                             ; space
LF                = %x0A                             ; line feed
DIGIT             = %x30-39                          ; 0-9
VCHAR             = %x21-7E / UTF8-NONASCII
```

---

## 13. V1 Backward Compatibility

### 13.1 Header Mapping

V1 files are parsed transparently. When a V1 header is encountered, it is mapped to the V2 equivalent and a W010 warning is emitted.

| V1 Header | V2 Header | Notes |
|-----------|-----------|-------|
| `@uri` | `@id` | Value preserved as-is; no URI validation in V2 |
| `@source` | `@file` | Path and ranges preserved |
| `@prior` | `@input` | Path and ranges preserved |

### 13.2 Compact Record Compatibility

V1 compact records using `@source ... <<<` are recognized alongside V2 `@file ... <<<`. Each V1 compact record emits a W010 warning.

### 13.3 Sidecar Compatibility

V2 uses `name.ext.mb` as the sidecar convention. For backward compatibility, implementations SHOULD also discover V1 sidecar patterns during file discovery:

| Priority | Pattern | Version |
|----------|---------|---------|
| 1 | `name.ext.mb` | V2 |
| 2 | `name.label.txt` | V1 legacy |
| 3 | `name.feedback.txt` | V1 legacy |

### 13.4 Semantic Changes from V1

- **`@file` + inline content:** In V1, `@source` with inline content was an error (E005). In V2, `@file` with inline content is valid -- the file is provenance and the inline content is a snapshot.
- **`@id` validation:** In V1, `@uri` required RFC 3986 compliance (E003). In V2, `@id` is a plain string with no format validation.

### 13.5 Migration

To migrate a V1 file to V2:
1. Replace `@uri` with `@id`
2. Replace `@source` with `@file`
3. Replace `@prior` with `@input`
4. Optionally add `%markback 2` at the top
5. Optionally add `@tag` headers for categorization

Alternatively, run the file through a V2 normalizer which performs all mappings automatically.

---

## 14. Changelog

### v0.2.0 (2026-03-20)

**Header renames:**
- `@uri` renamed to `@id` (plain string, no URI validation)
- `@source` renamed to `@file` (provenance reference)
- `@prior` renamed to `@input` (preceding item reference)

**New features:**
- `@tag` header for space-separated tags with merge across multiple lines
- File-level `%` headers: `%markback`, `%scope`, `%covers`
- Sweep pattern: `%scope` + `%covers` for meaningful absence
- `@file` + inline content coexistence (file is provenance, content is snapshot)
- Simplified sidecar convention: `name.ext.mb`
- Canonical header order: `@id`, `@by`, `@tag`, `@input`, `@file`
- W010 warning for V1 format detection with transparent mapping

**Removed/retired:**
- E003 (malformed URI): `@id` has no format validation
- E005 (content with `@source`): `@file` + inline content now valid
- `.label.txt` / `.feedback.txt` as primary sidecar convention (retained as V1 legacy discovery)
- RFC 3986 validation requirement

**Unchanged from V1:**
- Feedback parsing rules (freeform, structured with `; ` separator, JSON mode with `json:` prefix)
- Line/character range syntax on `@file` and `@input`
- `<<<` feedback delimiter semantics
- `---` record separator semantics
- All other error codes (E001, E002, E004, E006-E011)
- All other warning codes (W001-W009)

### v1.0.0 (2026-01-04)
- Initial specification release
