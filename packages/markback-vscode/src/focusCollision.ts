// Pure geometry for the "second comment on the same line" routing decision.
// No `vscode` import so this is unit-testable under `node --test`.
//
// Background: `markback.commentSelection` prefers VS Code's built-in
// `workbench.action.addComment` because it focuses the reply INPUT. But that
// built-in calls `addOrToggleCommentAtLine`, which — when the line ALREADY has
// a comment thread — merely toggles that thread and returns WITHOUT creating a
// new comment. So on an already-commented line it cannot start a second
// comment ("puts me back in the first comment"). We detect that case and route
// to our own draft-thread path instead, which can host multiple threads per
// line. On that path the line-granular focus command would also target the
// existing thread, so we skip the focus handoff there too.

export type LinePoint = { line: number; character: number };
export type RangeShape = { start: LinePoint; end: LinePoint };

// The line VS Code anchors a thread's glyph and input zone on: the LAST line of
// the range. A range that ends at column 0 of a later line selects no content
// on that line, so the anchor is the previous line. This matches both
// `getCommentsAtLine`'s use of the selection's end line and our own cursor
// parking at `range.end` in focusDraftReply.
export function glyphLine(range: RangeShape): number {
  if (range.end.character === 0 && range.end.line > range.start.line) {
    return range.end.line - 1;
  }
  return range.end.line;
}

// True when a new comment's anchor line already hosts another thread's glyph —
// i.e. the native add-comment flow would toggle that thread instead of creating
// a new one, and the line-granular focus command would target it.
export function lineCollides(
  newRange: RangeShape,
  existingRanges: RangeShape[],
): boolean {
  const anchor = glyphLine(newRange);
  return existingRanges.some((r) => glyphLine(r) === anchor);
}
