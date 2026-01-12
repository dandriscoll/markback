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
