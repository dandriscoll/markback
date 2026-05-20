const test = require("node:test");
const assert = require("node:assert/strict");

const {
  sidecarPathFor,
  sourcePathFor,
  isSidecar,
  relativeFromSidecar,
} = require("../dist/sidecarPath.js");

test("sidecarPathFor: text file gets .mb suffix", () => {
  assert.equal(sidecarPathFor("/tmp/essay.txt"), "/tmp/essay.txt.mb");
});

test("sidecarPathFor: extensionless file gets .mb suffix", () => {
  assert.equal(sidecarPathFor("/tmp/Makefile"), "/tmp/Makefile.mb");
});

test("sourcePathFor: round-trip", () => {
  assert.equal(sourcePathFor("/tmp/essay.txt.mb"), "/tmp/essay.txt");
});

test("sourcePathFor: non-sidecar returns null", () => {
  assert.equal(sourcePathFor("/tmp/essay.txt"), null);
});

test("isSidecar: .mb suffix detected", () => {
  assert.equal(isSidecar("/tmp/foo.mb"), true);
  assert.equal(isSidecar("/tmp/foo.txt"), false);
});

test("relativeFromSidecar: same dir gets ./ prefix", () => {
  const rel = relativeFromSidecar("/tmp/essay.txt", "/tmp/essay.txt.mb");
  assert.equal(rel, "./essay.txt");
});

test("relativeFromSidecar: subdir gets ./ prefix", () => {
  const rel = relativeFromSidecar("/tmp/sub/foo.txt", "/tmp/foo.txt.mb");
  assert.equal(rel, "./sub/foo.txt");
});

test("relativeFromSidecar: parent dir keeps ../", () => {
  const rel = relativeFromSidecar("/tmp/foo.txt", "/tmp/sub/foo.txt.mb");
  assert.equal(rel, "../foo.txt");
});
