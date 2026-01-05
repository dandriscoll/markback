# Implementation Notes

## Design Decisions

### Parser Architecture

The parser uses a state-machine approach, processing lines sequentially and classifying each line into one of:
- `COMPACT_RECORD` - `@source ... <<<` on one line
- `HEADER` - `@keyword value`
- `FEEDBACK` - `<<< ...`
- `SEPARATOR` - `---`
- `BLANK` - empty line
- `CONTENT` - anything else

This allows handling all format variants (single, multi, compact, paired) with the same core logic.

**Tradeoff:** The parser is single-pass but accumulates state. An alternative two-pass approach (first split on separators, then parse each segment) was considered but rejected because compact records don't require separators.

### Feedback Parsing

Feedback parsing supports three modes:
1. **Raw** - Return the feedback string as-is
2. **Structured** - Parse into label, attributes, and comment
3. **JSON** - Parse `json:{...}` prefixed feedback

The structured parser splits on `; ` (semicolon + space) and classifies segments:
- Segments with `=` are key-value attributes
- First non-attribute segment is the label
- Subsequent non-attribute segments become the comment

**Tradeoff:** This heuristic-based parsing may occasionally misclassify freeform text that happens to contain `=`. A stricter approach would require escaping, but that conflicts with the "easy to type" design goal.

### Compact Record Detection

A line is classified as a compact record if it:
1. Starts with `@source`
2. Contains `<<<`

This is done before checking if it's a regular header to ensure compact records are handled correctly.

**Edge case:** A `@source` path containing `<<<` would be misinterpreted. This is documented as a limitation - paths should not contain the feedback delimiter.

### Paired File Discovery

Paired files are discovered by:
1. Finding all files in a directory
2. Identifying label files by suffix (`.label.txt`, `.feedback.txt`, `.mb`)
3. Matching content files to label files by basename

**Tradeoff:** This simple approach doesn't handle nested directories or complex naming patterns. A future version could support glob patterns or manifest files.

### Writer Canonical Format

The writer produces deterministic output by:
1. Normalizing line endings to LF
2. Ordering headers (`@uri` before `@source`)
3. Trimming trailing whitespace
4. Using compact format for source-only records when `prefer_compact=True`

**Tradeoff:** The compact format preference is configurable because some users may prefer the more explicit full format even for simple records.

### LLM Abstraction

The `LLMClient` abstraction supports:
- OpenAI-compatible APIs (most common)
- Mock client for testing

The factory pattern allows injecting mock clients during tests without modifying the workflow code.

**Tradeoff:** Only synchronous HTTP is supported. Async support was considered but adds complexity without clear benefit for the typical use case (small datasets, infrequent calls).

### Evaluation Heuristics

The v1 evaluation uses simple heuristics:
- Parse the expected feedback for a label
- Check if the label is in `positive_labels` or `negative_labels`
- Look for sentiment indicators in the operator output

**Tradeoff:** This is intentionally simple and deterministic. A more sophisticated approach would use an LLM for evaluation, but that adds cost and non-determinism. The simple approach is easy to test and understand.

### File Mode Handling

Two modes are supported:
- **git** - Modify files in place (suitable for version-controlled projects)
- **versioned** - Never overwrite, create timestamped versions

**Tradeoff:** The versioned mode uses timestamps rather than sequential numbers. This ensures uniqueness without needing to scan existing files, but timestamps can be less intuitive for ordering.

## Known Limitations

1. **Path restrictions:** Source paths cannot contain the `<<<` delimiter
2. **Binary content:** Binary files are referenced but not embedded
3. **Encoding:** Only UTF-8 is supported
4. **Line classification:** Content cannot start with `@source ... <<<` on the first line after headers without a blank line
5. **Evaluation:** Simple heuristic-based, not semantic understanding

## Testing Strategy

### Unit Tests
- Parser tests cover all format variants from the spec
- Writer tests verify roundtrip stability
- Linter tests cover all error and warning codes
- Type tests verify core data structures

### Integration Tests
- CLI tests use Typer's test runner
- Workflow tests use mock LLM clients
- File operations use temporary directories

### Fixtures
All spec examples are included as test fixtures to ensure the implementation matches the specification.

## Future Considerations

1. **Async HTTP:** Could improve throughput for large datasets
2. **Streaming parser:** For very large files
3. **Diff output:** Show what normalization changed
4. **Watch mode:** Auto-lint on file changes
5. **IDE integration:** LSP server for real-time linting
