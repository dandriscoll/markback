# MarkBack v1 Specification

**Version:** 0.1.0
**Status:** Draft
**Date:** 2026-01-04

## 1. Overview

MarkBack is a compact, human-writable format for storing content paired with feedback/labels. It is designed for managing training data, prompt engineering workflows, and annotation tasks where content items need associated feedback that can be consolidated to a single line.

### 1.1 Design Goals

- **Compact**: Minimal syntax overhead
- **Human-writable**: Easy to author and read in any text editor
- **Lintable**: Deterministic parsing with clear error detection
- **Flexible storage**: Supports single-file, multi-record, and paired-file modes
- **URI-optional**: Items can exist without identifiers

---

## 2. Record Model

A MarkBack **record** is the fundamental unit. Every record has:

| Field | Required | Description |
|-------|----------|-------------|
| `content` | Yes* | The content being labeled (inline or referenced) |
| `feedback` | Yes | Text after the `<<<` delimiter (always one line) |
| `uri` | No | Unique identifier for the item |
| `source` | No | Reference to external content (when content is not inline) |

*Content is required but may be external (via `source` field).

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

**Compact record (source + feedback on one line):**
```
[@uri header]
@source <path> <<< feedback
```

---

## 3. Syntax Definition

### 3.1 Header Lines

Header lines appear at the start of a record and begin with `@`. They define metadata.

```
@uri <uri-value>
@source <path-or-uri>
```

**Rules:**
- Header lines MUST start with `@` followed by a lowercase keyword
- One space MUST separate the keyword from the value
- Values extend to end of line (trailing whitespace trimmed)
- Unknown headers SHOULD generate a warning (forward compatibility)
- Headers are case-sensitive (`@uri` not `@URI`)

#### 3.1.1 `@uri` Header

Defines the unique identifier for this record.

```
@uri https://example.com/items/123
@uri urn:uuid:550e8400-e29b-41d4-a716-446655440000
@uri local:my-item-name
```

**Allowed URI schemes:** Any valid URI per RFC 3986. Common schemes:
- `https://`, `http://` - Web resources
- `file://` - Local files
- `urn:` - Uniform Resource Names
- `local:` - Application-defined local identifiers

**Validation:** URI MUST be valid per RFC 3986. Parsers MUST reject malformed URIs as errors.

#### 3.1.2 `@source` Header

References external content instead of inline content.

```
@source ./images/photo.jpg
@source ../data/prompt.txt
@source file:///absolute/path/to/file.bin
@source https://cdn.example.com/asset.png
```

**Rules:**
- Relative paths are resolved relative to the MarkBack file location
- When `@source` is present, inline content MUST be empty (or contain only whitespace)
- Parsers MUST verify referenced files exist (warning if missing)

### 3.2 Content Block

Content is everything between headers and the `<<<` feedback delimiter.

```
@uri local:example

This is the content.
It can span multiple lines.
Any text is valid here.
<<< positive; quality=high
```

**Rules:**
- Content ends when `<<<` is encountered
- Content preserves internal whitespace exactly
- Leading/trailing blank lines in content are trimmed during canonicalization
- If `@source` is present, content block MUST be empty

#### 3.2.1 Blank Line Requirement

A blank line between headers and content is **required only when inline content is present**. This prevents ambiguity when content starts with `@`.

**With inline content (blank line required):**
```
@uri local:example

@mentions are a Twitter feature worth studying.
<<< positive
```

**Without inline content (blank line optional):**
```
@uri local:example
@source ./photo.jpg
<<< appropriate
```

```
@uri local:example
<<< feedback with no content
```

### 3.3 Feedback Delimiter

The `<<<` delimiter marks where feedback begins. Everything after `<<<` (on that line) is the feedback content.

**Rules:**
- `<<<` MUST be followed by exactly one space, then feedback content
- Feedback content extends to end of line
- Feedback MUST be a single line (no embedded newlines)
- `<<<` can appear:
  - On its own line (full records)
  - After `@source <path>` on the same line (compact records)

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

#### 3.3.2 Structured Feedback (Optional Convention)

