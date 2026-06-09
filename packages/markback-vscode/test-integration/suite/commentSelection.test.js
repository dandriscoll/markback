const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const vscode = require("vscode");

const EXT_ID = "dandriscoll.markback-vscode";

let tempDir;

async function getTestApi() {
  const ext = vscode.extensions.getExtension(EXT_ID);
  assert.ok(ext, `extension ${EXT_ID} not found`);
  const exports = ext.isActive ? ext.exports : await ext.activate();
  assert.ok(exports && exports._testApi, "extension did not return _testApi");
  return exports._testApi;
}

async function openTestFile(content, ext = ".txt") {
  const filename = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  const filepath = path.join(tempDir, filename);
  await fs.writeFile(filepath, content, "utf8");
  const uri = vscode.Uri.file(filepath);
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc, { preview: false });
  return { editor, uri, filepath };
}

before(async function () {
  this.timeout(30000);
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "markback-itest-"));
});

after(async () => {
  if (tempDir) {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

describe("markback.commentSelection — empirical coverage", function () {
  this.timeout(20000);

  it("focus-handoff target command is registered in VS Code", async () => {
    const cmds = await vscode.commands.getCommands(true);
    assert.ok(
      cmds.includes("workbench.action.focusCommentOnCurrentLine"),
      "workbench.action.focusCommentOnCurrentLine must be a registered VS Code command — if this fails, createDraftThread's focus call degrades to a warn-log and the user sees pre-fix behavior",
    );
  });

  it("non-empty selection anchors the draft on the selection (regression guard)", async () => {
    const api = await getTestApi();
    const { editor, uri } = await openTestFile("alpha beta gamma\n");
    const start = new vscode.Position(0, 6);
    const end = new vscode.Position(0, 10);
    editor.selection = new vscode.Selection(start, end);

    await vscode.commands.executeCommand("markback.commentSelection");

    assert.ok(api.hasDraftForSource(uri), "expected a draft on the selection");
    const range = api.getDraftRangeForSource(uri);
    assert.equal(range.start.line, 0);
    assert.equal(range.start.character, 6);
    assert.equal(range.end.line, 0);
    assert.equal(range.end.character, 10);
  });

  it("v0.2.6: no selection on a word anchors the draft on the word", async () => {
    const api = await getTestApi();
    const { editor, uri } = await openTestFile("alpha beta gamma\n");
    editor.selection = new vscode.Selection(0, 7, 0, 7);

    await vscode.commands.executeCommand("markback.commentSelection");

    assert.ok(api.hasDraftForSource(uri), "expected a draft on the word");
    const range = api.getDraftRangeForSource(uri);
    assert.equal(range.start.line, 0);
    assert.equal(range.end.line, 0);
    assert.equal(range.start.character, 6);
    assert.equal(range.end.character, 10);
  });

  it("v0.2.6: no selection on whitespace within a non-blank line anchors on the line", async () => {
    const api = await getTestApi();
    // Two consecutive spaces give us a position with non-word chars on BOTH
    // sides — VS Code's getWordRangeAtPosition returns undefined only when
    // the position is not adjacent to any word character. A position at the
    // end of a word (e.g. col 5 in "alpha beta") is still INSIDE the word
    // range per VS Code's word-boundary semantics, so it would fall back to
    // the word, not the line. The double-space below isolates a truly
    // non-word position at col 6.
    const lineText = "alpha  beta gamma";
    const { editor, uri } = await openTestFile(`${lineText}\n`);
    editor.selection = new vscode.Selection(0, 6, 0, 6);

    await vscode.commands.executeCommand("markback.commentSelection");

    assert.ok(api.hasDraftForSource(uri), "expected a draft on the line");
    const range = api.getDraftRangeForSource(uri);
    assert.equal(range.start.line, 0);
    assert.equal(range.start.character, 0);
    assert.equal(range.end.line, 0);
    assert.equal(range.end.character, lineText.length);
  });

  it("v0.2.6: no selection on a blank line creates no draft (info-message branch)", async () => {
    const api = await getTestApi();
    const { editor, uri } = await openTestFile("alpha\n\nbeta\n");
    editor.selection = new vscode.Selection(1, 0, 1, 0);

    await vscode.commands.executeCommand("markback.commentSelection");

    assert.ok(
      !api.hasDraftForSource(uri),
      "expected NO draft on a blank line — handler should fall through to the info-message abort",
    );
  });
});
