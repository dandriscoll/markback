const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  lintString,
  lintFile,
  lintFiles,
  formatDiagnostics,
  summarizeResults,
  ErrorCode,
  WarningCode,
} = require("../dist/index.js");

const fixturesDir = path.join(__dirname, "..", "..", "..", "tests", "fixtures");

function findCode(diagnostics, code) {
  return diagnostics.filter((diagnostic) => diagnostic.code === code);
}

test("lintString: valid minimal", () => {
  const text = "Content here.\n<<< positive\n";
  const result = lintString(text, { checkSources: false, checkCanonical: false });
  assert.equal(result.hasErrors, false);
});

test("lintString: missing feedback", () => {
  const text = "@uri local:example\n\nContent without feedback.\n";
  const result = lintString(text, { checkSources: false, checkCanonical: false });
  assert.equal(result.hasErrors, true);
  assert.equal(findCode(result.diagnostics, ErrorCode.E001).length, 1);
});

test("lintString: invalid json", () => {
  const text = "Content.\n<<< json:{invalid json}\n";
  const result = lintString(text, { checkSources: false, checkCanonical: false });
  assert.equal(result.hasErrors, true);
  assert.equal(findCode(result.diagnostics, ErrorCode.E007).length, 1);
});

test("lintString: duplicate uri", () => {
  const text = "@uri local:same\n\nContent 1.\n<<< good\n\n---\n@uri local:same\n\nContent 2.\n<<< bad\n";
  const result = lintString(text, { checkSources: false, checkCanonical: false });
  assert.equal(findCode(result.diagnostics, WarningCode.W001).length, 1);
});

test("lintFile: minimal fixture", () => {
  const filePath = path.join(fixturesDir, "minimal.mb");
  const result = lintFile(filePath, { checkSources: false });
  assert.equal(result.hasErrors, false);
});

test("lintFile: malformed uri fixture", () => {
  const filePath = path.join(fixturesDir, "errors", "malformed_uri.mb");
  const result = lintFile(filePath, { checkSources: false });
  assert.equal(result.hasErrors, true);
  assert.equal(findCode(result.diagnostics, ErrorCode.E003).length, 1);
});

test("lintFiles: directory fixtures", () => {
  const results = lintFiles([fixturesDir], { checkSources: false });
  assert.ok(results.length > 0);
});

test("formatDiagnostics: json", () => {
  const text = "@uri invalid\n\nContent.\n<<< good\n";
  const result = lintString(text, { checkSources: false, checkCanonical: false });
  const output = formatDiagnostics(result.diagnostics, "json");
  const data = JSON.parse(output);
  assert.ok(Array.isArray(data));
});

test("summarizeResults: shape", () => {
  const filePath = path.join(fixturesDir, "minimal.mb");
  const results = lintFiles([filePath], { checkSources: false });
  const summary = summarizeResults(results);
  assert.equal(typeof summary.files, "number");
  assert.equal(typeof summary.records, "number");
  assert.equal(typeof summary.errors, "number");
  assert.equal(typeof summary.warnings, "number");
});

test("lintString: @prior header", () => {
  const text = "@uri local:gen-001\n@prior ./prompts/prompt.txt\n@source ./images/gen.jpg\n<<< accurate\n";
  const result = lintString(text, { checkSources: false, checkCanonical: false });
  assert.equal(result.hasErrors, false);
});

test("lintString: compact record with @prior", () => {
  const text = "@uri local:img-001\n@prior ./prompts/prompt.txt\n@source ./images/gen.jpg <<< good\n";
  const result = lintString(text, { checkSources: false, checkCanonical: false });
  assert.equal(result.hasErrors, false);
});

test("lintString: @prior file not found warning", () => {
  const text = "@uri local:example\n@prior ./nonexistent_prior.txt\n@source ./nonexistent.txt\n<<< good\n";
  const result = lintString(text, { checkSources: true, checkCanonical: false });
  // Should have W009 for @prior
  assert.equal(findCode(result.diagnostics, WarningCode.W009).length, 1);
});