For machine-readable feedback, MarkBack supports an optional structured convention. Parsers MAY interpret feedback using these rules:

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
- Record separator is REQUIRED between records (except in compact mode, see 3.5)
- Record separator is OPTIONAL before the first record
- Record separator is OPTIONAL after the last record
- Blank lines around separators are ignored

### 3.5 Compact Single-Line Records

For labeling many external files efficiently, `@source` and `<<<` can appear on the **same line**:

```
@source <path-or-uri> <<< <feedback>
```

**Examples:**
```
@source ./images/cat.jpg <<< positive; animal=cat
@source ./images/dog.jpg <<< positive; animal=dog
@source ./images/blurry.jpg <<< rejected; too blurry to classify
@source ./audio/clip1.wav <<< transcription="hello world"
```

**Rules:**
- The line MUST start with `@source`
- `<<<` separates the source path from feedback
- Path ends at the space before `<<<`
- No record separator (`---`) needed between compact records
- Blank lines between compact records are ignored
- `@uri` can optionally precede `@source` on its own line:
  ```
  @uri local:item-001
  @source ./file.txt <<< feedback here
  ```

**Mixing formats:**

Compact and full records can coexist in one file, separated by `---`:

```
@source ./quick1.jpg <<< good
@source ./quick2.jpg <<< good

---
@uri local:detailed-item

This item has inline content that needs
multiple lines to express properly.
<<< needs review; complex case

---
@source ./quick3.jpg <<< approved
```

---

## 4. Storage Modes

### 4.1 Single-File Mode (One Record)

A file contains exactly one record. No record separator needed.

**File:** `prompt.mb`
```
@uri local:prompt-001

Write a haiku about programming.
<<< quality=good; creativity=high
```

### 4.2 Multi-Record Mode

A file contains multiple records separated by `---`.

**File:** `labels.mb`
```
@uri local:item-001

First piece of content here.
<<< positive
---
@uri local:item-002

Second piece of content.
Multiple lines are fine.
<<< negative; reason=unclear
---
Third item has no URI.
<<< neutral
```

### 4.3 Paired-File Mode

Content and feedback stored in separate files, linked by naming convention.

#### 4.3.1 File Naming Patterns

| Content File | Feedback File |
|--------------|---------------|
| `name.ext` | `name.label.txt` |
| `name.ext` | `name.feedback.txt` |
| `name.ext` | `name.mb` |

**Resolution order** (first match wins):
1. `{basename}.label.txt`
2. `{basename}.feedback.txt`
3. `{basename}.mb`

Where `{basename}` is the content filename without extension for single-extension files, or the full filename for extensionless files.

#### 4.3.2 Feedback File Format (Paired Mode)

In paired mode, the feedback file contains ONLY:
- Optional header lines (`@uri`, but NOT `@source`)
- The feedback line

```
@uri local:photo-001
<<< appropriate; quality=excellent
```

Or minimally:
```
<<< approved
```

**Rules:**
- `@source` is implicit (the paired content file)
- Content MUST NOT appear in the feedback file
- If `@uri` is absent, the content filename becomes the de-facto identifier

#### 4.3.3 Precedence

When both filename and `@uri` could identify a record:
1. Embedded `@uri` takes precedence if present
2. Filename is used only when `@uri` is absent
3. Parsers SHOULD warn if filename-derived ID conflicts with `@uri`

### 4.4 Label List Mode

A compact file containing many labels, one per line, using compact single-line records.

**File:** `image-labels.mb`
```
@source ./images/001.jpg <<< positive; cat
@source ./images/002.jpg <<< positive; dog
@source ./images/003.jpg <<< negative; blurry
@source ./images/004.jpg <<< positive; bird
@source ./images/005.jpg <<< rejected; not an animal
@source ./images/006.jpg <<< positive; cat; orange tabby
```

**File:** `prompt-feedback.mb`
```
@source ./prompts/prompt1.txt <<< good; clear and specific
@source ./prompts/prompt2.txt <<< needs work; too vague
@source ./prompts/prompt3.txt <<< excellent; perfect constraints
@source ./prompts/prompt4.txt <<< rejected; contains harmful content
```

