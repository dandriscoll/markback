const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const vscode = require("vscode");

// Issue #11: Resolve/Reopen append a timestamped action to the record and restyle
// the thread. Drives the real commands against a real thread and asserts the bytes
// on disk. Runtime: Electron; CI/operator-run (sandbox can't launch the test host).

const EXT_ID = "dandriscoll.markback-vscode";
let tempDir;

async function getTestApi() {
  const ext = vscode.extensions.getExtension(EXT_ID);
  assert.ok(ext, `extension ${EXT_ID} not found`);
  const exports = ext.isActive ? ext.exports : await ext.activate();
  assert.ok(exports && exports._testApi, "extension did not return _testApi");
  return exports._testApi;
}

async function waitFor(predicate, timeoutMs = 5000, stepMs = 50) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return false;
}

before(async function () {
  this.timeout(30000);
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "markback-x11-"));
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

describe("#11 — resolve / reopen append actions and restyle the thread", function () {
  this.timeout(20000);

  it("resolve appends a resolved action; reopen appends a reopened action", async () => {
    const api = await getTestApi();
    const src = path.join(tempDir, `r-${Date.now()}.txt`);
    await fs.writeFile(src, "the quick brown fox\n", "utf8");
    await fs.writeFile(
      `${src}.mb`,
      "%markback 2\n\n@id seed1\n@action created 2026-06-17T10:00:00Z dan\n" +
        "@file ./" + path.basename(src) + ":1:1-1:4 <<< note\n",
      "utf8",
    );
    const uri = vscode.Uri.file(src);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
    await waitFor(() => api.persistedThreadCountForSource(uri) >= 1);

    let thread = api.firstPersistedThreadForSource(uri);
    assert.ok(thread, "expected a persisted thread");
    assert.equal(thread.state, vscode.CommentThreadState.Unresolved);

    await vscode.commands.executeCommand("markback.resolveComment", thread);
    assert.ok(
      await waitFor(async () => /@action resolved /.test(await fs.readFile(`${src}.mb`, "utf8"))),
      "resolve must append a resolved action",
    );
    await waitFor(() => {
      const t = api.firstPersistedThreadForSource(uri);
      return t && t.state === vscode.CommentThreadState.Resolved;
    });

    thread = api.firstPersistedThreadForSource(uri);
    await vscode.commands.executeCommand("markback.reopenComment", thread);
    assert.ok(
      await waitFor(async () => /@action reopened /.test(await fs.readFile(`${src}.mb`, "utf8"))),
      "reopen must append a reopened action",
    );
    assert.ok(
      await waitFor(() => {
        const t = api.firstPersistedThreadForSource(uri);
        return t && t.state === vscode.CommentThreadState.Unresolved;
      }),
      "reopen must flip the thread back to Unresolved",
    );
  });
});
