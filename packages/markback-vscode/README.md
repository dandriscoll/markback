<div align="center">

<img src="https://raw.githubusercontent.com/dandriscoll/markback/main/packages/markback-vscode/icon.png" width="96" height="96" alt="Markback" />

# Markback for VS Code

**Review Markdown like a doc — keep the feedback in git.**

Comment on rendered Markdown (and any file) with inline bubbles and replies.
Every comment is saved to a plain-text `.mb` sidecar that lives next to the
file and diffs cleanly in your pull requests.

</div>

<!-- TODO(media): hero demo — see media/SHOTLIST.md (preview-bubbles.gif) -->

---

## Why Markback

You're reviewing a README, an RFC, a design doc, or a spec. Your options today:

- **PR review comments** — disappear when the branch merges.
- **A Google Doc** — not in your repo, not in git, not diffable.
- **A scratch note** — lost by next week.

Markback keeps the feedback **next to the work, in plain text, in git**:

- 💬 **Comment on the rendered Markdown preview** — select text, click the bubble,
  type. No need to hunt for the right line in raw source.
- 🧵 **Threads and replies** — click a 💬 badge to open the thread inline and reply.
- 📄 **Saved to a `.mb` sidecar** — `essay.md` → `essay.md.mb`, right beside the
  file. Commit it; it diffs cleanly in PRs and survives merge.
- ✍️ **Works in any file too** — highlight text in the editor, right-click →
  *Markback: Comment on Selection* (or `Cmd/Ctrl+Shift+M`).
- 🔌 **Portable format** — the same `.mb` files work with the Markback
  [CLI](https://markback.org/cli), [Python](https://markback.org/python),
  [Node](https://markback.org/nodejs), and a [browser editor](https://markback.org/try-it).
  No server, no account, no lock-in.

## Quick start

1. **Install** Markback from the Marketplace.
2. Open a Markdown file and open its **preview** (`Cmd/Ctrl+Shift+V`).
3. **Select some text** in the preview → click **💬 Comment** → type your feedback.
4. A sidecar `<filename>.mb` appears next to the file. **Commit it** — the
   feedback now diffs in your PRs.
5. Reopen the file later: the 💬 badges are still there. Click one to read the
   thread or **reply**.

Prefer the editor? Select text in any file → right-click → **Comment on Selection**
(or `Cmd/Ctrl+Shift+M`).

<!-- TODO(media): editor selection commenting — see media/SHOTLIST.md (comment-selection.png) -->

## What a `.mb` file looks like

The sidecar is plain, human-readable text — hand-editable and lintable:

```
%markback 2

@id a1b2-c3d4
@by alice@example.com
@file ./essay.md:3:5-3:18 <<< awkward phrasing
```

That's the whole format: `<<<` introduces a comment. Records
[lint](https://markback.org/cli) with `mb --lint` and round-trip with the
[browser editor](https://markback.org/try-it).

<!-- TODO(media): .mb diffing in a PR — see media/SHOTLIST.md (sidecar-diff.png) -->

## Settings

| Setting | Description |
|---------|-------------|
| `markback.author` | Identifier written as `@by` on every comment. If empty, falls back to `git config user.email`, then to no `@by` header. |

> **Restricted Mode:** preview commenting uses VS Code command links, which are
> disabled in untrusted workspaces. Trust the workspace to enable it — the
> preview shows a banner when it's blocked.

## Current limitations

Honest about where it's at today:

- **No gutter `+` icon yet** — use the preview bubble, the right-click menu, or
  the keybinding.
- **No in-editor edit/delete UI for existing comments** — edit the `.mb` file
  directly (it's just text).
- **No visual stale-range indicator** — if a source file is edited past a
  recorded range, the comment still renders at its recorded position; a warning
  logs to the **Markback** output channel (View → Output → Markback).

## Feedback & contributing

Markback is open source (MIT). Issues, ideas, and PRs are welcome:

- 🐛 **Bugs / ideas:** [github.com/dandriscoll/markback/issues](https://github.com/dandriscoll/markback/issues)
- 📖 **Format & docs:** [markback.org](https://markback.org)
- 🧪 **Try the format in your browser:** [markback.org/try-it](https://markback.org/try-it)

If Markback saves you a round-trip, telling a teammate is the best thanks.

---

<div align="center">
<sub>Part of the <a href="https://markback.org">Markback</a> family — comments for anything, in plain text, in git.</sub>
</div>
