# Markback tooling

The format is hand-writable and the skill body is enough to read and write it
unaided. Reach for what is below when you want validation, bulk labeling, or
programmatic generation.

Current release across the packages: **0.3.0** (VS Code extension 0.3.6).

## CLI — `markback`, aliased `mb`

```bash
pip install markback     # ships both `markback` and `mb`
npm install markbackjs   # library only — no CLI
```

### Annotating

```bash
mb myfile.txt "good; clear writing"      # positional shorthand
mb myfile.txt -f "good; clear writing"   # same, explicit
mb output.txt "accurate" --input prompt.txt
mb file.txt "good" --tag "review p1" --by alice@example.com
mb '*.jpg' -f "approved"                 # same feedback for every match
mb '*.jpg' --print                       # interactive: print each file, prompt for feedback
mb https://example.com/blog/post.html "great explanation"
```

Annotating writes a sidecar next to the target — `myfile.txt` → `myfile.txt.mb`
— containing `@file <target>`, a snapshot of the text content, and the feedback.
Repeat invocations **append** a record (the file is re-parsed and rewritten, so
hand formatting is re-canonicalized). Note it does not write `%markback 2`.

The positional shorthand fires only when there are exactly two arguments, the
first is not a glob, and the second does not exist as a path. Otherwise both
arguments are treated as targets — quote the feedback and prefer `-f` when in
doubt.

Sweep run:

```bash
mb '*.txt' -f "issue-A" --scope "issue-A issue-B" --covers "./*.txt"
```

### Utility modes

| Command | Does |
|---|---|
| `mb --lint FILE...` | Validate. `--json` for machine output. |
| `mb --lint --no-source-check` | Skip `@file`/`@input` existence checks (W003/W009) — use when annotating paths that are not local. |
| `mb --lint --no-canonical-check` | Skip W008 — worth defaulting to, since any file with `%` headers reports it. |
| `mb --list FILE...` | One line per record: identifier + feedback. |
| `mb --stats FILE...` | Counts and distributions. |
| `mb --normalize FILE` | Print canonical form; `--in-place` to write, `-o OUT` to redirect. |
| `mb --convert --to {single,multi,compact} -o OUT FILE` | Re-layout a file. |
| `mb --upgrade [--apply] [--in-place] FILE...` | Rewrite V1 headers to V2. |
| `mb --version` | Version. |

Lint exits non-zero on errors, which makes `mb --lint` a usable CI or
pre-handoff gate.

Normalize refuses to run on a file with errors. It also expands multi-segment
sections into `---`-separated records and only emits the compact layout when
every record qualifies — see the Traps section of the skill.

## Python

```python
from markback import parse_file, parse_string, lint_file, write, append, Record, FileRef, Action

result = parse_file("labels.mb")
result.records          # list[Record]
result.diagnostics      # list[Diagnostic]
result.has_errors
result.scope            # from %scope
result.covers           # from %covers
result.version          # from %markback
result.covered_files()  # resolve the %covers glob → set[Path]

rec = result.records[0]
rec.id, rec.by, rec.reply_to, rec.tags, rec.actions, rec.content, rec.feedback
rec.file                # FileRef: .path, .start_line, .end_line, .start_column, .end_column
rec.to_dict()

write("out.mb", [Record(feedback="good", id="item-1", content="First item")])
append("out.mb", Record(feedback="great", id="item-3", file=FileRef("./x.py:42")))
```

Also exported: `parse_directory`, `discover_sidecars`, `write_string`,
`normalize`, `lint_string`, `lint_files`, `format_diagnostics`,
`summarize_results`, `parse_feedback` (the structured-feedback splitter),
`OutputMode`, and the `ErrorCode` / `WarningCode` / `Severity` enums.

`parse_feedback(s)` returns a `FeedbackParsed` with `.label`, `.attributes`,
`.comment`, `.is_json`, `.json_data`, `.raw`.

## Node / TypeScript — `markbackjs`

String-oriented, so it runs in a browser as well as Node. There is no
`parseFile`/`writeFile`; read and write the bytes yourself.

```ts
import {
  parseString, writeString, writeRecordCanonical, writeRecordsMulti,
  lintString, lintFile, lintFiles, formatDiagnostics, summarizeResults,
  parseFeedback, detectEol, applyEol,
  Record, FileRef, Action, ParseResult, Diagnostic,
} from "markbackjs";
```

Records are produced internally with LF. When writing to disk, resolve the
target's convention with `detectEol(existingText)` and translate with
`applyEol(text, eol)` just before the write — that is what the VS Code
extension does.

## VS Code extension

Marketplace id `dandriscoll.markback-vscode`. Comment on the Markdown *preview*
(and on any file) with `Cmd/Ctrl+Shift+M` or the right-click menu; feedback is
saved to a plain-text `.mb` sidecar that diffs in git. Supports threaded
replies, editing and deleting comments, resolve/reopen (which writes `@action`
lines), and embeds a quoted excerpt of the source in the generated `.mb`.

## When to use what

- **Writing a handful of review comments** — write the `.mb` by hand. Faster
  than any tool and you control the layout.
- **Handing a file to someone or to CI** — `mb --lint` first.
- **Reading a large or unfamiliar `.mb`** — `mb --list`, then read the regions
  that matter.
- **Labeling a batch programmatically** — the Python API; use compact records.
- **Inside an editor or a web app** — `markbackjs`.
- **Human review of prose or code in an editor** — the VS Code extension.