**With URIs:**
```
@uri dataset:img-001
@source ./images/001.jpg <<< positive

@uri dataset:img-002
@source ./images/002.jpg <<< negative; wrong category
```

**Rules:**
- Each `@source ... <<<` line is one complete record
- No `---` separator needed between compact records
- Blank lines are ignored (for readability grouping)
- Optional `@uri` on preceding line associates with next `@source` line
- Mix with full records using `---` separator when needed

---

## 5. Canonicalization

Canonical form ensures consistent output for comparison and version control.

### 5.1 Canonical Record Format

**Full record (with inline content):**
```
@uri <uri>\n          // if present, URI first
\n                    // blank line before content
<content>\n           // content with normalized line endings
<<< <feedback>\n      // feedback
```

**Full record (no inline content):**
```
@uri <uri>\n          // headers
<<< <feedback>\n      // feedback immediately follows
```

**Compact record (external source only):**
```
@uri <uri>\n          // if present, on its own line
@source <path> <<< <feedback>\n
```

### 5.2 Canonicalization Rules

1. **Line endings:** Normalize to `\n` (LF)
2. **Header order:** `@uri` before `@source` before unknown headers (alphabetical)
3. **Header spacing:** Exactly one space after keyword
4. **Trailing whitespace:** Remove from all lines
5. **Content whitespace:** Preserve internal whitespace; trim leading/trailing blank lines
6. **Blank line:** Include only when inline content is present
7. **Feedback spacing:** Exactly one space after `<<<`
8. **Record separator:** `---` on its own line, one blank line before (except at file start)
9. **File ending:** Single newline at end of file
10. **Compact records:** Prefer compact format when record has `@source` and no inline content

### 5.3 Canonical Multi-Record Format

**Full records:**
```
@uri local:first

Content one.
<<< feedback-one

---
@uri local:second

Content two.
<<< feedback-two
```

**Compact records (label list):**
```
@source ./file1.txt <<< feedback-one
@source ./file2.txt <<< feedback-two
@source ./file3.txt <<< feedback-three
```

**Mixed (use `---` to transition between formats):**
```
@source ./quick1.txt <<< good
@source ./quick2.txt <<< good

---
@uri local:full-record

Inline content here.
<<< detailed feedback
```

---

## 6. Parsing Algorithm

### 6.1 Line Classification

Each line is classified as one of:
- **Compact record:** Starts with `@source` and contains `<<<`
- **Header:** Starts with `@` (but not a compact record)
- **Feedback delimiter:** Contains `<<<`
- **Separator:** Exactly `---`
- **Blank:** Empty or whitespace only
- **Content:** Anything else

### 6.2 Single Record Parsing

**Full record:**
```
1. Read lines until <<< is encountered
2. Identify header lines (starting with @) at the beginning
3. Content is everything between headers and <<<
4. If content is present, require blank line after headers
5. Extract feedback (everything after "<<< ")
```

**Compact record:**
```
1. Line starts with @source and contains <<<
2. Split on " <<< " to get source path and feedback
3. Check preceding line for @uri header (optional)
4. No content (external source only)
```

### 6.3 Multi-Record Parsing

```
1. Process lines sequentially
2. Compact records (@source ... <<<) are complete on one line
3. --- separator starts a new record context
4. Full records end when <<< is encountered
5. Validate no duplicate URIs within file
```

### 6.4 Paired-File Resolution

```
1. Given content file path, search for feedback file using patterns
2. Parse feedback file (headers + feedback only)
3. Create record with implicit @source pointing to content file
4. Content is loaded from the content file on demand
```

---

## 7. Lint Rules

### 7.1 Errors (MUST fix)

| Code | Description |
|------|-------------|
| E001 | Missing feedback (no `<<<` delimiter found) |
| E002 | Multiple `<<<` delimiters in one record |
| E003 | Malformed URI in `@uri` header |
| E004 | Content after `<<<` delimiter (feedback must end the record) |
| E005 | Content present when `@source` specified |
| E006 | Malformed header syntax |
| E007 | Invalid JSON after `json:` prefix (only when `json:` prefix present) |
| E008 | Unclosed quote in structured attribute value (only in `structured` parse mode) |
| E009 | Empty feedback (nothing after `<<< `) |
| E010 | Missing blank line before inline content (content starts with `@`) |

