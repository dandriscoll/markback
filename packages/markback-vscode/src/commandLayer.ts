import * as vscode from "vscode";

import { AuthorResolver } from "./author";
import { CommentControlPlane } from "./commentControlPlane";
import { OutputLogger } from "./output";
import { isSidecar, sidecarPathFor } from "./sidecarPath";
import { SidecarRepository } from "./sidecarRepository";

type Deps = {
  plane: CommentControlPlane;
  repo: SidecarRepository;
  author: AuthorResolver;
  logger: OutputLogger;
};

export function registerCommands(
  context: vscode.ExtensionContext,
  deps: Deps,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("markback.commentSelection", () =>
      runCommentSelection(deps),
    ),
    vscode.commands.registerCommand(
      "markback.saveComment",
      (reply: vscode.CommentReply) => runSaveComment(reply, deps),
    ),
    vscode.commands.registerCommand(
      "markback.cancelDraft",
      (replyOrThread: vscode.CommentReply | vscode.CommentThread) =>
        runCancelDraft(replyOrThread, deps),
    ),
    vscode.commands.registerCommand("markback.showOutput", () =>
      deps.logger.reveal(),
    ),
    vscode.commands.registerCommand(
      "markback.openSidecar",
      (thread?: vscode.CommentThread) => runOpenSidecar(thread, deps),
    ),
    vscode.commands.registerCommand(
      "markback.previewComment",
      (args: PreviewCommentArgs) => runPreviewComment(args, deps),
    ),
    vscode.commands.registerCommand(
      "markback.previewOpenSidecar",
      (args: PreviewOpenSidecarArgs) => runPreviewOpenSidecar(args, deps),
    ),
  );
}

type PreviewOpenSidecarArgs = {
  sourceUri: string;
  recordId?: string;
};

async function runPreviewOpenSidecar(
  args: PreviewOpenSidecarArgs | undefined,
  deps: Deps,
): Promise<void> {
  if (!args || typeof args.sourceUri !== "string") {
    deps.logger.error("[command] previewOpenSidecar: missing args");
    return;
  }
  deps.logger.info(`[command] previewOpenSidecar invoked recordId=${args.recordId ?? "(none)"}`);
  const uri = parseSourceUri(args.sourceUri);
  if (!uri) {
    vscode.window.showErrorMessage("MarkBack: invalid source URI from preview.");
    return;
  }
  if (uri.scheme !== "file") {
    vscode.window.showInformationMessage(
      "MarkBack: this preview's source file does not support sidecar comments.",
    );
    return;
  }
  const sidecarPath = sidecarPathFor(uri.fsPath);
  try {
    const doc = await vscode.workspace.openTextDocument(sidecarPath);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    if (args.recordId) {
      jumpToRecord(editor, doc, args.recordId, deps);
    }
  } catch (err: unknown) {
    const msg = (err as Error).message;
    deps.logger.error(`previewOpenSidecar: ${msg}`);
    vscode.window.showErrorMessage(
      `MarkBack: cannot open ${sidecarPath} — ${msg}`,
    );
  }
}

function parseSourceUri(raw: string): vscode.Uri | null {
  try {
    const parsed = vscode.Uri.parse(raw);
    if (parsed.scheme === "file" && parsed.fsPath) return parsed;
  } catch {
    // fall through
  }
  if (/[/\\]/.test(raw)) {
    try {
      return vscode.Uri.file(raw);
    } catch {
      // give up
    }
  }
  return null;
}

type PreviewCommentArgs = {
  sourceUri: string;
  startLine: number;
  endLine: number;
  selectionText?: string;
};

