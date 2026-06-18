const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { SidecarRepository } = require("../dist/sidecarRepository.js");
const { parseString } = require("markbackjs");

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mb-vsc-test-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("addRecord: creates sidecar with %markback 2 header on first write", async () => {
  await withTempDir(async (dir) => {
    const sourcePath = path.join(dir, "essay.txt");
    const sidecarPath = path.join(dir, "essay.txt.mb");
    await fs.writeFile(sourcePath, "the lazy fox\n", "utf-8");

    const repo = new SidecarRepository();
    await repo.addRecord({
      sidecarPath,
      sourceAbsPath: sourcePath,
      range: { start: { line: 0, character: 4 }, end: { line: 0, character: 8 } },
      feedback: "awkward",
      by: "alice@example.com",
    });

    const text = await fs.readFile(sidecarPath, "utf-8");
    assert.ok(text.startsWith("%markback 2"), `expected version header; got: ${text}`);
    const result = parseString(text, sidecarPath);
    assert.equal(result.hasErrors, false, result.diagnostics.map((d) => d.toString()).join(", "));
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].feedback, "awkward");
    assert.equal(result.records[0].by, "alice@example.com");
    assert.equal(result.records[0].file.path, "./essay.txt");
    assert.equal(result.records[0].file.startLine, 1);
    assert.equal(result.records[0].file.startColumn, 5);
    assert.equal(result.records[0].file.endLine, 1);
    assert.equal(result.records[0].file.endColumn, 8);
  });
});

test("addReply: persists @reply-to and shares no @file anchor", async () => {
  await withTempDir(async (dir) => {
    const sourcePath = path.join(dir, "essay.txt");
    const sidecarPath = path.join(dir, "essay.txt.mb");
    await fs.writeFile(sourcePath, "the lazy fox\n", "utf-8");

    const repo = new SidecarRepository();
    const { record: parent } = await repo.addRecord({
      sidecarPath,
      sourceAbsPath: sourcePath,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
      feedback: "needs work",
      by: "alice@example.com",
    });
    await repo.addReply({
      sidecarPath,
      parentId: parent.id,
      feedback: "agreed",
      by: "bob@example.com",
    });

    const text = await fs.readFile(sidecarPath, "utf-8");
    const result = parseString(text, sidecarPath);
    assert.equal(result.hasErrors, false);
    assert.equal(result.records.length, 2);
    assert.equal(result.records[1].replyTo, parent.id);
    assert.equal(result.records[1].file, null);
    assert.equal(result.records[1].feedback, "agreed");
  });
});

test("load: returns empty records and no diagnostics when sidecar absent", async () => {
  await withTempDir(async (dir) => {
    const sidecarPath = path.join(dir, "missing.mb");
    const repo = new SidecarRepository();
    const result = await repo.load(sidecarPath);
    assert.equal(result.records.length, 0);
    assert.equal(result.diagnostics.length, 0);
    assert.equal(result.hasErrors, false);
  });
});

test("addRecord: two concurrent calls both land in the sidecar", async () => {
  await withTempDir(async (dir) => {
    const sourcePath = path.join(dir, "essay.txt");
    const sidecarPath = path.join(dir, "essay.txt.mb");
    await fs.writeFile(sourcePath, "alpha\nbeta\n", "utf-8");

    const repo = new SidecarRepository();
    const [r1, r2] = await Promise.all([
      repo.addRecord({
        sidecarPath,
        sourceAbsPath: sourcePath,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
        feedback: "first",
        by: "a@x",
      }),
      repo.addRecord({
        sidecarPath,
        sourceAbsPath: sourcePath,
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } },
        feedback: "second",
        by: "a@x",
      }),
    ]);
    assert.notEqual(r1.record.id, r2.record.id);

    const text = await fs.readFile(sidecarPath, "utf-8");
    const result = parseString(text, sidecarPath);
    assert.equal(result.hasErrors, false);
    assert.equal(result.records.length, 2);
    const feedbacks = result.records.map((r) => r.feedback).sort();
    assert.deepEqual(feedbacks, ["first", "second"]);
  });
});

