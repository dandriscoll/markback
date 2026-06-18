import * as vscode from "vscode";

import { SidecarRepository } from "./sidecarRepository";
import { projectRecordsToThreads } from "./projection";
import { sidecarPathFor, isSidecar, sourcePathFor } from "./sidecarPath";
import type { RangeLike } from "./rangeCodec";
import { lineCollides, type RangeShape } from "./focusCollision";
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

// A comment carries the id of the .mb record it renders, so edit/delete
// commands (which receive the Comment) can resolve which record to mutate.
// `savedBody` stashes the pre-edit text so Cancel can restore it.
interface MarkbackComment extends vscode.Comment {
  recordId: string;
  savedBody?: string | vscode.MarkdownString;
}

const COMMENT_CONTROLLER_ID = "markback";

export class CommentControlPlane {
  readonly controller: vscode.CommentController;
  private threadsBySource = new Map<string, ThreadState[]>();
  private draftBySource = new Map<string, DraftThreadState>();
  // Whether the most recent draft on a source skipped the focus handoff because
  // another comment shared its line (#9). Test-only introspection.
  private focusSkippedBySource = new Map<string, boolean>();
  private decorationType: vscode.TextEditorDecorationType;
  private disposables: vscode.Disposable[] = [];

  constructor(private repo: SidecarRepository, private logger: OutputLogger) {
    this.controller = vscode.comments.createCommentController(
      COMMENT_CONTROLLER_ID,
      "Markback",
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
        desc.comments.map((c) => makeComment(c.body, c.author, c.recordId)),
      );
      thread.canReply = true;
      thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
      applyThreadResolution(thread, desc.resolved);
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
    thread.label = "Markback: New Comment";

    const draft: DraftThreadState = {
      thread,
      sidecarPath,
      sourceUri: args.sourceUri,
      range: args.range,
    };
    this.draftBySource.set(sourceAbs, draft);

    // #9: if another thread already anchors on this line, the line-granular
    // focus command would target IT, not this new draft — so skip the handoff
    // and leave the visible draft for the user to click.
    const existing = (this.threadsBySource.get(sourceAbs) ?? []).map((s) =>
      toRangeShape(s.range),
    );
    const skipFocusHandoff = lineCollides(toRangeShape(args.range), existing);
    this.focusSkippedBySource.set(sourceAbs, skipFocusHandoff);

    this.focusDraftReply(thread, args.sourceUri, args.range, skipFocusHandoff);

    return draft;
  }

  // #9: does the line this range anchors on already host a markback thread?
  // `markback.commentSelection` uses this to route around VS Code's native
  // add-comment flow (which would only toggle the existing thread) and create a
  // second draft on the line instead.
  lineIsOccupied(sourceUri: vscode.Uri, range: vscode.Range): boolean {
    const existing = (this.threadsBySource.get(sourceUri.fsPath) ?? []).map((s) =>
      toRangeShape(s.range),
    );
    return lineCollides(toRangeShape(range), existing);
  }

