# makrbackjs

JavaScript/TypeScript linter for the MarkBack format.

## Install

```bash
npm install makrbackjs
```

## Usage

```js
const { lintString, formatDiagnostics } = require("makrbackjs");

const text = "Content here.\n<<< positive\n";
const result = lintString(text, { checkSources: false, checkCanonical: false });

if (result.hasErrors) {
  console.log(formatDiagnostics(result.diagnostics));
}
```

## API

- `lintString(text, options)`
- `lintFile(path, options)`
- `lintFiles(paths, options)`
- `formatDiagnostics(diagnostics, format)`
- `summarizeResults(results)`

Options:
- `sourceFile`: string
- `checkSources`: boolean (default true)
- `checkCanonical`: boolean (default true)

## Build

```bash
npm run build
```
