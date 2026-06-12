"use strict";
// Shared line-ending helpers. Records are produced internally with LF; a
// file-writing consumer (e.g. the VS Code extension) resolves the target EOL
// and translates just before writing to disk.
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectEol = detectEol;
exports.applyEol = applyEol;
/** CRLF if the text contains any CRLF, else LF. */
function detectEol(text) {
    return text.includes("\r\n") ? "\r\n" : "\n";
}
/**
 * Translate LF-canonical text to the given EOL. Any pre-existing CRLF is
 * collapsed first so the result is uniform.
 */
function applyEol(text, eol) {
    if (eol === "\n")
        return text.replace(/\r\n/g, "\n");
    return text.replace(/\r\n/g, "\n").replace(/\n/g, eol);
}
//# sourceMappingURL=eol.js.map