test("load: parse errors block addRecord with a friendly message", async () => {
  await withTempDir(async (dir) => {
    const sidecarPath = path.join(dir, "broken.mb");
    await fs.writeFile(sidecarPath, "%markback 2\n\nContent without feedback line\n", "utf-8");

    const repo = new SidecarRepository();
    const result = await repo.load(sidecarPath);
    assert.equal(result.hasErrors, true);
    assert.equal(repo.hasParseErrors(sidecarPath), true);

    await assert.rejects(
      repo.addRecord({
        sidecarPath,
        sourceAbsPath: path.join(dir, "broken.txt"),
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        feedback: "x",
        by: null,
      }),
      /parse errors/i,
    );
  });
});

test("addRecord: new sidecar uses injected default EOL (CRLF)", async () => {
  await withTempDir(async (dir) => {
    const sourcePath = path.join(dir, "win.txt");
    const sidecarPath = path.join(dir, "win.txt.mb");
    await fs.writeFile(sourcePath, "the lazy fox\n", "utf-8");

    const repo = new SidecarRepository(undefined, () => "\r\n");
    await repo.addRecord({
      sidecarPath,
      sourceAbsPath: sourcePath,
      range: { start: { line: 0, character: 4 }, end: { line: 0, character: 8 } },
      feedback: "awkward",
      by: null,
    });

    const raw = await fs.readFile(sidecarPath);
    assert.ok(raw.includes("\r\n"), "expected CRLF in new sidecar");
    assert.equal(raw.indexOf(Buffer.from("\n").toString()) >= 0, true);
    // No bare LF that isn't part of CRLF.
    assert.equal(raw.toString().replace(/\r\n/g, "").includes("\n"), false);
  });
});

test("addRecord: existing CRLF sidecar keeps CRLF on append (ignores default)", async () => {
  await withTempDir(async (dir) => {
    const sourcePath = path.join(dir, "doc.txt");
    const sidecarPath = path.join(dir, "doc.txt.mb");
    await fs.writeFile(sourcePath, "alpha\nbeta\n", "utf-8");
    // Seed an existing CRLF sidecar.
    await fs.writeFile(sidecarPath, "%markback 2\r\n\r\n@file ./doc.txt <<< first\r\n", "utf-8");

    // Default says LF, but the existing file's CRLF must win.
    const repo = new SidecarRepository(undefined, () => "\n");
    await repo.addRecord({
      sidecarPath,
      sourceAbsPath: sourcePath,
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } },
      feedback: "second",
      by: null,
    });

    const raw = await fs.readFile(sidecarPath);
    assert.equal(raw.toString().replace(/\r\n/g, "").includes("\n"), false, "should stay CRLF");
    const result = parseString(raw.toString(), sidecarPath);
    assert.equal(result.hasErrors, false);
    assert.equal(result.records.length, 2);
  });
});

test("updateRecord: rewrites a record's feedback in place", async () => {
  await withTempDir(async (dir) => {
    const sourcePath = path.join(dir, "e.txt");
    const sidecarPath = path.join(dir, "e.txt.mb");
    await fs.writeFile(sourcePath, "hello world\n", "utf-8");
    const repo = new SidecarRepository();
    const { record } = await repo.addRecord({
      sidecarPath, sourceAbsPath: sourcePath,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
      feedback: "old", by: null,
    });
    await repo.updateRecord({ sidecarPath, recordId: record.id, feedback: "new feedback" });
    const result = parseString(await fs.readFile(sidecarPath, "utf-8"), sidecarPath);
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].feedback, "new feedback");
  });
});