test("lintString: @prior URI not checked", () => {
  const text = "@uri local:example\n@prior https://example.com/prior.txt\n\nContent.\n<<< good\n";
  const result = lintString(text, { checkSources: true, checkCanonical: false });
  // Should not have W009 for URI-based @prior
  assert.equal(findCode(result.diagnostics, WarningCode.W009).length, 0);
});

// Line range support tests

test("lintString: @source with single line", () => {
  const text = "@source ./code.py:42 <<< good\n";
  const result = lintString(text, { checkSources: false, checkCanonical: false });
  assert.equal(result.hasErrors, false);
  assert.equal(result.records[0].source.path, "./code.py");
  assert.equal(result.records[0].source.startLine, 42);
  assert.equal(result.records[0].source.endLine, 42);
});

test("lintString: @source with line range", () => {
  const text = "@source ./code.py:10-20 <<< good\n";
  const result = lintString(text, { checkSources: false, checkCanonical: false });
  assert.equal(result.hasErrors, false);
  assert.equal(result.records[0].source.path, "./code.py");
  assert.equal(result.records[0].source.startLine, 10);
  assert.equal(result.records[0].source.endLine, 20);
});

test("lintString: @prior with line range", () => {
  const text = "@prior ./prompts/template.txt:1-20\n@source ./output.txt\n<<< good\n";
  const result = lintString(text, { checkSources: false, checkCanonical: false });
  assert.equal(result.hasErrors, false);
  assert.equal(result.records[0].prior.path, "./prompts/template.txt");
  assert.equal(result.records[0].prior.startLine, 1);
  assert.equal(result.records[0].prior.endLine, 20);
});

test("lintString: compact record with line range", () => {
  const text = "@uri local:item-001\n@source ./file.txt:100-150 <<< feedback\n";
  const result = lintString(text, { checkSources: false, checkCanonical: false });
  assert.equal(result.hasErrors, false);
  assert.equal(result.records[0].source.path, "./file.txt");
  assert.equal(result.records[0].source.startLine, 100);
  assert.equal(result.records[0].source.endLine, 150);
});

test("lintString: invalid line range end < start", () => {
  const text = "@source ./code.py:50-10 <<< good\n";
  const result = lintString(text, { checkSources: false, checkCanonical: false });
  assert.equal(result.hasErrors, true);
  assert.equal(findCode(result.diagnostics, ErrorCode.E011).length, 1);
});

test("lintString: source without line range still works", () => {
  const text = "@source ./code.py <<< good\n";
  const result = lintString(text, { checkSources: false, checkCanonical: false });
  assert.equal(result.hasErrors, false);
  assert.equal(result.records[0].source.path, "./code.py");
  assert.equal(result.records[0].source.startLine, null);
  assert.equal(result.records[0].source.endLine, null);
});

// @by header tests

test("lintString: @by header basic", () => {
  const text = "@uri local:example\n@by dan@example.com\n\nContent.\n<<< good\n";
  const result = lintString(text, { checkSources: false, checkCanonical: false });
  assert.equal(result.hasErrors, false);
  assert.equal(result.records[0].by, "dan@example.com");
});

test("lintString: @by header with spaces", () => {
  const text = "@uri local:example\n@by Dan Driscoll\n\nContent.\n<<< good\n";
  const result = lintString(text, { checkSources: false, checkCanonical: false });
  assert.equal(result.hasErrors, false);
  assert.equal(result.records[0].by, "Dan Driscoll");
});

test("lintString: @by header with compact record", () => {
  const text = "@uri local:item-001\n@by reviewer@example.com\n@source ./file.txt <<< feedback\n";
  const result = lintString(text, { checkSources: false, checkCanonical: false });
  assert.equal(result.hasErrors, false);
  assert.equal(result.records[0].by, "reviewer@example.com");
});

