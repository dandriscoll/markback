# Changelog

All notable changes to the Markback VS Code extension are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## 0.3.6

- **Alt+Backspace deletes the previous word** in the preview reply box (issue
  #12). The inline reply `<textarea>` in the Markdown preview is a custom webview
  input that did not inherit the OS word-delete keybinding, so Alt+Backspace did
  nothing on Linux/Windows. It now deletes the whitespace and word to the left of
  the caret (or the active selection, if any), and the deletion is undoable with
  Ctrl+Z. Ctrl+Backspace / Cmd+Backspace are left to native handling. The reply
  hint now advertises the shortcut.

## 0.3.5

- **Comment lifecycle actions** (issue #11). Every new comment now records a
  `created` action with a timestamp and author. Comment threads gain **Resolve**
  and **Reopen** actions in the thread toolbar: resolving a comment records a
  `resolved` action and marks the thread resolved; reopening records a `reopened`
  action. Resolution state is derived from the action log and restored when a file
  is reopened. Actions are stored in the `.mb` as `@action <verb> <timestamp>
  [author]` lines (Markback spec v0.3.0).

## 0.3.4

- **Generated `.mb` records now embed the quoted source text** when the
  commented selection is small enough to be "manageable" (a word, sentence,
  line, or short paragraph). The literal selected text is written as inline
  content under `@file`, so a reviewer reading the `.mb` sees what the comment
  is about without opening the source (issue #10). Large selections, and any
  selection whose text would break `.mb` round-trip (e.g. a line that is exactly
  `---` or starts with `<<<`), are written range-only as before.
- New settings: `markback.inlineExcerpt.enabled` (default on),
  `markback.inlineExcerpt.maxLines` (default 10), `markback.inlineExcerpt.maxChars`
  (default 600). The Markback output channel logs whether each comment embedded
  an excerpt or why it was omitted.

## 0.3.3

- Add a **second comment on a line that already has one**: "Comment on
  Selection" on an already-commented line now opens its own draft instead of
  just toggling the existing thread (VS Code's built-in add-comment flow only
  toggles when the line is occupied). The new draft is left visible to click;
  the first comment on a line still focuses the reply box directly.
- The **Escape discard prompt now matches what you're discarding**: editing an
  existing comment asks "Discard your edits?" (and reverts cleanly, leaving the
  comment intact), while a new comment asks "Discard this comment?". Editing no
  longer triggers VS Code's separate "discard these comments?" dialog on top.

## 0.3.2

- Pressing **Escape** in a comment box you've typed in now asks before
  discarding, instead of silently throwing the text away. An empty box still
  closes immediately on Escape. (A box containing only whitespace is treated as
  non-empty by VS Code, so it asks too — there's no public API to read the
  comment input's text and special-case it.)

## 0.3.1

- Fix focus on a new comment from *Comment on Selection* (`Cmd/Ctrl+Shift+M`):
  the reply box now receives the keyboard so you can type immediately, instead
  of having to click it (or press Tab) first. The command now drives VS Code's
  built-in add-comment creation flow — the same path the gutter "+" uses and the
  only public one that focuses the reply *input* editor. The previous approach
  created the thread itself and could only focus the comment widget's outer
  shell, which left the caret one Tab short of the textarea.

## 0.3.0

- **Edit and delete existing comments** from the thread UI — a pencil and trash
  icon on each comment. Editing rewrites the `.mb` record in place; deleting a
  parent also removes its replies. No more hand-editing the sidecar.
- Reliably focus the comment box when a draft thread opens — the cursor is
  aligned to the thread's anchor line and the focus is deferred past the
  widget's render (with one retry), fixing the long-standing "focus didn't
  land" race.
- Write sidecar `.mb` files with OS-correct line endings: an existing sidecar
  keeps its convention, new files follow the editor's `files.eol` (or the
  OS default). Reading tolerates both LF and CRLF.
- Rename display text to **Markback**; fix the Marketplace listing icon URL.

## 0.2.8

- Fix the focus-handoff command id used when opening a new comment thread.

## 0.2.7

- `Cmd/Ctrl+Shift+M` now starts a comment even with no selection (comments the
  word at the cursor).

## 0.2.6

- Right-click → *Comment on Selection* defaults to the word at the cursor when
  nothing is selected.

## 0.2.5

- The comment box auto-focuses when a new draft thread opens.

## 0.2.4

- The Markdown preview auto-refreshes when its `.mb` sidecar changes.

## 0.2.3

- Reply to a thread inline from the preview bubble.

## 0.2.2

- Click a 💬 badge in the preview to open the thread in an inline bubble.

## 0.2.1

- Visible 💬 markers next to commented lines in the Markdown preview.
- Restricted Mode (untrusted workspace) banner when preview command links are blocked.
- Windows sidecar path fix.

## 0.2.0

- **Markdown preview commenting (MVP):** select text in the rendered preview and
  add a comment without leaving the preview.

## 0.1.0

- Initial release: highlight text in any file and add feedback that persists to a
  sidecar `<filename>.mb` file in the Markback V2 format.
