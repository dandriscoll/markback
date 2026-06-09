// Production bundle for packaging. Inlines `markbackjs` (a file: workspace
// dependency) into a single self-contained dist/extension.js so the published
// .vsix ships only built code — not the dependency's node_modules (which, via
// the symlinked file: dep, otherwise drags in the TypeScript compiler and
// @types/node). `vscode` is provided by the host and stays external.
//
// Dev (F5) and unit tests use `tsc` (npm run compile / watch), which emits the
// per-module dist/*.js the tests import. This bundle is only for vsce packaging
// and is invoked from `vscode:prepublish`.

const esbuild = require("esbuild");

esbuild
  .build({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    outfile: "dist/extension.js",
    external: ["vscode"],
    platform: "node",
    format: "cjs",
    target: "node18",
    minify: true,
    sourcemap: false,
    logLevel: "info",
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
