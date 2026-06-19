const test = require("node:test");
const assert = require("node:assert/strict");

// inject.js is the verbatim-injected webview script. It is NOT compiled to
// dist/ (it ships from src/ via package.json `markdown.previewScripts`), so —
// unlike every other unit test in this dir — we require it straight from src.
// Requiring it under node is safe: its IIFE returns immediately because
// `window` is undefined, and only the pure helpers are exported via the tail.
const { wordDeleteStart, isSpace } = require("../src/preview/inject.js");

// Convenience: the substring that an Alt+Backspace at `caret` would remove,
// and the resulting value (no selection case).
function afterDelete(text, caret) {
  const from = wordDeleteStart(text, caret);
  return text.slice(0, from) + text.slice(caret);
}

test("deletes the word to the left of the caret", () => {
  assert.equal(wordDeleteStart("foo bar", 7), 4);
  assert.equal(afterDelete("foo bar", 7), "foo ");
});

test("deletes trailing whitespace AND the preceding word in one stroke", () => {
  assert.equal(wordDeleteStart("foo bar ", 8), 4);
  assert.equal(afterDelete("foo bar ", 8), "foo ");
});

test("a single word with caret at end deletes back to start", () => {
  assert.equal(wordDeleteStart("foo", 3), 0);
  assert.equal(afterDelete("foo", 3), "");
});

test("caret at 0 is a no-op (boundary equals caret)", () => {
  assert.equal(wordDeleteStart("foo bar", 0), 0);
  assert.equal(wordDeleteStart("", 0), 0);
});

test("whitespace-only run left of caret is fully deleted", () => {
  assert.equal(wordDeleteStart("   ", 3), 0);
  assert.equal(wordDeleteStart("foo   ", 6), 0); // eats the 3 spaces then "foo"
  assert.equal(afterDelete("foo   ", 6), "");
});

test("word plus its leading spaces are removed together", () => {
  assert.equal(wordDeleteStart("a    ", 5), 0);
  assert.equal(afterDelete("a    ", 5), "");
});

test("mid-string caret deletes only the word left of it, leaving the tail", () => {
  // "foo bar baz", caret after "bar" (index 7): boundary at 4, removes "bar".
  assert.equal(wordDeleteStart("foo bar baz", 7), 4);
  assert.equal(afterDelete("foo bar baz", 7), "foo  baz");
});

test("a newline counts as whitespace and bounds the word", () => {
  assert.equal(wordDeleteStart("foo\nbar", 7), 4); // stops at the \n, removes "bar"
  assert.equal(afterDelete("foo\nbar", 7), "foo\n");
  // caret right after the newline eats the newline and the word before it
  assert.equal(wordDeleteStart("foo\nbar", 4), 0);
});

test("tab is whitespace", () => {
  assert.equal(wordDeleteStart("foo\tbar", 7), 4);
});

test("caret beyond the string length is clamped", () => {
  assert.equal(wordDeleteStart("ab", 99), 0);
});

test("negative caret is clamped to 0", () => {
  assert.equal(wordDeleteStart("ab", -5), 0);
});

test("isSpace recognizes the ASCII whitespace set and rejects others", () => {
  for (const ch of [" ", "\t", "\n", "\r", "\f", "\v"]) assert.equal(isSpace(ch), true);
  // Non-word chars plus a trailing U+00A0 (non-breaking space), which we
  // deliberately do NOT treat as a boundary — keeps behavior engine-independent.
  for (const ch of ["a", "_", ".", "0", " "]) assert.equal(isSpace(ch), false);
});
