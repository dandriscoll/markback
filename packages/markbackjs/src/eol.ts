// Shared line-ending helpers. Records are produced internally with LF; a
// file-writing consumer (e.g. the VS Code extension) resolves the target EOL
// and translates just before writing to disk.

export type Eol = "\n" | "\r\n";

/** CRLF if the text contains any CRLF, else LF. */
export function detectEol(text: string): Eol {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

/**
 * Translate LF-canonical text to the given EOL. Any pre-existing CRLF is
 * collapsed first so the result is uniform.
 */
export function applyEol(text: string, eol: Eol): string {
  if (eol === "\n") return text.replace(/\r\n/g, "\n");
  return text.replace(/\r\n/g, "\n").replace(/\n/g, eol);
}
