"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { parseString, lintString, detectEol, applyEol } = require("../dist/index.js");

test("parser normalizes CRLF — no stray CR leaks into content", () => {
  const text = "%markback 2\r\n\r\n@id x\r\n\r\nline one\r\nline two\r\n<<< note\r\n";
  const result = parseString(text);
  assert.strictEqual(result.diagnostics.filter((d) => d.severity === "error").length, 0);
  const rec = result.records[0];
  assert.ok(!(rec.content || "").includes("\r"));
  assert.deepStrictEqual((rec.content || "").split("\n"), ["line one", "line two"]);
});

test("linter canonical check is EOL-agnostic", () => {
  const lf = "@file ./a.txt <<< ok\n";
  const crlf = lf.replace(/\n/g, "\r\n");
  const codesLf = lintString(lf).diagnostics.map((d) => d.code).sort();
  const codesCrlf = lintString(crlf).diagnostics.map((d) => d.code).sort();
  assert.deepStrictEqual(codesLf, codesCrlf);
});

test("detectEol", () => {
  assert.strictEqual(detectEol("a\r\nb\r\n"), "\r\n");
  assert.strictEqual(detectEol("a\nb\n"), "\n");
  assert.strictEqual(detectEol("no newline"), "\n");
});

test("applyEol translates LF-canonical to target EOL", () => {
  assert.strictEqual(applyEol("a\nb\n", "\r\n"), "a\r\nb\r\n");
  assert.strictEqual(applyEol("a\nb\n", "\n"), "a\nb\n");
  // pre-existing CRLF is collapsed first, never doubled
  assert.strictEqual(applyEol("a\r\nb\r\n", "\r\n"), "a\r\nb\r\n");
});
