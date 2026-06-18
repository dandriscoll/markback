const test = require("node:test");
const assert = require("node:assert/strict");

const { isResolved } = require("../dist/actionState.js");

const A = (verb) => ({ verb, timestamp: "2026-06-17T10:00:00Z", actor: null });

test("no actions ⇒ unresolved", () => {
  assert.equal(isResolved([]), false);
});

test("created only ⇒ unresolved", () => {
  assert.equal(isResolved([A("created")]), false);
});

test("created then resolved ⇒ resolved", () => {
  assert.equal(isResolved([A("created"), A("resolved")]), true);
});

test("resolved then reopened ⇒ unresolved (last wins)", () => {
  assert.equal(isResolved([A("created"), A("resolved"), A("reopened")]), false);
});

test("re-resolved after reopen ⇒ resolved", () => {
  assert.equal(isResolved([A("resolved"), A("reopened"), A("resolved")]), true);
});

test("unknown verbs after a resolve do not change state", () => {
  assert.equal(isResolved([A("resolved"), A("noted")]), true);
});
