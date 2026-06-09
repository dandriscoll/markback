# Changelog

All notable changes to the MarkBack VS Code extension are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

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
  sidecar `<filename>.mb` file in the MarkBack V2 format.
