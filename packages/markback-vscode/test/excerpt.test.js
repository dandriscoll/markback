const test = require("node:test");
const assert = require("node:assert/strict");

const {
  decideExcerpt,
  manageableExcerpt,
  DEFAULT_EXCERPT_OPTIONS,
} = require("../dist/excerpt.js");

const OPTS = DEFAULT_EXCERPT_OPTIONS;

test("manageable single line is embedded verbatim", () => {
  const d = decideExcerpt("the quick brown fox", OPTS);
  assert.equal(d.omitted, null);
  assert.equal(d.content, "the quick brown fox");
});

test("manageable short paragraph is embedded", () => {
  const para = "first line\nsecond line\nthird line";
  assert.equal(manageableExcerpt(para, OPTS), para);
});

test("leading/trailing blank lines are trimmed (matches writer normalization)", () => {
  const d = decideExcerpt("\n\n  body  \n\n", OPTS);
  assert.equal(d.content, "  body  ");
});

test("CRLF selection is measured by logical lines and normalized to LF", () => {
  const d = decideExcerpt("alpha\r\nbeta\r\ngamma", OPTS);
  assert.equal(d.omitted, null);
  assert.equal(d.content, "alpha\nbeta\ngamma");
});

test("empty / whitespace-only selection is omitted", () => {
  assert.equal(decideExcerpt("", OPTS).omitted, "empty");
  assert.equal(decideExcerpt("   \n  \n", OPTS).omitted, "empty");
});

test("disabled never embeds", () => {
  const d = decideExcerpt("anything", { ...OPTS, enabled: false });
  assert.equal(d.omitted, "disabled");
  assert.equal(d.content, null);
});

test("too many lines is omitted", () => {
  const text = Array.from({ length: 11 }, (_, i) => `line ${i}`).join("\n");
  assert.equal(decideExcerpt(text, { ...OPTS, maxLines: 10 }).omitted, "too-large");
});

test("too many chars is omitted", () => {
  const text = "x".repeat(601);
  assert.equal(decideExcerpt(text, { ...OPTS, maxChars: 600 }).omitted, "too-large");
});

// --- round-trip safety: content the parser would reclassify must be rejected,
// and the hazard is placed on a NON-first line so a first-line-only check can't
// pass the guard for the wrong reason. ---

test("content with a bare --- separator line is rejected (round-trip unsafe)", () => {
  const text = "intro paragraph\n---\nrest of section";
  assert.equal(decideExcerpt(text, OPTS).omitted, "unsafe-roundtrip");
});

test("content with a leading <<< line is rejected (round-trip unsafe)", () => {
  const text = "some code\n<<< not feedback, just source";
  assert.equal(decideExcerpt(text, OPTS).omitted, "unsafe-roundtrip");
});

test("content that is a compact-record line is rejected (round-trip unsafe)", () => {
  const text = "a comment about\n@file ./x.py <<< inline";
  assert.equal(decideExcerpt(text, OPTS).omitted, "unsafe-roundtrip");
});

test("Python triple-quote docstring content is ACCEPTED (not over-rejected)", () => {
  const text = 'def f():\n    """docstring."""\n    return 1';
  const d = decideExcerpt(text, OPTS);
  assert.equal(d.omitted, null, "triple-quotes are safe in content");
  assert.equal(d.content, text);
});

test("content line containing (but not starting with) <<< is accepted", () => {
  const text = "shift = a << b; mask = c <<< d;";
  assert.equal(decideExcerpt(text, OPTS).content, text);
});

// Finding 1: an interior blank line that carried spaces is a SAFE shape (it only
// loses whitespace on an empty line). It must be embedded — in the canonical form
// a write→read cycle yields — not rejected as unsafe.
test("interior whitespace-only line is accepted and stored canonically", () => {
  const d = decideExcerpt("a\n  \nb", OPTS);
  assert.equal(d.omitted, null, "benign interior-whitespace must not be rejected");
  assert.equal(d.content, "a\n\nb");
});

test("non-blank trailing-whitespace content line is accepted verbatim", () => {
  const text = "code here   \nmore code";
  assert.equal(decideExcerpt(text, OPTS).content, text);
});
