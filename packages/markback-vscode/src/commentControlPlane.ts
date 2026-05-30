import * as vscode from "vscode";

import { SidecarRepository } from "./sidecarRepository";
import { projectRecordsToThreads } from "./projection";
import { sidecarPathFor, isSidecar, sourcePathFor } from "./sidecarPath";
import type { RangeLike } from "./rangeCodec";
import { OutputLogger } from "./output";

type ThreadState = {
  thread: vscode.CommentThread;
  sidecarPath: string;
  sourceUri: vscode.Uri;
  parentRecordId: string;
  recordIds: string[];
  range: vscode.Range;
};

type DraftThreadState = {
  thread: vscode.CommentThread;
  sidecarPath: string;
  sourceUri: vscode.Uri;
  range: vscode.Range;
};

const COMMENT_CONTROLLER_ID = "markback";

export class CommentControlPlane {
  readonly controller: vscode.CommentController;
  private threadsBySource = new Map<string, ThreadState[]>();
  private draftBySource = new Map<string, DraftThreadState>();
  private decorationType: vscode.TextEditorDecorationType;
  private disposables: vscode.Disposable[] = [];

  constructor(private repo: SidecarRepository, private logger: OutputLogger) {
    this.controller = vscode.comments.createCommentController(
      COMMENT_CONTROLLER_ID,
      "MarkBack",
    );
    this.controller.options = {
      prompt: "Add a comment",
      placeHolder: "Add a comment...",
    };

    this.controller.commentingRangeProvider = {
      provideCommentingRanges(document, _token) {
        if (document.uri.scheme !== "file") return [];
        if (isSidecar(document.uri.fsPath)) return [];
        if (document.lineCount === 0) return [];
        return [new vscode.Range(0, 0, document.lineCount - 1, 0)];
      },
    };

    this.decorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor("editor.findMatchHighlightBackground"),
      border: "1px solid",
      borderColor: new vscode.ThemeColor("editorWarning.border"),
      borderRadius: "2px",
    });

    this.disposables.push(this.controller, this.decorationType);
  }

  dispose(): void {
    for (const d of this.disposables) {
      try {
        d.dispose();
      } catch {
        // ignore
      }
    }
  }

  registerSubscriptions(context: vscode.ExtensionContext): void {
    context.subscriptions.push(this);

    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((doc) => {
        this.refreshDocument(doc).catch((err) =>
          this.logger.error(`onDidOpenTextDocument: ${(err as Error).message}`),
        );
      }),
      vscode.window.onDidChangeVisibleTextEditors((editors) => {
        for (const editor of editors) {
          this.repaintDecorations(editor);
        }
      }),
    );

    const watcher = vscode.workspace.createFileSystemWatcher("**/*.mb");
    this.disposables.push(
      watcher,
      watcher.onDidChange((uri) => this.onSidecarChanged(uri)),
      watcher.onDidCreate((uri) => this.onSidecarChanged(uri)),
      watcher.onDidDelete((uri) => this.onSidecarDeleted(uri)),
    );

    for (const doc of vscode.workspace.textDocuments) {
      this.refreshDocument(doc).catch((err) =>
        this.logger.error(`initial refresh: ${(err as Error).message}`),
      );
    }
  }

  async refreshDocument(doc: vscode.TextDocument): Promise<void> {
    if (doc.uri.scheme !== "file") return;
    const sourceAbs = doc.uri.fsPath;
    if (isSidecar(sourceAbs)) return;

    const sidecarPath = sidecarPathFor(sourceAbs);
    this.disposeThreadsForSource(sourceAbs);

    let loaded;
    try {
      loaded = await this.repo.load(sidecarPath);
    } catch (err: unknown) {
      this.logger.error(`load ${sidecarPath}: ${(err as Error).message}`);
      return;
    }
    if (loaded.hasErrors) return;
    if (loaded.records.length === 0) {
      this.repaintAllForSource(sourceAbs);
      return;
    }

    const projection = projectRecordsToThreads({
      records: loaded.records,
      sourceAbsPath: sourceAbs,
      sidecarAbsPath: sidecarPath,
      sourceLineCount: doc.lineCount,
    });

    for (const warning of projection.warnings) {
      if (warning.kind === "missingParent") {
        this.logger.warn(
          `reply ${warning.replyId} points to unknown parent ${warning.replyTo}; skipping`,
        );
      } else {
        this.logger.warn(
          `record ${warning.recordId} anchors at line ${warning.recordLine} ` +
            `but source has ${warning.sourceLineCount} lines (stale?)`,
        );
      }
    }

    const states: ThreadState[] = [];
    for (const desc of projection.threads) {
      const range = toVsRange(desc.range);
      const thread = this.controller.createCommentThread(
        doc.uri,
        range,
        desc.comments.map((c) => makeComment(c.body, c.author)),
      );
      thread.canReply = true;
      thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
      thread.contextValue = "markback.persisted";
      states.push({
        thread,
        sidecarPath,
        sourceUri: doc.uri,
        parentRecordId: desc.parentRecordId,
        recordIds: desc.comments.map((c) => c.recordId),
        range,
      });
    }
    this.threadsBySource.set(sourceAbs, states);
    this.repaintAllForSource(sourceAbs);
  }

  createDraftThread(args: {
    sourceUri: vscode.Uri;
    range: vscode.Range;
  }): DraftThreadState {
    const sourceAbs = args.sourceUri.fsPath;
    const sidecarPath = sidecarPathFor(sourceAbs);
    this.discardDraftForSource(sourceAbs);

    const thread = this.controller.createCommentThread(args.sourceUri, args.range, []);
    thread.canReply = true;
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    thread.contextValue = "markback.draft";
    thread.label = "MarkBack: New Comment";

    const draft: DraftThreadState = {
      thread,
      sidecarPath,
      sourceUri: args.sourceUri,
      range: args.range,
    };
    this.draftBySource.set(sourceAbs, draft);

    // Move keyboard focus to the new thread's reply input so the user's next
    // keystroke types into the comment, not into the source document. VS Code's
    // native gutter-"+" affordance does this for free; programmatic creation
    // does not. The command id is internal-but-stable across current VS Code
    // releases; on rejection we log and leave focus where it was.
    void vscode.commands
      .executeCommand("workbench.action.focusCommentReplyInput")
      .then(undefined, (err: unknown) => {
        this.logger.warn(
          `[plane] focusCommentReplyInput failed: ${(err as Error).message}`,
        );
      });

    return draft;
  }

  findDraftFor(thread: vscode.CommentThread): DraftThreadState | null {
    for (const draft of this.draftBySource.values()) {
      if (draft.thread === thread) return draft;
    }
    return null;
  }

  findStateFor(thread: vscode.CommentThread): ThreadState | null {
    for (const states of this.threadsBySource.values()) {
      const hit = states.find((s) => s.thread === thread);
      if (hit) return hit;
    }
    return null;
  }

  promoteDraftToPersisted(args: {
    draft: DraftThreadState;
    parentRecordId: string;
    body: string;
    author: string | null;
  }): ThreadState {
    const sourceAbs = args.draft.sourceUri.fsPath;
    const thread = args.draft.thread;
    thread.comments = [makeComment(args.body, args.author)];
    thread.contextValue = "markback.persisted";
    thread.label = undefined;
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;

    this.draftBySource.delete(sourceAbs);

    const state: ThreadState = {
      thread,
      sidecarPath: args.draft.sidecarPath,
      sourceUri: args.draft.sourceUri,
      parentRecordId: args.parentRecordId,
      recordIds: [args.parentRecordId],
      range: args.draft.range,
    };
    const list = this.threadsBySource.get(sourceAbs) ?? [];
    list.push(state);
    this.threadsBySource.set(sourceAbs, list);
    this.repaintAllForSource(sourceAbs);
    return state;
  }

  appendReplyToState(args: {
    state: ThreadState;
    replyRecordId: string;
    body: string;
    author: string | null;
  }): void {
    const newComment = makeComment(args.body, args.author);
    args.state.thread.comments = [...args.state.thread.comments, newComment];
    args.state.recordIds.push(args.replyRecordId);
  }

  adoptThread(args: {
    thread: vscode.CommentThread;
    sourceUri: vscode.Uri;
    range: vscode.Range;
    parentRecordId: string;
    body: string;
    author: string | null;
  }): ThreadState {
    const sourceAbs = args.sourceUri.fsPath;
    const sidecarPath = sidecarPathFor(sourceAbs);

    args.thread.comments = [makeComment(args.body, args.author)];
    args.thread.canReply = true;
    args.thread.contextValue = "markback.persisted";
    args.thread.label = undefined;
    args.thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;

    const state: ThreadState = {
      thread: args.thread,
      sidecarPath,
      sourceUri: args.sourceUri,
      parentRecordId: args.parentRecordId,
      recordIds: [args.parentRecordId],
      range: args.range,
    };
    const list = this.threadsBySource.get(sourceAbs) ?? [];
    list.push(state);
    this.threadsBySource.set(sourceAbs, list);
    this.repaintAllForSource(sourceAbs);
    return state;
  }

  disposeUntrackedEmptyThread(thread: vscode.CommentThread): boolean {
    if (this.findDraftFor(thread)) return false;
    if (this.findStateFor(thread)) return false;
    try {
      thread.dispose();
    } catch {
      // ignore
    }
    return true;
  }

  discardDraftForSource(sourceAbs: string): void {
    const draft = this.draftBySource.get(sourceAbs);
    if (!draft) return;
    try {
      draft.thread.dispose();
    } catch {
      // ignore
    }
    this.draftBySource.delete(sourceAbs);
  }

  discardDraftByThread(thread: vscode.CommentThread): boolean {
    for (const [src, draft] of this.draftBySource) {
      if (draft.thread === thread) {
        try {
          draft.thread.dispose();
        } catch {
          // ignore
        }
        this.draftBySource.delete(src);
        return true;
      }
    }
    return false;
  }

  private disposeThreadsForSource(sourceAbs: string): void {
    const list = this.threadsBySource.get(sourceAbs) ?? [];
    for (const s of list) {
      try {
        s.thread.dispose();
      } catch {
        // ignore
      }
    }
    this.threadsBySource.delete(sourceAbs);
  }

  private async onSidecarChanged(uri: vscode.Uri): Promise<void> {
    const sidecarPath = uri.fsPath;
    this.repo.invalidate(sidecarPath);
    const sourcePath = sourcePathFor(sidecarPath);
    if (!sourcePath) return;
    this.logger.info(`sidecar changed: ${sidecarPath}`);
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.scheme === "file" && doc.uri.fsPath === sourcePath) {
        await this.refreshDocument(doc);
      }
    }
    // Also refresh any open markdown previews so embedded badges
    // pick up new/changed/removed records without a manual refresh.
    if (sourcePath.toLowerCase().endsWith(".md")) {
      try {
        await vscode.commands.executeCommand("markdown.preview.refresh");
      } catch (err: unknown) {
        this.logger.warn(`[plane] markdown.preview.refresh failed: ${(err as Error).message}`);
      }
    }
  }

  private onSidecarDeleted(uri: vscode.Uri): void {
    const sidecarPath = uri.fsPath;
    this.repo.invalidate(sidecarPath);
    const sourcePath = sourcePathFor(sidecarPath);
    if (!sourcePath) return;
    this.disposeThreadsForSource(sourcePath);
    this.repaintAllForSource(sourcePath);
  }

  private repaintAllForSource(sourceAbs: string): void {
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.fsPath === sourceAbs) {
        this.repaintDecorations(editor);
      }
    }
  }

  private repaintDecorations(editor: vscode.TextEditor): void {
    const sourceAbs = editor.document.uri.fsPath;
    const states = this.threadsBySource.get(sourceAbs) ?? [];
    editor.setDecorations(
      this.decorationType,
      states.map((s) => s.range),
    );
  }
}

function toVsRange(r: RangeLike): vscode.Range {
  return new vscode.Range(
    r.start.line,
    r.start.character,
    r.end.line,
    r.end.character,
  );
}

function makeComment(body: string, author: string | null): vscode.Comment {
  return {
    body: new vscode.MarkdownString(body),
    mode: vscode.CommentMode.Preview,
    author: { name: author ?? "unknown" },
  };
}
