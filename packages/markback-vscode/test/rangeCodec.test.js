const test = require("node:test");
const assert = require("node:assert/strict");

const {
  vsRangeToMarkback,
  markbackToVsRange,
  formatRangeForFileRef,
} = require("../dist/rangeCodec.js");

test("vsRangeToMarkback: single-line selection adds +1 to start, leaves end-char as inclusive", () => {
  const result = vsRangeToMarkback({
    start: { line: 0, character: 5 },
    end: { line: 0, character: 10 },
  });
  assert.deepEqual(result, {
    startLine: 1,
    startColumn: 6,
    endLine: 1,
    endColumn: 10,
  });
});

test("vsRangeToMarkback: multi-line selection with non-zero end-char", () => {
  const result = vsRangeToMarkback({
    start: { line: 2, character: 3 },
    end: { line: 4, character: 7 },
  });
  assert.deepEqual(result, {
    startLine: 3,
    startColumn: 4,
    endLine: 5,
    endColumn: 7,
  });
});

test("vsRangeToMarkback: end-char=0 across lines collapses to line-only end", () => {
  const result = vsRangeToMarkback({
    start: { line: 2, character: 0 },
    end: { line: 4, character: 0 },
  });
  assert.deepEqual(result, {
    startLine: 3,
    startColumn: 1,
    endLine: 4,
    endColumn: null,
  });
});

test("round-trip: single-line", () => {
  const original = {
    start: { line: 0, character: 5 },
    end: { line: 0, character: 10 },
  };
  const back = markbackToVsRange(vsRangeToMarkback(original));
  assert.deepEqual(back, original);
});

test("round-trip: multi-line non-zero-end", () => {
  const original = {
    start: { line: 2, character: 3 },
    end: { line: 4, character: 7 },
  };
  const back = markbackToVsRange(vsRangeToMarkback(original));
  assert.deepEqual(back, original);
});

test("round-trip: multi-line end-char=0", () => {
  const original = {
    start: { line: 2, character: 0 },
    end: { line: 4, character: 0 },
  };
  const back = markbackToVsRange(vsRangeToMarkback(original));
  assert.deepEqual(back, original);
});

test("formatRangeForFileRef: full char-precise", () => {
  const s = formatRangeForFileRef({
    startLine: 3,
    startColumn: 4,
    endLine: 5,
    endColumn: 7,
  });
  assert.equal(s, ":3:4-5:7");
});

test("formatRangeForFileRef: line-only end (endColumn null)", () => {
  const s = formatRangeForFileRef({
    startLine: 3,
    startColumn: 1,
    endLine: 4,
    endColumn: null,
  });
  assert.equal(s, ":3:1-4");
});

test("markbackToVsRange: line-only end produces start-of-next-line position", () => {
  const r = markbackToVsRange({
    startLine: 3,
    startColumn: 1,
    endLine: 4,
    endColumn: null,
  });
  assert.deepEqual(r.start, { line: 2, character: 0 });
  assert.deepEqual(r.end, { line: 4, character: 0 });
});