test("updateRecord: throws for unknown record id", async () => {
  await withTempDir(async (dir) => {
    const sidecarPath = path.join(dir, "e.txt.mb");
    await fs.writeFile(path.join(dir, "e.txt"), "x\n", "utf-8");
    const repo = new SidecarRepository();
    await repo.addRecord({
      sidecarPath, sourceAbsPath: path.join(dir, "e.txt"),
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      feedback: "a", by: null,
    });
    await assert.rejects(repo.updateRecord({ sidecarPath, recordId: "nope", feedback: "x" }), /No record/);
  });
});

test("deleteRecord: removes the record", async () => {
  await withTempDir(async (dir) => {
    const sourcePath = path.join(dir, "e.txt");
    const sidecarPath = path.join(dir, "e.txt.mb");
    await fs.writeFile(sourcePath, "hello world\n", "utf-8");
    const repo = new SidecarRepository();
    const { record } = await repo.addRecord({
      sidecarPath, sourceAbsPath: sourcePath,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
      feedback: "bye", by: null,
    });
    const { removedIds } = await repo.deleteRecord({ sidecarPath, recordId: record.id });
    assert.deepEqual(removedIds, [record.id]);
    const result = parseString(await fs.readFile(sidecarPath, "utf-8"), sidecarPath);
    assert.equal(result.records.length, 0);
  });
});

test("deleteRecord: deleting a parent cascades to its replies", async () => {
  await withTempDir(async (dir) => {
    const sourcePath = path.join(dir, "e.txt");
    const sidecarPath = path.join(dir, "e.txt.mb");
    await fs.writeFile(sourcePath, "hello world\n", "utf-8");
    const repo = new SidecarRepository();
    const { record: parent } = await repo.addRecord({
      sidecarPath, sourceAbsPath: sourcePath,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
      feedback: "parent", by: null,
    });
    const { record: reply } = await repo.addReply({
      sidecarPath, parentId: parent.id, feedback: "reply", by: null,
    });
    const { removedIds } = await repo.deleteRecord({ sidecarPath, recordId: parent.id });
    assert.equal(removedIds.length, 2);
    assert.ok(removedIds.includes(parent.id) && removedIds.includes(reply.id));
    const result = parseString(await fs.readFile(sidecarPath, "utf-8"), sidecarPath);
    assert.equal(result.records.length, 0);
  });
});

test("addRecord with content embeds inline excerpt under @file and round-trips", async () => {
  await withTempDir(async (dir) => {
    const sourcePath = path.join(dir, "essay.txt");
    const sidecarPath = path.join(dir, "essay.txt.mb");
    await fs.writeFile(sourcePath, "the quick brown fox\n", "utf-8");

    const repo = new SidecarRepository();
    await repo.addRecord({
      sidecarPath,
      sourceAbsPath: sourcePath,
      range: { start: { line: 0, character: 4 }, end: { line: 0, character: 9 } },
      feedback: "awkward",
      by: null,
      content: "quick",
    });

    const text = await fs.readFile(sidecarPath, "utf-8");
    // Non-compact form: @file ref, blank line, content, then feedback.
    assert.match(text, /@file \.\/essay\.txt:1:5-1:9\n\nquick\n<<< awkward/);
    const result = parseString(text, sidecarPath);
    assert.equal(result.hasErrors, false, result.diagnostics.map((d) => d.toString()).join(", "));
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].content, "quick");
    assert.equal(result.records[0].feedback, "awkward");
    assert.equal(result.records[0].file.startLine, 1);
  });
});

test("addRecord without content stays compact range-only (regression)", async () => {
  await withTempDir(async (dir) => {
    const sourcePath = path.join(dir, "essay.txt");
    const sidecarPath = path.join(dir, "essay.txt.mb");
    await fs.writeFile(sourcePath, "the quick brown fox\n", "utf-8");

    const repo = new SidecarRepository();
    await repo.addRecord({
      sidecarPath,
      sourceAbsPath: sourcePath,
      range: { start: { line: 0, character: 4 }, end: { line: 0, character: 9 } },
      feedback: "awkward",
      by: null,
    });

    const text = await fs.readFile(sidecarPath, "utf-8");
    assert.match(text, /@file \.\/essay\.txt:1:5-1:9 <<< awkward/);
    const result = parseString(text, sidecarPath);
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].content, null);
  });
});

