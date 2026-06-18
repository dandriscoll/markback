export declare enum Severity {
    ERROR = "error",
    WARNING = "warning"
}
export declare enum ErrorCode {
    E001 = "E001",
    E002 = "E002",
    E003 = "E003",
    E004 = "E004",
    E005 = "E005",
    E006 = "E006",
    E007 = "E007",
    E008 = "E008",
    E009 = "E009",
    E010 = "E010",
    E011 = "E011",
    E012 = "E012"
}
export declare enum WarningCode {
    W001 = "W001",
    W002 = "W002",
    W003 = "W003",
    W004 = "W004",
    W005 = "W005",
    W006 = "W006",
    W007 = "W007",
    W008 = "W008",
    W009 = "W009",
    W010 = "W010",
    W011 = "W011",
    W012 = "W012"
}
export type DiagnosticCode = ErrorCode | WarningCode;
type UnknownMap = {
    [key: string]: unknown;
};
type StringMap = {
    [key: string]: string;
};
export interface DiagnosticInit {
    file?: string | null;
    line?: number | null;
    column?: number | null;
    severity: Severity;
    code: DiagnosticCode;
    message: string;
    recordIndex?: number | null;
}
export declare class Diagnostic {
    file: string | null;
    line: number | null;
    column: number | null;
    severity: Severity;
    code: DiagnosticCode;
    message: string;
    recordIndex: number | null;
    constructor(init: DiagnosticInit);
    get isError(): boolean;
    toString(): string;
    toDict(): UnknownMap;
}
export declare class FileRef {
    value: string;
    isUri: boolean;
    startLine: number | null;
    endLine: number | null;
    startColumn: number | null;
    endColumn: number | null;
    private _pathOnly;
    constructor(value: string, isUri?: boolean);
    private _parseLineRange;
    get path(): string;
    get lineRangeStr(): string | null;
    resolve(basePath?: string | null): string;
    toString(): string;
}
export declare const SourceRef: typeof FileRef;
export interface Action {
    verb: string;
    timestamp: string;
    actor: string | null;
}
export interface RecordInit {
    feedback: string;
    id?: string | null;
    replyTo?: string | null;
    by?: string | null;
    file?: FileRef | null;
    input?: FileRef | null;
    tags?: string[];
    actions?: Action[];
    content?: string | null;
    metadata?: UnknownMap;
    _sourceFile?: string | null;
    _startLine?: number | null;
    _endLine?: number | null;
}
export declare class Record {
    feedback: string;
    id: string | null;
    replyTo: string | null;
    by: string | null;
    file: FileRef | null;
    input: FileRef | null;
    tags: string[];
    actions: Action[];
    content: string | null;
    metadata: UnknownMap;
    _sourceFile: string | null;
    _startLine: number | null;
    _endLine: number | null;
    constructor(init: RecordInit);
    get uri(): string | null;
    get source(): FileRef | null;
    get prior(): FileRef | null;
    getIdentifier(): string | null;
    hasInlineContent(): boolean;
    hasActions(): boolean;
    toDict(): UnknownMap;
}
export declare class ParseResult {
    records: Record[];
    diagnostics: Diagnostic[];
    sourceFile: string | null;
    scope: string[] | null;
    covers: string | null;
    version: number | null;
    constructor(records: Record[], diagnostics: Diagnostic[], sourceFile?: string | null, scope?: string[] | null, covers?: string | null, version?: number | null);
    get hasErrors(): boolean;
    get hasWarnings(): boolean;
    get errorCount(): number;
    get warningCount(): number;
}
export interface FeedbackParsed {
    raw: string;
    label: string | null;
    attributes: StringMap;
    comment: string | null;
    isJson: boolean;
    jsonData: UnknownMap | null;
}
export declare function parseFeedback(feedback: string): FeedbackParsed;
export {};
//# sourceMappingURL=types.d.ts.map