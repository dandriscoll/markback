// Integration specs for issues #9 (second comment on the same line) and #8
// (cancelling an edit). These exercise the real VS Code extension-host runtime.
// The dev sandbox cannot launch the Electron harness (missing GUI libs, e.g.
// libgtk-3.so.0), so these run in CI / on an operator machine.

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

// Open a source file and seed its `.mb` sidecar with one comment anchored on
// line 1, cols 1-6 — then re-open so the sidecar projects into a thread.
async function openWithSeededComment(name, content, feedback) {
  const base = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${name}`;
  const src = path.join(tempDir, `${base}.txt`);
  await fs.writeFile(src, content, "utf8");
  const srcBase = path.basename(src);
  await fs.writeFile(
    `${src}.mb`,
    `%markback 2\n\n@id aaaa-bbbb\n@file ./${srcBase}:1:1-1:6 <<< ${feedback}\n`,
    "utf8",
  );
  const uri = vscode.Uri.file(src);
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });
  return uri;
}

async function openPlain(name, content) {
  const base = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${name}`;
  const src = path.join(tempDir, `${base}.txt`);
  await fs.writeFile(src, content, "utf8");
  const uri = vscode.Uri.file(src);
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc, { preview: false });
  return { editor, uri };
}

async function waitFor(predicate, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

function bodyText(body) {
  return typeof body === "string" ? body : body.value;
}

before(async function () {
  this.timeout(30000);
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "markback-multicancel-"));
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

describe("#9 — second comment on the same line", function () {
  this.timeout(20000);

  it("a new selection on an already-commented line opens its own draft (not a toggle) and skips focus", async () => {
    const api = await getTestApi();
    const uri = await openWithSeededComment("9", "alpha beta gamma delta\n", "first comment");
    const projected = await waitFor(() => api.persistedThreadCountForSource(uri) >= 1);
    assert.ok(projected, "expected the seeded comment to project into a thread");

    const editor = vscode.window.visibleTextEditors.find(
      (e) => e.document.uri.fsPath === uri.fsPath,
    );
    editor.selection = new vscode.Selection(0, 12, 0, 17); // "gamma", same line
    await vscode.commands.executeCommand("markback.commentSelection");

    assert.ok(
      api.hasDraftForSource(uri),
      "an already-commented line must route to our draft path so a SECOND comment can be started — the native add-comment flow would only toggle the existing thread (issue #9)",
    );
    const range = api.getDraftRangeForSource(uri);
    assert.equal(range.start.line, 0);
    assert.equal(range.start.character, 12);
    assert.equal(range.end.character, 17);
    assert.equal(
      api.wasFocusHandoffSkipped(uri),
      true,
      "focus handoff must be skipped when another comment shares the line, or focus is stolen into the first comment",
    );
  });

  it("the FIRST comment on a line uses the native flow (no tracked draft)", async () => {
    const api = await getTestApi();
    const { editor, uri } = await openPlain("9b", "solo line here\n");
    editor.selection = new vscode.Selection(0, 0, 0, 4);
    await vscode.commands.executeCommand("markback.commentSelection");

    assert.equal(
      api.hasDraftForSource(uri),
      false,
      "a fresh line must use workbench.action.addComment (which focuses the reply input), not our draft path",
    );
  });
});

describe("#8 — cancelling an edit reverts cleanly", function () {
  this.timeout(20000);

  it("an edit in progress is detected, and cancelling restores the body and leaves edit mode", async () => {
    const api = await getTestApi();
    const uri = await openWithSeededComment("8", "hello world\n", "original text");
    await waitFor(() => api.firstCommentForSource(uri) !== null);

    const comment = api.firstCommentForSource(uri);
    assert.ok(comment, "expected a persisted comment to edit");
    assert.equal(bodyText(comment.body), "original text");
    assert.equal(api.hasEditInProgress(), false);

    await vscode.commands.executeCommand("markback.editComment", comment);
    assert.equal(comment.mode, vscode.CommentMode.Editing);
    assert.equal(
      api.hasEditInProgress(),
      true,
      "the discard prompt uses this to word itself 'Discard your edits?' for an edit",
    );

    comment.body = new vscode.MarkdownString("DIRTY EDIT");
    // The discard-confirm routes an edit cancel through this clean revert (no
    // collapse), which is what keeps VS Code's native 'discard these comments?'
    // dialog from firing on top.
    await vscode.commands.executeCommand("markback.cancelEditComment", comment);

    assert.equal(bodyText(comment.body), "original text", "cancel must restore the saved body");
    assert.equal(comment.mode, vscode.CommentMode.Preview, "cancel must leave edit mode");
    assert.equal(api.hasEditInProgress(), false);
  });
});