  // FALLBACK PATH ONLY. The primary `markback.commentSelection` flow now drives
  // VS Code's built-in `workbench.action.addComment`, which creates the thread
  // with the reply INPUT focused. This method runs only when that built-in is
  // unavailable, and the best a third-party extension can then do is focus the
  // widget SHELL — the caret lands one Tab short of the textarea, but the thread
  // is usable. (See runCommentSelection for why the built-in is preferred.)
  //
  // Move keyboard focus toward the new thread's reply input so the user's next
  // keystroke types into the comment, not the source document. The native
  // gutter-"+" affordance does this for free; programmatic creation does not —
  // and as of VS Code 1.90 `createCommentThread` no longer auto-focuses or
  // auto-expands a new thread at all (microsoft/vscode#214661), so we have to
  // drive focus ourselves.
  //
  // The ONLY public lever is the `workbench.action.focusCommentOnCurrentLine`
  // command. (There is no `CommentThread.reveal()`, no controller/widget focus
  // method, and no readable focus context key in @types/vscode 1.100. VS Code's
  // internal `revealCommentThread(thread, comment, focusReply, …)` — which can
  // drop the caret straight into the reply box — is not exported as a command.)
  // That command does, verbatim:
  //     const c = controller.getCommentsAtLine(cursorPosition);
  //     controller.revealCommentThread(c[0].thread, undefined, false,
  //                                    CommentWidgetFocus.Widget);
  // Two consequences drive everything below:
  //
  //   (1) It targets the thread AT THE CURSOR LINE. VS Code anchors a thread's
  //       glyph and input zone at the LAST line of its range, so we park the
  //       cursor on range.end — not range.start. The old code used range.start,
  //       which for any multi-line selection sat above the widget and matched
  //       nothing. (Single-line selections share a line, so this is a no-op.)
  //
  //   (2) It runs against whatever widget exists RIGHT NOW. VS Code mounts the
  //       input zone (a Monaco editor) asynchronously after createCommentThread
  //       returns; on a COLD first invocation that mount trails a frame or more
  //       while the comments contribution lazy-initializes. Firing once (or once
  //       + a single 60ms retry) races the mount, `getCommentsAtLine` comes back
  //       empty, and the call no-ops — the "focus didn't land on first use" bug.
  //
  // We can't observe widget readiness through the public API, so we fire on an
  // escalating schedule that spans the cold-mount window instead of polling for
  // "ready". Re-firing after the input is already focused is a harmless no-op
  // (it neither clears text nor moves the caret), and we bail out early once the
  // draft is gone (saved/cancelled) so we never poke a disposed widget.
  private focusDraftReply(
    thread: vscode.CommentThread,
    sourceUri: vscode.Uri,
    range: vscode.Range,
    skipFocusHandoff = false,
  ): void {
    const editor = vscode.window.visibleTextEditors.find(
      (e) => e.document.uri.toString() === sourceUri.toString(),
    );
    if (editor) {
      const anchor = new vscode.Position(range.end.line, 0);
      editor.selection = new vscode.Selection(anchor, anchor);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }

    if (skipFocusHandoff) {
      // Another comment already anchors on this line; the line-granular focus
      // command would land on IT. Leave this new draft expanded and visible
      // for the user to click rather than stealing focus into the wrong thread.
      this.logger.info(
        "[plane] focus handoff skipped: another comment shares this line; new draft left for manual focus",
      );
      return;
    }

    // Spread across the cold-mount window: a quick first try for the warm case,
    // then escalating retries that cover a slow first-invocation render. The
    // tail stays under ~300ms so we never yank focus back after a human has had
    // time to start typing.
    const schedule = [0, 40, 90, 160, 300];
    const startedAt = Date.now();
    schedule.forEach((delay, i) => {
      setTimeout(() => {
        // Stop if the user already saved/cancelled this draft in the meantime.
        if (this.findDraftFor(thread) === null) return;
        void vscode.commands
          .executeCommand("workbench.action.focusCommentOnCurrentLine")
          .then(
            () =>
              this.logger.info(
                `[plane] focusCommentOnCurrentLine attempt ${i + 1}/${schedule.length} ` +
                  `dispatched at +${Date.now() - startedAt}ms (anchor line ${range.end.line})`,
              ),
            (err: unknown) =>
              this.logger.warn(
                `[plane] focusCommentOnCurrentLine attempt ${i + 1}/${schedule.length} ` +
                  `failed at +${Date.now() - startedAt}ms: ${(err as Error).message}`,
              ),
          );
      }, delay);
    });
  }

  findDraftFor(thread: vscode.CommentThread): DraftThreadState | null {
    for (const draft of this.draftBySource.values()) {
      if (draft.thread === thread) return draft;
    }
    return null;
  }