async function runPreviewComment(
  args: PreviewCommentArgs | undefined,
  deps: Deps,
): Promise<void> {
  if (!args || typeof args.sourceUri !== "string") {
    deps.logger.error("[command] previewComment: missing args");
    return;
  }
  deps.logger.info(
    `[command] previewComment invoked sourceUri=${args.sourceUri} lines=${args.startLine}-${args.endLine}`,
  );
  const uri = parseSourceUri(args.sourceUri);
  if (!uri) {
    deps.logger.error(`[command] previewComment: bad sourceUri ${args.sourceUri}`);
    vscode.window.showErrorMessage("MarkBack: invalid source URI from preview.");
    return;
  }
  if (uri.scheme !== "file") {
    vscode.window.showInformationMessage(
      "MarkBack: this preview's source file does not support sidecar comments.",
    );
    return;
  }
  const placeHolder = args.selectionText
    ? `On: "${args.selectionText}"`
    : "Add a comment...";
  const feedback = await vscode.window.showInputBox({
    prompt: "Add a comment",
    placeHolder,
    ignoreFocusOut: true,
  });
  if (!feedback || feedback.trim().length === 0) return;
  const author = await deps.author.resolve();

  const startLine = Math.max(0, args.startLine | 0);
  const endLine = Math.max(startLine, args.endLine | 0);
  const range: { start: { line: number; character: number }; end: { line: number; character: number } } = {
    start: { line: startLine, character: 0 },
    end: { line: endLine + 1, character: 0 },
  };

  try {
    await deps.repo.addRecord({
      sidecarPath: sidecarPathFor(uri.fsPath),
      sourceAbsPath: uri.fsPath,
      range,
      feedback: feedback.trim(),
      by: author,
    });
    deps.logger.info(
      `[command] previewComment: persisted at ${uri.fsPath}:${startLine + 1}-${endLine + 1}`,
    );
  } catch (err: unknown) {
    const msg = (err as Error).message;
    deps.logger.error(`previewComment: ${msg}`);
    vscode.window.showErrorMessage(
      `MarkBack: failed to save preview comment — ${msg}`,
    );
  }
}

async function runOpenSidecar(
  thread: vscode.CommentThread | undefined,
  deps: Deps,
): Promise<void> {
  deps.logger.info("[command] openSidecar invoked");
  const sourceUri = thread?.uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!sourceUri) {
    vscode.window.showInformationMessage(
      "MarkBack: no source file — open a file or invoke from a comment thread.",
    );
    return;
  }
  if (sourceUri.scheme !== "file") {
    vscode.window.showInformationMessage(
      "MarkBack: this file type does not support sidecar comments.",
    );
    return;
  }
  if (isSidecar(sourceUri.fsPath)) {
    vscode.window.showInformationMessage(
      "MarkBack: this is already the sidecar file.",
    );
    return;
  }
  const sidecarPath = sidecarPathFor(sourceUri.fsPath);

  const recordId = thread ? deps.plane.findStateFor(thread)?.parentRecordId ?? null : null;

  try {
    const doc = await vscode.workspace.openTextDocument(sidecarPath);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    if (recordId) {
      jumpToRecord(editor, doc, recordId, deps);
    }
  } catch (err: unknown) {
    const msg = (err as Error).message;
    deps.logger.error(`openSidecar: ${msg}`);
    vscode.window.showErrorMessage(
      `MarkBack: cannot open ${sidecarPath} — ${msg}`,
    );
  }
}

function jumpToRecord(
  editor: vscode.TextEditor,
  doc: vscode.TextDocument,
  recordId: string,
  deps: Deps,
): void {
  const needle = `@id ${recordId}`;
  const offset = doc.getText().indexOf(needle);
  if (offset < 0) {
    deps.logger.warn(`[command] openSidecar: could not locate record ${recordId} in sidecar`);
    return;
  }
  const position = doc.positionAt(offset);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(
    new vscode.Range(position, position),
    vscode.TextEditorRevealType.InCenter,
  );
  deps.logger.info(`[command] openSidecar: jumped to record ${recordId}`);
}

async function runCommentSelection(deps: Deps): Promise<void> {
  deps.logger.info("[command] commentSelection invoked");
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage("MarkBack: open a file and select text first.");
    return;
  }
  const selection = editor.selection;
  if (selection.isEmpty) {
    vscode.window.showInformationMessage("MarkBack: select some text first.");
    return;
  }
  const range = new vscode.Range(selection.start, selection.end);
  deps.plane.createDraftThread({ sourceUri: editor.document.uri, range });
}