test("lintString: @by header with @prior", () => {
  const text = "@uri local:gen-001\n@by ai-trainer@example.com\n@prior ./prompts/prompt.txt\n@source ./output.txt\n<<< good\n";
  const result = lintString(text, { checkSources: false, checkCanonical: false });
  assert.equal(result.hasErrors, false);
  assert.equal(result.records[0].by, "ai-trainer@example.com");
  assert.ok(result.records[0].prior !== null);
});

// Character-level referencing tests

test("lintString: @source with single position (line:col)", () => {
  const text = "@source ./code.py:42:10 <<< good\n";
  const result = lintString(text, { checkSources: false, checkCanonical: false });
  assert.equal(result.hasErrors, false);
  assert.equal(result.records[0].source.path, "./code.py");
  assert.equal(result.records[0].source.startLine, 42);
  assert.equal(result.records[0].source.startColumn, 10);
  assert.equal(result.records[0].source.endLine, 42);
  assert.equal(result.records[0].source.endColumn, 10);
});

test("lintString: @source with character range same line", () => {
  const text = "@source ./code.py:42:10-42:25 <<< good\n";
  const result = lintString(text, { checkSources: false, checkCanonical: false });
  assert.equal(result.hasErrors, false);
  assert.equal(result.records[0].source.path, "./code.py");
  assert.equal(result.records[0].source.startLine, 42);
  assert.equal(result.records[0].source.startColumn, 10);
  assert.equal(result.records[0].source.endLine, 42);
  assert.equal(result.records[0].source.endColumn, 25);
});

test("lintString: @source with character range multi-line", () => {
  const text = "@source ./code.py:10:5-15:20 <<< good\n";
  const result = lintString(text, { checkSources: false, checkCanonical: false });
  assert.equal(result.hasErrors, false);
  assert.equal(result.records[0].source.path, "./code.py");
  assert.equal(result.records[0].source.startLine, 10);
  assert.equal(result.records[0].source.startColumn, 5);
  assert.equal(result.records[0].source.endLine, 15);
  assert.equal(result.records[0].source.endColumn, 20);
});

test("lintString: @prior with character range", () => {
  const text = "@prior ./prompts/template.txt:1:1-20:50\n@source ./output.txt\n<<< good\n";
  const result = lintString(text, { checkSources: false, checkCanonical: false });
  assert.equal(result.hasErrors, false);
  assert.equal(result.records[0].prior.path, "./prompts/template.txt");
  assert.equal(result.records[0].prior.startLine, 1);
  assert.equal(result.records[0].prior.startColumn, 1);
  assert.equal(result.records[0].prior.endLine, 20);
  assert.equal(result.records[0].prior.endColumn, 50);
});

test("lintString: invalid character range end col < start col", () => {
  const text = "@source ./code.py:42:25-42:10 <<< good\n";
  const result = lintString(text, { checkSources: false, checkCanonical: false });
  assert.equal(result.hasErrors, true);
  assert.equal(findCode(result.diagnostics, ErrorCode.E011).length, 1);
});

test("lintString: line range without columns still works", () => {
  const text = "@source ./code.py:10-20 <<< good\n";
  const result = lintString(text, { checkSources: false, checkCanonical: false });
  assert.equal(result.hasErrors, false);
  assert.equal(result.records[0].source.startLine, 10);
  assert.equal(result.records[0].source.startColumn, null);
  assert.equal(result.records[0].source.endLine, 20);
  assert.equal(result.records[0].source.endColumn, null);
});

test("lintString: mixed column specification", () => {
  const text = "@source ./code.py:10:5-20 <<< good\n";
  const result = lintString(text, { checkSources: false, checkCanonical: false });
  assert.equal(result.hasErrors, false);
  assert.equal(result.records[0].source.startLine, 10);
  assert.equal(result.records[0].source.startColumn, 5);
  assert.equal(result.records[0].source.endLine, 20);
  assert.equal(result.records[0].source.endColumn, null);
});