  // Test-only introspection. Lets the integration harness assert that
  // `markback.commentSelection` did or did not create a draft, and on what
  // range, without exporting the entire plane's internals.
  hasDraftForSource(sourceUri: vscode.Uri): boolean {
    return this.draftBySource.has(sourceUri.fsPath);
  }

  getDraftRangeForSource(sourceUri: vscode.Uri): vscode.Range | null {
    return this.draftBySource.get(sourceUri.fsPath)?.range ?? null;
  }

  // Test-only: the draft's CommentThread, so the integration harness can
  // synthesize the CommentReply that `markback.saveComment` consumes and drive a
  // real save end-to-end (used by the #10 inline-excerpt spec).
  draftThreadForSource(sourceUri: vscode.Uri): vscode.CommentThread | null {
    return this.draftBySource.get(sourceUri.fsPath)?.thread ?? null;
  }

  // Test-only: the first persisted thread for a source, so the integration
  // harness can drive resolve/reopen (#11) against a real thread object.
  firstPersistedThreadForSource(sourceUri: vscode.Uri): vscode.CommentThread | null {
    return this.threadsBySource.get(sourceUri.fsPath)?.[0]?.thread ?? null;
  }

  // Test-only: did the most recent draft on this source skip the focus handoff
  // because another comment already anchored on its line (#9)?
  wasFocusHandoffSkipped(sourceUri: vscode.Uri): boolean | null {
    return this.focusSkippedBySource.get(sourceUri.fsPath) ?? null;
  }

  // Test-only: number of persisted threads for a source (lets the harness wait
  // for an opened document's sidecar to project before asserting).
  persistedThreadCountForSource(sourceUri: vscode.Uri): number {
    return this.threadsBySource.get(sourceUri.fsPath)?.length ?? 0;
  }

