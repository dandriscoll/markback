# Publishing the Markback VS Code extension

Quick reference for cutting a new release of `dandriscoll.markback-vscode` to the
VS Code Marketplace. Run everything from this directory
(`packages/markback-vscode/`).

## One-time setup

- Install nothing globally — `vsce` (and `ovsx`) are run via `npx`.
- Get a **Marketplace Personal Access Token (PAT)** for the `dandriscoll`
  publisher from Azure DevOps (<https://dev.azure.com> → User settings →
  Personal access tokens → scope **Marketplace ▸ Manage**). Then either:
  - `npx @vscode/vsce login dandriscoll` (paste the PAT once; it's cached), or
  - export it per-command: `VSCE_PAT=xxxxx npx @vscode/vsce publish`.
- The PAT is a secret — never commit it or paste it into the repo.

## Release checklist

1. **Bump the version** in `package.json` (semver) and add a matching entry at
   the top of `CHANGELOG.md`.
2. **Run the tests:** `npm test` (unit). Optionally
   `npm run test:integration` on a machine with a display + the GUI libs (see
   `test-integration/` — it launches a real VS Code via `@vscode/test-electron`).
3. **Commit** the version bump + changelog (and push, per the repo's push rules).

## Package and inspect (recommended before publishing)

```bash
npx @vscode/vsce package --no-dependencies
```

- This first runs the `vscode:prepublish` script automatically
  (`build:dep` → `clean` → `bundle`), which rebuilds `markbackjs` and produces
  the esbuild bundle `dist/extension.js`.
- `--no-dependencies` is correct here because the extension is **bundled** —
  esbuild inlines `markbackjs` into `dist/extension.js`, and `.vscodeignore`
  ships only that bundle (plus `src/preview/**`, the icon, README/CHANGELOG/
  LICENSE). Without the flag, `vsce` tries to walk the `file:` dependency.
- Output: `markback-vscode-<version>.vsix`. Inspect its contents with
  `npx @vscode/vsce ls` if you want to confirm what ships. The `.vsix` is a build
  artifact — don't commit it.

## Publish

```bash
npx @vscode/vsce publish --no-dependencies
```

- Publishes the current `package.json` version to the Marketplace.
- Or publish the file you already packaged:
  `npx @vscode/vsce publish --packagePath markback-vscode-<version>.vsix`.
- `vsce publish patch|minor|major` can bump the version for you instead of
  editing `package.json` by hand (it also commits the bump if the tree is clean).

## Verify

- Marketplace listing:
  <https://marketplace.visualstudio.com/items?itemName=dandriscoll.markback-vscode>
- It can take a few minutes to index. In VS Code, the new version appears in the
  Extensions view (it may need a reload / "Check for Extension Updates").

## Optional: Open VSX (for VSCodium / Cursor / etc.)

If you also publish to the Open VSX registry:

```bash
npx ovsx publish markback-vscode-<version>.vsix -p <OPEN_VSX_TOKEN>
```

(Token from <https://open-vsx.org> → your profile → Access Tokens. Same secret
rules apply.)
