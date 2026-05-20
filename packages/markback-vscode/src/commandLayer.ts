import * as vscode from "vscode";

import { AuthorResolver } from "./author";
import { CommentControlPlane } from "./commentControlPlane";
import { OutputLogger } from "./output";
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
  );
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
  if (!state) {
    deps.logger.error("saveComment fired on a thread the plane does not track");
    vscode.window.showErrorMessage("MarkBack: internal — thread not tracked.");
    return;
  }

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
}

function runCancelDraft(
  replyOrThread: vscode.CommentReply | vscode.CommentThread,
  deps: Deps,
): void {
  deps.logger.info("[command] cancelDraft invoked");
  const thread = isCommentReply(replyOrThread) ? replyOrThread.thread : replyOrThread;
  const discarded = deps.plane.discardDraftByThread(thread);
  if (!discarded) {
    deps.logger.warn("[command] cancelDraft fired on a non-draft thread");
  }
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