  // Test-only: the first persisted comment for a source, so the edit/cancel
  // flow (#8) can be driven against a real comment object.
  firstCommentForSource(sourceUri: vscode.Uri): vscode.Comment | null {
    const states = this.threadsBySource.get(sourceUri.fsPath) ?? [];
    return states[0]?.thread.comments[0] ?? null;
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
    thread.comments = [makeComment(args.body, args.author, args.parentRecordId)];
    applyThreadResolution(thread, false); // freshly created ⇒ unresolved
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
    const newComment = makeComment(args.body, args.author, args.replyRecordId);
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

    args.thread.comments = [makeComment(args.body, args.author, args.parentRecordId)];
    args.thread.canReply = true;
    applyThreadResolution(args.thread, false); // freshly created ⇒ unresolved
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

  // ---- editing & deleting existing comments ----

  beginEditComment(comment: vscode.Comment): void {
    const mb = comment as MarkbackComment;
    mb.savedBody = comment.body;
    comment.mode = vscode.CommentMode.Editing;
    this.reassignContainingThread(comment);
  }

  cancelEditComment(comment: vscode.Comment): void {
    const mb = comment as MarkbackComment;
    if (mb.savedBody !== undefined) {
      comment.body = mb.savedBody;
      mb.savedBody = undefined;
    }
    comment.mode = vscode.CommentMode.Preview;
    this.reassignContainingThread(comment);
  }

  // #8: is any markback comment currently being edited (vs. composing a brand
  // new comment in a draft reply box)? The Escape confirm uses this to word
  // itself correctly — "discard your edits" for an edit, "discard this comment"
  // for a new draft — and to route an edit cancel through the clean revert.
  hasEditInProgress(): boolean {
    for (const states of this.threadsBySource.values()) {
      for (const state of states) {
        for (const comment of state.thread.comments) {
          if (comment.mode === vscode.CommentMode.Editing) return true;
        }
      }
    }
    return false;
  }

  // #8: cancel every markback comment in edit mode by reverting it cleanly
  // (restore saved body, return to Preview). Done in-place, with no collapse, so
  // VS Code's native "discard these comments?" dialog never fires. Returns the
  // number of edits cancelled.
  cancelEditingComments(): number {
    const editing: vscode.Comment[] = [];
    for (const states of this.threadsBySource.values()) {
      for (const state of states) {
        for (const comment of state.thread.comments) {
          if (comment.mode === vscode.CommentMode.Editing) editing.push(comment);
        }
      }
    }
    for (const comment of editing) this.cancelEditComment(comment);
    if (editing.length > 0) {
      this.logger.info(`[plane] cancelled ${editing.length} in-progress edit(s)`);
    }
    return editing.length;
  }

  async saveEditComment(comment: vscode.Comment): Promise<void> {
    const mb = comment as MarkbackComment;
    const owner = this.findStateForComment(comment);
    if (!owner) {
      this.logger.warn("[plane] saveEditComment: no owning thread for comment");
      return;
    }
    const text = bodyText(comment.body).trim();
    if (!text) {
      // Blanking a record isn't allowed — treat an empty save as cancel.
      this.cancelEditComment(comment);
      vscode.window.showInformationMessage("Markback: a comment cannot be empty.");
      return;
    }
    await this.repo.updateRecord({
      sidecarPath: owner.sidecarPath,
      recordId: mb.recordId,
      feedback: text,
    });
    comment.body = new vscode.MarkdownString(text);
    mb.savedBody = undefined;
    comment.mode = vscode.CommentMode.Preview;
    this.reassignContainingThread(comment);
  }

  async deleteComment(comment: vscode.Comment): Promise<void> {
    const mb = comment as MarkbackComment;
    const owner = this.findStateForComment(comment);
    if (!owner) {
      this.logger.warn("[plane] deleteComment: no owning thread for comment");
      return;
    }
    await this.repo.deleteRecord({ sidecarPath: owner.sidecarPath, recordId: mb.recordId });
    // Rebuild this source's threads from the updated sidecar so the deleted
    // comment (and any orphaned replies) disappear and an emptied thread goes.
    try {
      const doc = await vscode.workspace.openTextDocument(owner.sourceUri);
      await this.refreshDocument(doc);
    } catch (err: unknown) {
      this.logger.error(`[plane] deleteComment refresh: ${(err as Error).message}`);
    }
  }

  private findStateForComment(comment: vscode.Comment): ThreadState | null {
    for (const states of this.threadsBySource.values()) {
      for (const state of states) {
        if (state.thread.comments.includes(comment)) return state;
      }
    }
    return null;
  }

  private reassignContainingThread(comment: vscode.Comment): void {
    const state = this.findStateForComment(comment);
    if (state) state.thread.comments = [...state.thread.comments];
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

// Encode resolution into the thread's native state (gutter/badge styling) AND its
// contextValue, so the title-menu Resolve/Reopen affordances flip (see package.json
// `comments/commentThread/title` when-clauses on markback.persisted.(un)resolved).
export const CTX_UNRESOLVED = "markback.persisted.unresolved";
export const CTX_RESOLVED = "markback.persisted.resolved";

function applyThreadResolution(thread: vscode.CommentThread, resolved: boolean): void {
  thread.contextValue = resolved ? CTX_RESOLVED : CTX_UNRESOLVED;
  thread.state = resolved
    ? vscode.CommentThreadState.Resolved
    : vscode.CommentThreadState.Unresolved;
}

function toVsRange(r: RangeLike): vscode.Range {
  return new vscode.Range(
    r.start.line,
    r.start.character,
    r.end.line,
    r.end.character,
  );
}

function toRangeShape(r: vscode.Range): RangeShape {
  return {
    start: { line: r.start.line, character: r.start.character },
    end: { line: r.end.line, character: r.end.character },
  };
}

function makeComment(
  body: string,
  author: string | null,
  recordId: string,
): MarkbackComment {
  return {
    body: new vscode.MarkdownString(body),
    mode: vscode.CommentMode.Preview,
    author: { name: author ?? "unknown" },
    recordId,
  };
}

function bodyText(body: string | vscode.MarkdownString): string {
  return typeof body === "string" ? body : body.value;
}
