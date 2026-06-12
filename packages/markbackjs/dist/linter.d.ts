import { Diagnostic, ParseResult } from "./types";
export interface LintOptions {
    sourceFile?: string | null;
    checkSources?: boolean;
    checkCanonical?: boolean;
}
export declare function lintString(text: string, options?: LintOptions): ParseResult;
export declare function lintFile(filePath: string, options?: Omit<LintOptions, "sourceFile">): ParseResult;
export declare function lintFiles(paths: string[], options?: Omit<LintOptions, "sourceFile">): ParseResult[];
export declare function formatDiagnostics(diagnostics: Diagnostic[], format?: "human" | "json"): string;
export declare function summarizeResults(results: ParseResult[]): {
    [key: string]: number;
};
//# sourceMappingURL=linter.d.ts.map