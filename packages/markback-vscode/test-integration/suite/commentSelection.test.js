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

  // commentSelection drives VS Code's built-in add-comment flow (the only
  // public path that focuses the reply INPUT). It first aligns the editor
  // selection to the resolved comment range, so the post-command selection is
  // the observable for range resolution. We can't read comment-input focus
  // through any public API, so the reply-box focus itself is verified by hand
  // in the Extension Development Host (see CHANGELOG 0.3.1).

  it("the built-in add-comment command this relies on is registered", async () => {
    await getTestApi(); // ensure the extension (and its commenting range) is active
    const cmds = await vscode.commands.getCommands(true);
    assert.ok(
      cmds.includes("workbench.action.addComment"),
      "workbench.action.addComment must exist — commentSelection delegates to it to focus the reply input",
    );
  });

  it("non-empty selection: comment range is the selection (regression guard)", async () => {
    await getTestApi();
    const { editor } = await openTestFile("alpha beta gamma\n");
    editor.selection = new vscode.Selection(0, 6, 0, 10);

    await vscode.commands.executeCommand("markback.commentSelection");

    const sel = editor.selection;
    assert.equal(sel.start.line, 0);
    assert.equal(sel.start.character, 6);
    assert.equal(sel.end.line, 0);
    assert.equal(sel.end.character, 10);
  });

  it("v0.2.6: no selection on a word expands the range to the word", async () => {
    await getTestApi();
    const { editor } = await openTestFile("alpha beta gamma\n");
    editor.selection = new vscode.Selection(0, 7, 0, 7);

    await vscode.commands.executeCommand("markback.commentSelection");

    const sel = editor.selection;
    assert.equal(sel.start.line, 0);
    assert.equal(sel.end.line, 0);
    assert.equal(sel.start.character, 6);
    assert.equal(sel.end.character, 10);
  });

  it("v0.2.6: no selection on whitespace within a non-blank line expands to the line", async () => {
    await getTestApi();
    // Two consecutive spaces give us a position with non-word chars on BOTH
    // sides — VS Code's getWordRangeAtPosition returns undefined only when
    // the position is not adjacent to any word character. A position at the
    // end of a word (e.g. col 5 in "alpha beta") is still INSIDE the word
    // range per VS Code's word-boundary semantics, so it would fall back to
    // the word, not the line. The double-space below isolates a truly
    // non-word position at col 6.
    const lineText = "alpha  beta gamma";
    const { editor } = await openTestFile(`${lineText}\n`);
    editor.selection = new vscode.Selection(0, 6, 0, 6);

    await vscode.commands.executeCommand("markback.commentSelection");

    const sel = editor.selection;
    assert.equal(sel.start.line, 0);
    assert.equal(sel.start.character, 0);
    assert.equal(sel.end.line, 0);
    assert.equal(sel.end.character, lineText.length);
  });

  it("v0.2.6: no selection on a blank line is a no-op (info-message branch)", async () => {
    await getTestApi();
    const { editor } = await openTestFile("alpha\n\nbeta\n");
    editor.selection = new vscode.Selection(1, 0, 1, 0);

    await vscode.commands.executeCommand("markback.commentSelection");

    // resolveCommentRange returns null on a blank line, so the handler aborts
    // before touching the selection or creating any comment.
    const sel = editor.selection;
    assert.ok(sel.isEmpty, "expected the selection to remain collapsed");
    assert.equal(sel.active.line, 1);
    assert.equal(sel.active.character, 0);
  });
});
