export type Eol = "\n" | "\r\n";
/** CRLF if the text contains any CRLF, else LF. */
export declare function detectEol(text: string): Eol;
/**
 * Translate LF-canonical text to the given EOL. Any pre-existing CRLF is
 * collapsed first so the result is uniform.
 */
export declare function applyEol(text: string, eol: Eol): string;
//# sourceMappingURL=eol.d.ts.map