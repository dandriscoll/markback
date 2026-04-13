# Implementation Notes — MarkBack V2

## V1 → V2 Changes

### Header Renames
- `@uri` → `@id` (plain string, no URI validation)
- `@source` → `@file` (the content being annotated)
- `@prior` → `@input` (what produced the content)

### New Features
- `@tag` header — space-separated tags for categorization
- `%markback 2` — optional version declaration
- `%scope` / `%covers` — sweep pattern (meaningful absence)
- `@file` + inline content can coexist (file is provenance, content is snapshot)
- Sidecar convention simplified to `name.ext.mb` only

### Removed
- LLM workflow layer (`llm.py`, `workflow.py`) — not core to MarkBack
- `httpx` dependency
- `config.py` / `python-dotenv` dependency / `--init` command — not core to MarkBack
- RFC 3986 URI validation on `@id`
- E003 (malformed URI) no longer emitted
- E005 (content with @source) no longer emitted — coexistence is valid
- `.label.txt` / `.feedback.txt` as primary sidecar convention (kept as V1 legacy in discovery)

### API Changes
- `SourceRef` → `FileRef` (alias preserved)
- `Record` fields: `uri→id`, `source→file`, `prior→input`, added `tags`
- New `write()` / `append()` / `write_string()` functions
- New `normalize()` function
- New `discover_sidecars()` function
- `ParseResult` gains `scope`, `covers`, `version`, `covered_files()`
- V1 compat aliases preserved for all renamed functions

## Design Decisions

### Parser Architecture
Same state-machine approach as V1. Now also handles:
- File-level `%` headers (parsed before records, must be at top of file)
- V1 header mapping (detected by keyword, mapped with W010 warning)
- `@tag` with whitespace splitting and merge across multiple lines

### V1 Backward Compatibility
The parser transparently reads V1 files:
1. `@uri` → mapped to `record.id`
2. `@source` → mapped to `record.file`
3. `@prior` → mapped to `record.input`
4. `@source ... <<<` compact → handled alongside `@file ... <<<`
5. Each V1 header emits W010 warning

### Sweep Pattern
`%scope` + `%covers` enable "meaningful absence":
- `%scope` declares what issues are being checked
- `%covers` declares the complete file set under review
- Files matching `%covers` with no record are implicitly clean for all scope items
- `ParseResult.covered_files()` resolves the glob for programmatic access

### Writer Simplification
V1 had 5+ writer functions. V2 has:
- `write()` — write records to a file (auto-format)
- `append()` — add a record to existing file
- `write_string()` — write records to string
- `normalize()` — canonical rewrite
All V1 functions preserved as aliases.

### Sidecar Convention
V2: `name.ext.mb` (append `.mb` to the full filename)
V1 legacy: `.label.txt`, `.feedback.txt` still discovered for backward compat

## Testing Strategy

### Unit Tests
- Parser tests cover V2 format, V1 backward compat, file-level headers, tags, sweep pattern
- Writer tests cover canonical output, version headers, scope/covers, round-trip
- Linter tests verify all error/warning codes with V2 semantics
- Type tests verify FileRef, Record with new fields, V1 compat aliases

### Fixtures
All fixtures updated to V2 format. Error fixtures updated to reflect V2 semantics (e.g., content_with_source is now valid).