### 7.2 Warnings (SHOULD fix)

| Code | Description |
|------|-------------|
| W001 | Duplicate URI within same file |
| W002 | Unknown header keyword |
| W003 | `@source` file not found |
| W004 | Trailing whitespace on line |
| W005 | Multiple blank lines (will be normalized) |
| W006 | Missing `@uri` (record has no identifier) |
| W007 | Paired feedback file not found for content file |
| W008 | Non-canonical formatting detected |

### 7.3 Lint Output Format

```
<file>:<line>:<column>: <E/W><code> <message>
```

Example:
```
labels.mb:15:1: E001 Missing feedback line in record starting at line 12
labels.mb:8:5: W004 Trailing whitespace
```

---

## 8. Examples

### 8.1 Minimal Record (No URI)

```
This is some content to be labeled.
<<< positive
```

### 8.2 Record with URI

```
@uri https://example.com/items/prompt-42

What is the capital of France?
<<< correct; answer=Paris; difficulty=easy
```

### 8.3 Record with External Content Reference

```
@uri local:vacation-photo-001
@source ./images/beach.jpg
<<< appropriate; tags=landscape,beach,sunset; quality=high
```

Or in compact form:
```
@uri local:vacation-photo-001
@source ./images/beach.jpg <<< appropriate; tags=landscape,beach,sunset; quality=high
```

### 8.4 Single-File Example

**File:** `question.mb`
```
@uri urn:uuid:a1b2c3d4-e5f6-7890-abcd-ef1234567890

Explain quantum entanglement in simple terms.
<<< quality=excellent; accuracy=high; clarity=good
```

### 8.5 Label List Example (Compact Format)

**File:** `image-annotations.mb`
```
@source ./photos/IMG_001.jpg <<< approved; scene=beach
@source ./photos/IMG_002.jpg <<< approved; scene=mountain
@source ./photos/IMG_003.jpg <<< rejected; too dark
@source ./photos/IMG_004.jpg <<< approved; scene=city; time=night
@source ./photos/IMG_005.jpg <<< needs review; possibly inappropriate
@source ./photos/IMG_006.jpg <<< approved; scene=forest
```

**File:** `prompt-review.mb`
```
@source ./prompts/creative-writing.txt <<< good; use as training example
@source ./prompts/code-generation.txt <<< excellent; clear constraints
@source ./prompts/translation.txt <<< needs work; specify source language
@source ./prompts/summarization.txt <<< rejected; too vague
```

**With URIs for tracking:**
```
@uri review:2024-001
@source ./batch1/item1.txt <<< positive

@uri review:2024-002
@source ./batch1/item2.txt <<< negative; confusing instructions

@uri review:2024-003
@source ./batch1/item3.txt <<< positive; excellent clarity
```

### 8.6 Multi-Record Example (Mixed Freeform and Structured)

**File:** `training-data.mb`
```
@uri local:sample-001

The quick brown fox jumps over the lazy dog.
<<< neutral; this is a standard pangram for testing

---
@uri local:sample-002

I absolutely love this product! Best purchase ever!
<<< positive; tone is overly enthusiastic but genuine

---
@uri local:sample-003

The service was terrible and I want a refund.
<<< negative; customer complaint - needs escalation to support team

---
@uri local:sample-004

Please write a formal letter requesting a meeting.
<<< good; formality=high; could use more specific date suggestions

---
@source ./audio/sample-005.wav <<< transcription="Hello world"; quality=clear; language=en
```

### 8.7 Paired-File Example

**Content file:** `essay.txt`
```
The Industrial Revolution marked a major turning point in history.
It began in Britain in the late 18th century and spread to other
parts of the world. The revolution brought significant changes in
agriculture, manufacturing, mining, and transport.
```

**Feedback file:** `essay.label.txt`
```
@uri local:essay-industrial-revolution
<<< good; grade=B+; well structured but needs more specific examples
```

### 8.8 Freeform Feedback Examples

Various styles of freeform feedback:

```
This prompt is too vague.
<<< rejected; be more specific about the desired output format

---
Write a poem about nature.
<<< good; consider adding constraints like length or style

---
@uri local:code-review-001

def add(a, b): return a + b
<<< approved; simple and correct, no changes needed

---
Explain machine learning to a child.
<<< needs work; the explanation assumes too much prior knowledge
```

### 8.9 Complex Structured Feedback (JSON)

```
@uri local:complex-example

Multi-attribute content with special characters.
<<< json:{"rating":4.5,"tags":["important","review"],"notes":"Contains \"quoted\" text and; semicolons","scores":{"accuracy":0.9,"relevance":0.85}}
```

### 8.10 Image with MarkBack Sidecar

**Content file:** `diagram.png` (binary)

**Feedback file:** `diagram.label.txt`
```
@uri local:architecture-diagram-v2
<<< type=diagram; category=architecture; approved=true; reviewer=jane
```

---

## 9. MIME Type and File Extensions

- **MIME type:** `text/markback` (proposed)
- **File extensions:**
  - `.mb` - MarkBack files (single or multi-record)
  - `.label.txt` - Paired feedback files (human-readable fallback)
  - `.feedback.txt` - Alternative paired feedback files

---

## 10. Encoding

- Files MUST be UTF-8 encoded
- BOM is optional but discouraged
- Line endings: LF (`\n`) preferred; CRLF (`\r\n`) accepted and normalized

---

## 11. Acceptance Checklist

- [ ] **Deterministic parsing:** A parser can identify records with zero guesswork
  - Headers start with `@`, feedback starts with `<<<`, separator is `---`
  - No ambiguous delimiters

- [ ] **Lintable:** A linter can count records, detect content vs feedback, validate one-line rule
  - Clear error codes for all violations
  - Feedback line unambiguously identified by `<<<` prefix

- [ ] **Unified record model:** Same logical structure across all 4 storage modes
  - Single-file, multi-record, label-list, and paired-file all produce records with same fields

- [ ] **URIs optional:** Records work without identifiers
  - URI is optional header, not required for valid record

- [ ] **External content:** Supported via `@source` header
  - Can reference any file type (images, audio, binary)

- [ ] **Compact label lists:** Efficient bulk labeling via single-line records
  - `@source ... <<<` on same line for one-record-per-line format

- [ ] **Examples are fixtures:** All examples are valid MarkBack that can be parsed
  - Copy/paste ready for test suites

---

## Appendix A: Grammar (ABNF)

```abnf
markback-file   = *blank-line record-list
record-list     = record *(record-sep record) / compact-list
record-sep      = *blank-line "---" LF *blank-line

; Full record
record          = full-record / compact-record
full-record     = [headers] [content-block] feedback
headers         = 1*header-line
header-line     = "@" keyword SP value LF
keyword         = 1*LOWER
value           = *VCHAR

; Content block (blank line required before content)
content-block   = blank-line content
content         = 1*content-line
content-line    = *VCHAR LF           ; any line not starting with <<<
blank-line      = LF

; Feedback (the <<< delimiter and everything after)
feedback        = "<<<" SP feedback-content LF
feedback-content = *VCHAR             ; no LF allowed

; Compact record (single line, external source only)
compact-record  = [uri-line] source-feedback-line
compact-list    = compact-record *(1*blank-line compact-record)
uri-line        = "@uri" SP value LF
source-feedback-line = "@source" SP path SP "<<<" SP feedback-content LF
path            = 1*VCHAR             ; ends at space before <<<

LOWER           = %x61-7A  ; a-z
SP              = %x20     ; space
LF              = %x0A     ; line feed
VCHAR           = %x21-7E / UTF8-NONASCII
```

---

## Appendix B: Comparison with Alternatives

| Feature | MarkBack | YAML | JSON | CSV |
|---------|----------|------|------|-----|
| Human-writable | Excellent | Good | Poor | Good |
| Multi-line content | Native | Needs quoting | Needs escaping | Poor |
| One-line feedback | Enforced | Not enforced | Not enforced | Natural |
| Binary references | Native | Manual | Manual | Manual |
| Lintable structure | Excellent | Good | Excellent | Poor |

---

## Appendix C: Changelog

### v1.0.0 (2026-01-04)
- Initial specification release