test("addRecord auto-stamps a created action with actor and injected timestamp (#11)", async () => {
  await withTempDir(async (dir) => {
    const sourcePath = path.join(dir, "essay.txt");
    const sidecarPath = path.join(dir, "essay.txt.mb");
    await fs.writeFile(sourcePath, "the lazy fox\n", "utf-8");

    const repo = new SidecarRepository(undefined, undefined, () => "2026-06-17T10:00:00Z");
    await repo.addRecord({
      sidecarPath,
      sourceAbsPath: sourcePath,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
      feedback: "note",
      by: "dan@example.com",
    });

    const result = parseString(await fs.readFile(sidecarPath, "utf-8"), sidecarPath);
    assert.equal(result.hasErrors, false);
    assert.deepEqual(result.records[0].actions, [
      { verb: "created", timestamp: "2026-06-17T10:00:00Z", actor: "dan@example.com" },
    ]);
  });
});

test("appendAction appends a resolved action and round-trips (#11)", async () => {
  await withTempDir(async (dir) => {
    const sourcePath = path.join(dir, "essay.txt");
    const sidecarPath = path.join(dir, "essay.txt.mb");
    await fs.writeFile(sourcePath, "the lazy fox\n", "utf-8");

    let t = 0;
    const stamps = ["2026-06-17T10:00:00Z", "2026-06-18T14:30:00Z"];
    const repo = new SidecarRepository(undefined, undefined, () => stamps[t++]);
    const { record } = await repo.addRecord({
      sidecarPath,
      sourceAbsPath: sourcePath,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
      feedback: "note",
      by: "dan@example.com",
    });

    await repo.appendAction({
      sidecarPath,
      recordId: record.id,
      verb: "resolved",
      actor: "reviewer two",
    });

    const result = parseString(await fs.readFile(sidecarPath, "utf-8"), sidecarPath);
    assert.equal(result.hasErrors, false);
    assert.deepEqual(result.records[0].actions, [
      { verb: "created", timestamp: "2026-06-17T10:00:00Z", actor: "dan@example.com" },
      { verb: "resolved", timestamp: "2026-06-18T14:30:00Z", actor: "reviewer two" },
    ]);
  });
});

test("appendAction throws for an unknown record id (#11)", async () => {
  await withTempDir(async (dir) => {
    const sourcePath = path.join(dir, "essay.txt");
    const sidecarPath = path.join(dir, "essay.txt.mb");
    await fs.writeFile(sourcePath, "the lazy fox\n", "utf-8");
    const repo = new SidecarRepository();
    await repo.addRecord({
      sidecarPath,
      sourceAbsPath: sourcePath,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
      feedback: "note",
      by: null,
    });
    await assert.rejects(
      () => repo.appendAction({ sidecarPath, recordId: "nope", verb: "resolved", actor: null }),
      /No record nope/,
    );
  });
});

test("appendAction throws when the sidecar has parse errors (#11)", async () => {
  await withTempDir(async (dir) => {
    const sourcePath = path.join(dir, "essay.txt");
    const sidecarPath = path.join(dir, "essay.txt.mb");
    await fs.writeFile(sourcePath, "the lazy fox\n", "utf-8");
    // A record with a header but no <<< feedback is an E001 parse error.
    await fs.writeFile(sidecarPath, "%markback 2\n\n@id c1\n@by dan\n", "utf-8");
    const repo = new SidecarRepository();
    await assert.rejects(
      () => repo.appendAction({ sidecarPath, recordId: "c1", verb: "resolved", actor: null }),
      /parse errors/,
    );
  });
});
