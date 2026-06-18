const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseString,
  writeString,
  writeRecordCanonical,
  Record,
  FileRef,
} = require("../dist/index.js");

test("parses a single @action with actor", () => {
  const r = parseString("@id c1\n@action created 2026-06-17T10:00:00Z dan@example.com\n<<< note");
  assert.equal(r.hasErrors, false);
  assert.deepEqual(r.records[0].actions, [
    { verb: "created", timestamp: "2026-06-17T10:00:00Z", actor: "dan@example.com" },
  ]);
});

test("parses an action without an actor (actor null)", () => {
  const r = parseString("@id c1\n@action created 2026-06-17T10:00:00Z\n<<< note");
  assert.deepEqual(r.records[0].actions, [
    { verb: "created", timestamp: "2026-06-17T10:00:00Z", actor: null },
  ]);
});

test("multiple @action lines accumulate in order", () => {
  const r = parseString(
    "@id c1\n@action created 2026-06-17T10:00:00Z a\n@action resolved 2026-06-18T09:00:00Z b\n<<< note",
  );
  assert.equal(r.records[0].actions.length, 2);
  assert.equal(r.records[0].actions[0].verb, "created");
  assert.equal(r.records[0].actions[1].verb, "resolved");
});

test("actor may contain spaces (preserved verbatim)", () => {
  const r = parseString("@id c1\n@action resolved 2026-06-18T09:00:00Z Reviewer Two\n<<< note");
  assert.equal(r.records[0].actions[0].actor, "Reviewer Two");
});

test("malformed @action (no timestamp) emits W012 and is skipped", () => {
  const r = parseString("@id c1\n@action created\n<<< note");
  assert.ok(r.diagnostics.some((d) => d.code === "W012"), "expected W012");
  assert.equal(r.records[0].actions.length, 0);
});

test("@action is a known header — no W002", () => {
  const r = parseString("@id c1\n@action created 2026-06-17T10:00:00Z\n<<< note");
  assert.ok(!r.diagnostics.some((d) => d.code === "W002"), "no unknown-header warning for @action");
});

test("@action is per-record, NOT inherited across a section", () => {
  const r = parseString(
    "@file ./x.txt\n@action created 2026-06-17T10:00:00Z\n\nfirst\n<<< a\n\nsecond\n<<< b",
  );
  assert.equal(r.records.length, 2);
  assert.equal(r.records[0].actions.length, 1, "first segment keeps its action");
  assert.equal(r.records[1].actions.length, 0, "continuation must not inherit the action");
});

test("writer emits @action after @by, before @tag", () => {
  const rec = new Record({
    feedback: "note",
    id: "c1",
    by: "dan",
    tags: ["x"],
    actions: [{ verb: "created", timestamp: "2026-06-17T10:00:00Z", actor: "dan" }],
    file: new FileRef("./a.txt:1"),
  });
  const out = writeRecordCanonical(rec);
  const lines = out.split("\n");
  const byIdx = lines.findIndex((l) => l.startsWith("@by"));
  const actIdx = lines.findIndex((l) => l.startsWith("@action"));
  const tagIdx = lines.findIndex((l) => l.startsWith("@tag"));
  assert.ok(byIdx < actIdx && actIdx < tagIdx, `order wrong: ${out}`);
});

test("round-trip is a fixpoint, incl. multi-action and space-containing actor on a non-first line", () => {
  const src = `%markback 2

@id c1
@by dan@example.com
@action created 2026-06-17T10:00:00Z dan@example.com
@action resolved 2026-06-18T14:30:00Z Reviewer Two
@file ./login.py:42

if user.is_admin:
<<< this branch never fires
`;
  const first = parseString(src);
  assert.equal(first.hasErrors, false);
  const out = writeString(first.records);
  const second = parseString(out);
  assert.deepEqual(second.records[0].actions, first.records[0].actions);
  assert.equal(writeString(second.records), out, "write→parse→write is stable");
});

test("a record with actions writes full form (not a dropped continuation)", () => {
  const records = [
    new Record({
      feedback: "a",
      file: new FileRef("./x.txt"),
      content: "first",
    }),
    new Record({
      feedback: "b",
      file: new FileRef("./x.txt"),
      content: "second",
      actions: [{ verb: "created", timestamp: "2026-06-17T10:00:00Z", actor: null }],
    }),
  ];
  const out = writeString(records);
  const back = parseString(out);
  assert.equal(back.records.length, 2);
  assert.equal(back.records[1].actions.length, 1, "action survived (record not written as a header-less continuation)");
});
