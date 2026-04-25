const test = require("node:test");
const assert = require("node:assert/strict");

const { parseString, writeString, writeRecordCanonical, Record, FileRef } = require("../dist/index.js");

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

// @reply-to writer tests

test("writer: @reply-to in compact record", () => {
  const record = new Record({
    id: "c2",
    replyTo: "c1",
    file: new FileRef("./a.txt"),
    feedback: "a reply",
  });
  const out = writeRecordCanonical(record);
  assert.ok(out.includes("@reply-to c1"));
  // @reply-to appears immediately after @id
  const lines = out.split("\n");
  const rtIdx = lines.findIndex((l) => l.startsWith("@reply-to"));
  const idIdx = lines.findIndex((l) => l.startsWith("@id"));
  assert.equal(rtIdx, idIdx + 1);
});

test("writer: @reply-to in full record", () => {
  const record = new Record({
    id: "c2",
    replyTo: "c1",
    content: "Some content.",
    feedback: "my reply",
  });
  const out = writeRecordCanonical(record);
  assert.ok(out.includes("@reply-to c1"));
});

test("writer: multiline feedback emits fence", () => {
  const record = new Record({
    id: "c1",
    file: new FileRef("./a.txt"),
    feedback: "line one\nline two",
  });
  const out = writeRecordCanonical(record);
  assert.ok(out.includes('<<< """'));
  assert.ok(out.trimEnd().endsWith('"""'));
  // Multi-line feedback forces full (non-compact) layout
  assert.ok(!out.includes("@file ./a.txt <<<"));
});

test("writer: single-line feedback no fence", () => {
  const record = new Record({
    id: "c1",
    file: new FileRef("./a.txt"),
    feedback: "simple feedback",
  });
  const out = writeRecordCanonical(record);
  assert.ok(!out.includes('"""'));
});

test("writer: fenced feedback roundtrip", () => {
  const text =
    '@id c1\n@file ./a.txt\n<<< """\n' +
    "multi\nline\n" +
    '"""\n';
  const result = parseString(text);
  assert.equal(result.hasErrors, false);
  assert.equal(result.records[0].feedback, "multi\nline");
  const written = writeString(result.records, { versionHeader: false });
  const reparsed = parseString(written);
  assert.equal(reparsed.records[0].feedback, "multi\nline");
});

test("writer: roundtrip preserves reply-to", () => {
  const text =
    "@id c1\n@file ./a.txt <<< original\n" +
    "@id c2\n@reply-to c1\n@file ./a.txt <<< a reply\n";
  const result = parseString(text);
  assert.deepEqual(result.records.map((r) => r.replyTo), [null, "c1"]);
  const written = writeString(result.records, { versionHeader: false });
  const reparsed = parseString(written);
  assert.deepEqual(reparsed.records.map((r) => r.replyTo), [null, "c1"]);
});