async function runSaveComment(reply: vscode.CommentReply, deps: Deps): Promise<void> {
  deps.logger.info("[command] saveComment invoked");
  const text = reply.text.trim();
  if (text.length === 0) {
    vscode.window.showWarningMessage("MarkBack: empty feedback — nothing to save.");
    return;
  }
  const author = await deps.author.resolve();
  const draft = deps.plane.findDraftFor(reply.thread);
  if (draft) {
    try {
      const { record } = await deps.repo.addRecord({
        sidecarPath: draft.sidecarPath,
        sourceAbsPath: draft.sourceUri.fsPath,
        range: vsRangeToRangeLike(draft.range),
        feedback: text,
        by: author,
      });
      if (!record.id) {
        throw new Error("internal: addRecord returned a record without an id");
      }
      deps.plane.promoteDraftToPersisted({
        draft,
        parentRecordId: record.id,
        body: text,
        author,
      });
    } catch (err: unknown) {
      const msg = (err as Error).message;
      deps.logger.error(`saveComment(new): ${msg}`);
      vscode.window.showErrorMessage(`MarkBack: failed to save comment — ${msg}`);
    }
    return;
  }

  const state = deps.plane.findStateFor(reply.thread);
  if (state) {
    try {
      const { record } = await deps.repo.addReply({
        sidecarPath: state.sidecarPath,
        parentId: state.parentRecordId,
        feedback: text,
        by: author,
      });
      if (!record.id) {
        throw new Error("internal: addReply returned a record without an id");
      }
      deps.plane.appendReplyToState({
        state,
        replyRecordId: record.id,
        body: text,
        author,
      });
    } catch (err: unknown) {
      const msg = (err as Error).message;
      deps.logger.error(`saveComment(reply): ${msg}`);
      vscode.window.showErrorMessage(`MarkBack: failed to save reply — ${msg}`);
    }
    return;
  }

  await runGutterAdd(reply, text, author, deps);
}

async function runGutterAdd(
  reply: vscode.CommentReply,
  text: string,
  author: string | null,
  deps: Deps,
): Promise<void> {
  deps.logger.info("[command] saveComment (gutter add)");
  const thread = reply.thread;
  if (!thread.range) {
    deps.logger.error("[command] gutter add: thread has no range");
    vscode.window.showErrorMessage("MarkBack: cannot determine line for this comment.");
    return;
  }
  const sourceUri = thread.uri;
  if (sourceUri.scheme !== "file") {
    deps.logger.error(`[command] gutter add: unsupported uri scheme ${sourceUri.scheme}`);
    vscode.window.showErrorMessage("MarkBack: this file type does not support sidecar comments.");
    return;
  }
  try {
    const sidecarPath = sidecarPathFor(sourceUri.fsPath);
    const { record } = await deps.repo.addRecord({
      sidecarPath,
      sourceAbsPath: sourceUri.fsPath,
      range: vsRangeToRangeLike(thread.range),
      feedback: text,
      by: author,
    });
    if (!record.id) {
      throw new Error("internal: addRecord returned a record without an id");
    }
    deps.plane.adoptThread({
      thread,
      sourceUri,
      range: thread.range,
      parentRecordId: record.id,
      body: text,
      author,
    });
  } catch (err: unknown) {
    const msg = (err as Error).message;
    deps.logger.error(`saveComment(gutter): ${msg}`);
    vscode.window.showErrorMessage(`MarkBack: failed to save comment — ${msg}`);
  }
}

function runCancelDraft(
  replyOrThread: vscode.CommentReply | vscode.CommentThread,
  deps: Deps,
): void {
  deps.logger.info("[command] cancelDraft invoked");
  const thread = isCommentReply(replyOrThread) ? replyOrThread.thread : replyOrThread;
  if (deps.plane.discardDraftByThread(thread)) return;
  if (deps.plane.disposeUntrackedEmptyThread(thread)) return;
  deps.logger.warn("[command] cancelDraft fired on a tracked persisted thread; ignored");
}

function isCommentReply(
  x: vscode.CommentReply | vscode.CommentThread,
): x is vscode.CommentReply {
  return (x as vscode.CommentReply).text !== undefined;
}

function vsRangeToRangeLike(range: vscode.Range): { start: { line: number; character: number }; end: { line: number; character: number } } {
  return {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character },
  };
}
