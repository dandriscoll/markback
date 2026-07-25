const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// The generated header registry (dist/_headers.js, from src/_headers.ts) must
// stay in sync with shared/headers.json — the one source of truth for headers
// across the Python and JS libraries (issue #13).
const _headers = require("../dist/_headers.js");
const source = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "..", "shared", "headers.json"), "utf-8"),
);

test("headers: KNOWN_HEADERS matches shared/headers.json", () => {
  assert.deepEqual([..._headers.KNOWN_HEADERS].sort(), [...source.known].sort());
});

test("headers: CANONICAL_ORDER matches shared/headers.json", () => {
  assert.deepEqual(_headers.CANONICAL_ORDER, source.canonical_order);
});

test("headers: SECTION_INHERITED matches shared/headers.json", () => {
  assert.deepEqual([..._headers.SECTION_INHERITED].sort(), [...source.section_inherited].sort());
});

test("headers: V1_HEADER_MAP matches shared/headers.json", () => {
  assert.deepEqual(_headers.V1_HEADER_MAP, source.v1_map);
});
