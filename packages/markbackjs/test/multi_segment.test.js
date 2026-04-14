const test = require("node:test");
const assert = require("node:assert/strict");

const { parseString, writeString, Record, FileRef } = require("../dist/index.js");

test("multi-segment: file inherited across segments", () => {
  const text = [
    "@file ./essay.txt",
    "",
    "the lazy fox",
    "<<< awkward",
    "",
    "weak ending",
    "<<< needs punch",
    "",
  ].join("\n");
  const result = parseString(text);
  assert.equal(result.hasErrors, false);
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].file.toString(), "./essay.txt");
  assert.equal(result.records[1].file.toString(), "./essay.txt");
  assert.equal(result.records[0].feedback, "awkward");
  assert.equal(result.records[1].feedback, "needs punch");
});

test("multi-segment: --- resets section", () => {
  const text = [
    "@file ./essay.txt",
    "",
    "fox",
    "<<< awkward",
    "---",
    "@file ./code.py",
    "",
    "import",
    "<<< unused",
    "",
  ].join("\n");
  const result = parseString(text);
  assert.equal(result.hasErrors, false);
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].file.toString(), "./essay.txt");
  assert.equal(result.records[1].file.toString(), "./code.py");
});

test("multi-segment: id is per-record, not inherited", () => {
  const text = [
    "@id seg1",
    "@file ./doc.txt",
    "",
    "first",
    "<<< note 1",
    "",
    "second",
    "<<< note 2",
    "",
  ].join("\n");
  const result = parseString(text);
  assert.equal(result.records[0].id, "seg1");
  assert.equal(result.records[1].id, null);
});

test("multi-segment: writer groups records sharing @file", () => {
  const records = [
    new Record({ file: new FileRef("./essay.txt"), content: "fox", feedback: "awkward" }),
    new Record({ file: new FileRef("./essay.txt"), content: "ending", feedback: "weak" }),
  ];
  const text = writeString(records, { versionHeader: false });
  const fileMatches = text.match(/@file \.\/essay\.txt/g) ?? [];
  assert.equal(fileMatches.length, 1);
  assert.equal(text.includes("---"), false);
  assert.match(text, /<<< awkward/);
  assert.match(text, /<<< weak/);
});

test("multi-segment: writer roundtrip", () => {
  const records = [
    new Record({ file: new FileRef("./essay.txt"), content: "fox", feedback: "awkward" }),
    new Record({ file: new FileRef("./essay.txt"), content: "ending", feedback: "weak" }),
    new Record({ file: new FileRef("./essay.txt"), content: "middle", feedback: "trim" }),
  ];
  const text = writeString(records);
  const result = parseString(text);
  assert.equal(result.hasErrors, false);
  assert.equal(result.records.length, 3);
  for (let i = 0; i < records.length; i += 1) {
    assert.equal(result.records[i].file.toString(), records[i].file.toString());
    assert.equal(result.records[i].content, records[i].content);
    assert.equal(result.records[i].feedback, records[i].feedback);
  }
});
