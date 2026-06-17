const test = require("node:test");
const assert = require("node:assert/strict");

const { glyphLine, lineCollides } = require("../dist/focusCollision.js");

const r = (sl, sc, el, ec) => ({
  start: { line: sl, character: sc },
  end: { line: el, character: ec },
});

test("glyphLine: single-line range anchors on its line", () => {
  assert.equal(glyphLine(r(3, 0, 3, 9)), 3);
  assert.equal(glyphLine(r(0, 6, 0, 10)), 0);
});

test("glyphLine: range ending at column 0 of a later line anchors to the previous line", () => {
  // A full-line selection encoded as [L,0]-[L+1,0] shows its glyph on line L.
  assert.equal(glyphLine(r(4, 0, 5, 0)), 4);
});

test("glyphLine: multi-line range with content on the last line anchors there", () => {
  assert.equal(glyphLine(r(2, 3, 4, 7)), 4);
});

test("#9: a second comment on the SAME line collides (route to draft path)", () => {
  const existing = [r(0, 0, 0, 5)]; // "alpha" already commented on line 0
  const newRange = r(0, 12, 0, 17); // "gamma" later on the same line
  assert.equal(lineCollides(newRange, existing), true);
});

test("#9: the first comment on a line does NOT collide (use native add-comment)", () => {
  assert.equal(lineCollides(r(0, 0, 0, 5), []), false);
});

test("#9: a comment on a DIFFERENT line does not collide", () => {
  const existing = [r(0, 0, 0, 5)];
  assert.equal(lineCollides(r(2, 0, 2, 4), existing), false);
});

test("#9: collision is detected against any of several existing threads on the line", () => {
  const existing = [r(5, 0, 5, 3), r(0, 0, 0, 5), r(9, 1, 9, 2)];
  assert.equal(lineCollides(r(0, 8, 0, 12), existing), true);
});

test("#9: an existing multi-line thread ending on the new range's line collides", () => {
  // Existing thread spans lines 2..4; its glyph sits on line 4. A new comment on
  // line 4 would otherwise toggle it.
  const existing = [r(2, 0, 4, 6)];
  assert.equal(lineCollides(r(4, 0, 4, 3), existing), true);
});

test("#9: collision is keyed on the new range's END (glyph) line, not its start", () => {
  // A multi-line new selection [1..3] anchors its glyph on line 3; an existing
  // thread on line 3 collides even though the new selection STARTS on line 1.
  const existing = [r(3, 0, 3, 4)];
  assert.equal(lineCollides(r(1, 2, 3, 6), existing), true);
  // ...and an existing thread on the new range's START line (1) does NOT.
  assert.equal(lineCollides(r(1, 2, 3, 6), [r(1, 0, 1, 4)]), false);
});
