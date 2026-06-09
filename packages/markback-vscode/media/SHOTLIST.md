# Marketplace media — shot list

The README references three images that must be **captured before publishing**.
Until they exist, the Marketplace listing will show broken images — treat this
file as a publish gate.

| File | Type | Used in README as | Priority |
|------|------|-------------------|----------|
| `preview-bubbles.gif` | GIF (hero) | Top-of-listing demo | **P0 — blocks publish** |
| `comment-selection.png` | PNG | Editor selection commenting | P1 |
| `sidecar-diff.png` | PNG | `.mb` diffing in a PR | P1 |

## Capture environment (do this once)

1. Build the engine + extension:
   ```bash
   cd packages/markbackjs && npm install && npm run build
   cd ../markback-vscode && npm install && npm run compile
   ```
2. Open `packages/markback-vscode/` in VS Code, press **F5** → an Extension
   Development Host window opens with MarkBack loaded.
3. Use a **light theme** (Default Light Modern) for contrast in the listing, and
   a clean sample doc (a short README-style Markdown file). **Trust the
   workspace** (preview commenting is disabled in Restricted Mode).
4. Zoom the editor a touch (`Cmd/Ctrl+=` once or twice) so text is legible when
   the image is scaled down in the listing.
5. Hide clutter: close the sidebar/panel, use a narrow window so the shot is
   focused on the gesture, not the whole IDE.

## `preview-bubbles.gif` — the hero (P0)

Show the core loop end to end, ~6–10 seconds, looping:

1. Markdown preview open, cursor visible.
2. **Select a sentence** in the rendered preview → the floating **💬 Comment**
   button appears → click it.
3. Type a short comment (e.g. "tighten this — too wordy") → save.
4. A **💬 badge** appears next to the line.
5. **Click the badge** → the inline thread bubble opens → type a **reply** →
   send.

Keep it tight; trim dead air. Tools: [Peek](https://github.com/phw/peek) (Linux),
LICEcap, or Kap (macOS). Target **≤ 1200px wide**, **≤ 4 MB** (GitHub/Marketplace
render large GIFs slowly; smaller loops feel snappier). Reduce frame rate to
~12–15 fps if size is high.

## `comment-selection.png` (P1)

Editor (not preview): a few lines of any file with a phrase selected and the
inline comment thread widget open mid-typing. Shows the right-click /
`Cmd/Ctrl+Shift+M` path. Crop tight to the selection + widget. ~1000–1200px wide.

## `sidecar-diff.png` (P1)

The payoff: open the Source Control diff (or `git diff`) for a `*.mb` file after
adding a couple of comments, showing added `<<<` records in green. This is the
"it lives in git and diffs in your PR" proof. Can be VS Code's diff view or a
clean terminal `git diff --color`. ~1000–1200px wide.

## After capturing

- Drop the files in this `media/` directory with the exact names above.
- Re-render the README locally to confirm no broken images.
- `media/` is NOT in `.vscodeignore`, so the images ship inside the `.vsix` and
  also resolve on the web listing via the `repository` field. Keep total package
  size reasonable.
