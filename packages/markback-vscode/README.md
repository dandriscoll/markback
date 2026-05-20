# MarkBack for VS Code

Highlight text in any file and add feedback. The feedback persists to a
sidecar `<filename>.mb` file using the MarkBack V2 format.

```
essay.txt              ← what you're commenting on
essay.txt.mb           ← MarkBack records (your comments)
```

This is v0.1. The headline gesture is selection-based commenting.
LSP-style `.mb` authoring, the gutter `+` icon, the visual stale-range
indicator, and Marketplace publication are planned for later.

## Try it (F5 dev-host)

```bash
cd packages/markbackjs && npm install && npm run build   # build the lint engine
cd ../markback-vscode && npm install && npm run compile  # build the extension
```

Open `packages/markback-vscode/` in VS Code and press **F5**. A new VS
Code window opens with the extension loaded.

In that window:

1. Open any text file.
2. Select a substring.
3. Right-click → **MarkBack: Comment on Selection** (or `Cmd+Shift+M` /
   `Ctrl+Shift+M`).
4. Type feedback in the inline widget. Click **Save Comment**.
5. A sidecar `<filename>.mb` appears next to the file you selected
   from.
6. Close and reopen the file. Your comment is still there.

## Settings

- `markback.author` — string. Identifier written as `@by` on every
  comment. If empty, falls back to `git config user.email`, then to
  no `@by` header.

## Output / Logs

View → Output → **MarkBack**. Parse errors, write failures, and
stale-range warnings all log here.

## v0.1 known limitations

- Selection-only — there is no gutter `+` icon. Use the right-click
  menu or the keybinding.
- Edit / delete UI for existing comments — not implemented. Edit the
  `.mb` file directly for now.
- Visual stale-range indicator — not implemented. If the source file
  is edited past a recorded range, the comment still renders at the
  recorded position; a warning logs to the OutputChannel.
- VS Code runtime tests (`@vscode/test-electron`) — not set up.
  Unit tests cover the pure-TS layer only (`npm test`).

## Format

Records produced by the extension parse with `mb --lint` and the
browser try-it editor at markback.org/try-it. Example output:

```
%markback 2

@id a1b2-c3d4
@by alice@example.com
@file ./essay.txt:3:5-3:18 <<< awkward phrasing
```
