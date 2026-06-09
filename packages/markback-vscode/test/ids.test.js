const test = require("node:test");
const assert = require("node:assert/strict");

const { generateRecordId } = require("../dist/ids.js");

test("generateRecordId: matches expected shape", () => {
  const id = generateRecordId();
  assert.match(id, /^[a-z0-9]{4}-[a-z0-9]{4}$/);
});

test("generateRecordId: two consecutive ids differ", () => {
  const a = generateRecordId();
  const b = generateRecordId();
  assert.notEqual(a, b);
});
