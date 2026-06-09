const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { Record, FileRef } = require("markbackjs");
const { projectRecordsToThreads } = require("../dist/projection.js");

const SIDECAR = path.resolve("/tmp/work/essay.txt.mb");
const SOURCE = path.resolve("/tmp/work/essay.txt");

function makeParent(id, rangeStr, feedback) {
  return new Record({
    id,
    feedback,
    file: new FileRef(`./essay.txt${rangeStr}`),
  });
}

function makeReply(id, replyTo, feedback) {
  return new Record({ id, replyTo, feedback });
}

test("projection: single parent record yields one thread with one comment", () => {
  const records = [makeParent("p1", ":1:6-1:10", "awkward")];
  const { threads, warnings } = projectRecordsToThreads({
    records,
    sourceAbsPath: SOURCE,
    sidecarAbsPath: SIDECAR,
  });
  assert.equal(threads.length, 1);
  assert.equal(threads[0].parentRecordId, "p1");
  assert.equal(threads[0].comments.length, 1);
  assert.equal(threads[0].comments[0].body, "awkward");
  assert.equal(warnings.length, 0);
});

test("projection: parent + two replies chained via reply-to land in one thread, in order", () => {
  const records = [
    makeParent("p1", ":1:6-1:10", "awkward"),
    makeReply("r1", "p1", "agree"),
    makeReply("r2", "r1", "fixed it"),
  ];
  const { threads, warnings } = projectRecordsToThreads({
    records,
    sourceAbsPath: SOURCE,
    sidecarAbsPath: SIDECAR,
  });
  assert.equal(threads.length, 1);
  assert.equal(threads[0].comments.length, 3);
  assert.deepEqual(
    threads[0].comments.map((c) => c.recordId),
    ["p1", "r1", "r2"],
  );
});

test("projection: reply with unknown parent emits warning and is skipped", () => {
  const records = [makeReply("r-orphan", "p-missing", "lonely")];
  const { threads, warnings } = projectRecordsToThreads({
    records,
    sourceAbsPath: SOURCE,
    sidecarAbsPath: SIDECAR,
  });
  assert.equal(threads.length, 0);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].kind, "missingParent");
});

test("projection: out-of-bounds startLine emits warning", () => {
  const records = [makeParent("p1", ":50:1-50:5", "off the end")];
  const { warnings } = projectRecordsToThreads({
    records,
    sourceAbsPath: SOURCE,
    sidecarAbsPath: SIDECAR,
    sourceLineCount: 10,
  });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].kind, "rangeOutOfBounds");
  assert.equal(warnings[0].recordLine, 50);
  assert.equal(warnings[0].sourceLineCount, 10);
});

test("projection: record anchoring a different file is skipped", () => {
  const records = [
    new Record({
      id: "p1",
      feedback: "elsewhere",
      file: new FileRef("./other.txt:1:1-1:5"),
    }),
  ];
  const { threads } = projectRecordsToThreads({
    records,
    sourceAbsPath: SOURCE,
    sidecarAbsPath: SIDECAR,
  });
  assert.equal(threads.length, 0);
});

test("projection: range converts back to VS Code 0-indexed correctly", () => {
  const records = [makeParent("p1", ":1:6-1:10", "x")];
  const { threads } = projectRecordsToThreads({
    records,
    sourceAbsPath: SOURCE,
    sidecarAbsPath: SIDECAR,
  });
  assert.deepEqual(threads[0].range, {
    start: { line: 0, character: 5 },
    end: { line: 0, character: 10 },
  });
});
