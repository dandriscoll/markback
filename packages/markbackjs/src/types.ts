import path from "path";
import { fileURLToPath, URL } from "url";

export enum Severity {
  ERROR = "error",
  WARNING = "warning",
}

export enum ErrorCode {
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
}

export enum WarningCode {
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
}

export type DiagnosticCode = ErrorCode | WarningCode;

type UnknownMap = { [key: string]: unknown };
type StringMap = { [key: string]: string };

export interface DiagnosticInit {
  file?: string | null;
  line?: number | null;
  column?: number | null;
  severity: Severity;
  code: DiagnosticCode;
  message: string;
  recordIndex?: number | null;
}

export class Diagnostic {
  file: string | null;
  line: number | null;
  column: number | null;
  severity: Severity;
  code: DiagnosticCode;
  message: string;
  recordIndex: number | null;

  constructor(init: DiagnosticInit) {
    this.file = init.file ?? null;
    this.line = init.line ?? null;
    this.column = init.column ?? null;
    this.severity = init.severity;
    this.code = init.code;
    this.message = init.message;
    this.recordIndex = init.recordIndex ?? null;
  }

  get isError(): boolean {
    return this.severity === Severity.ERROR;
  }

  toString(): string {
    const parts: string[] = [];
    if (this.file) {
      parts.push(this.file);
    }
    if (this.line !== null && this.line !== undefined) {
      parts.push(String(this.line));
      if (this.column !== null && this.column !== undefined) {
        parts.push(String(this.column));
      }
    }

    const location = parts.length ? parts.join(":") : "<unknown>";
    return `${location}: ${this.code} ${this.message}`;
  }

  toDict(): UnknownMap {
    return {
      file: this.file,
      line: this.line,
      column: this.column,
      severity: this.severity,
      code: this.code,
      message: this.message,
      record_index: this.recordIndex,
    };
  }
}

function extractScheme(value: string): string | null {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(value);
  return match ? match[1] : null;
}

// Regex to parse line/character range from a path
const LINE_RANGE_PATTERN = /^(.+?):(\d+)(?::(\d+))?(?:-(\d+)(?::(\d+))?)?$/;

export class FileRef {
  value: string;
  isUri: boolean;
  startLine: number | null;
  endLine: number | null;
  startColumn: number | null;
  endColumn: number | null;
  private _pathOnly: string;

  constructor(value: string, isUri = false) {
    this.value = value;
    this.startLine = null;
    this.endLine = null;
    this.startColumn = null;
    this.endColumn = null;
    this._pathOnly = value;

    this._parseLineRange();

    if (isUri) {
      this.isUri = true;
      return;
    }

    const scheme = extractScheme(this._pathOnly);
    this.isUri = !!scheme && scheme.length > 1;
  }

  private _parseLineRange(): void {
    const match = LINE_RANGE_PATTERN.exec(this.value);
    if (match) {
      this._pathOnly = match[1];
      this.startLine = parseInt(match[2], 10);
      if (match[3]) {
        this.startColumn = parseInt(match[3], 10);
      }
      if (match[4]) {
        this.endLine = parseInt(match[4], 10);
        if (match[5]) {
          this.endColumn = parseInt(match[5], 10);
        }
      } else {
        this.endLine = this.startLine;
        this.endColumn = this.startColumn;
      }
    }
  }

  get path(): string {
    return this._pathOnly;
  }

  get lineRangeStr(): string | null {
    if (this.startLine === null) {
      return null;
    }

    let start: string;
    if (this.startColumn !== null) {
      start = `:${this.startLine}:${this.startColumn}`;
    } else {
      start = `:${this.startLine}`;
    }

    if (this.startLine === this.endLine && this.startColumn === this.endColumn) {
      return start;
    }

    let end: string;
    if (this.endColumn !== null) {
      end = `-${this.endLine}:${this.endColumn}`;
    } else {
      end = `-${this.endLine}`;
    }

    return `${start}${end}`;
  }

  resolve(basePath?: string | null): string {
    if (this.isUri) {
      const scheme = extractScheme(this._pathOnly);
      if (scheme && scheme.toLowerCase() === "file") {
        return fileURLToPath(new URL(this._pathOnly));
      }
      throw new Error(`Cannot resolve non-file URI to path: ${this.value}`);
    }

    if (path.isAbsolute(this._pathOnly)) {
      return this._pathOnly;
    }

    if (basePath) {
      return path.join(basePath, this._pathOnly);
    }

    return this._pathOnly;
  }

  toString(): string {
    return this.value;
  }
}

// V1 backward compatibility alias
export const SourceRef = FileRef;

export interface RecordInit {
  feedback: string;
  id?: string | null;
  by?: string | null;
  file?: FileRef | null;
  input?: FileRef | null;
  tags?: string[];
  content?: string | null;
  metadata?: UnknownMap;
  _sourceFile?: string | null;
  _startLine?: number | null;
  _endLine?: number | null;
}

export class Record {
  feedback: string;
  id: string | null;
  by: string | null;
  file: FileRef | null;
  input: FileRef | null;
  tags: string[];
  content: string | null;
  metadata: UnknownMap;
  _sourceFile: string | null;
  _startLine: number | null;
  _endLine: number | null;

  constructor(init: RecordInit) {
    this.feedback = init.feedback;
    this.id = init.id ?? null;
    this.by = init.by ?? null;
    this.file = init.file ?? null;
    this.input = init.input ?? null;
    this.tags = init.tags ?? [];
    this.content = init.content ?? null;
    this.metadata = init.metadata ?? {};
    this._sourceFile = init._sourceFile ?? null;
    this._startLine = init._startLine ?? null;
    this._endLine = init._endLine ?? null;
  }

  // V1 compat getters
  get uri(): string | null { return this.id; }
  get source(): FileRef | null { return this.file; }
  get prior(): FileRef | null { return this.input; }

  getIdentifier(): string | null {
    if (this.id) {
      return this.id;
    }
    if (this.file) {
      return this.file.toString();
    }
    return null;
  }

  hasInlineContent(): boolean {
    return this.content !== null && this.content.trim().length > 0;
  }

  toDict(): UnknownMap {
    return {
      id: this.id,
      by: this.by,
      file: this.file ? this.file.toString() : null,
      input: this.input ? this.input.toString() : null,
      tags: this.tags,
      content: this.content,
      feedback: this.feedback,
      metadata: this.metadata,
    };
  }
}

export class ParseResult {
  records: Record[];
  diagnostics: Diagnostic[];
  sourceFile: string | null;
  scope: string[] | null;
  covers: string | null;
  version: number | null;

  constructor(
    records: Record[],
    diagnostics: Diagnostic[],
    sourceFile?: string | null,
    scope?: string[] | null,
    covers?: string | null,
    version?: number | null,
  ) {
    this.records = records;
    this.diagnostics = diagnostics;
    this.sourceFile = sourceFile ?? null;
    this.scope = scope ?? null;
    this.covers = covers ?? null;
    this.version = version ?? null;
  }

  get hasErrors(): boolean {
    return this.diagnostics.some((d) => d.severity === Severity.ERROR);
  }

  get hasWarnings(): boolean {
    return this.diagnostics.some((d) => d.severity === Severity.WARNING);
  }

  get errorCount(): number {
    return this.diagnostics.filter((d) => d.severity === Severity.ERROR).length;
  }

  get warningCount(): number {
    return this.diagnostics.filter((d) => d.severity === Severity.WARNING).length;
  }
}

export interface FeedbackParsed {
  raw: string;
  label: string | null;
  attributes: StringMap;
  comment: string | null;
  isJson: boolean;
  jsonData: UnknownMap | null;
}

export function parseFeedback(feedback: string): FeedbackParsed {
  const result: FeedbackParsed = {
    raw: feedback,
    label: null,
    attributes: {},
    comment: null,
    isJson: false,
    jsonData: null,
  };

  if (feedback.startsWith("json:")) {
    result.isJson = true;
    try {
      result.jsonData = JSON.parse(feedback.slice(5));
    } catch (_err) {
      // Ignore invalid JSON; leave as raw.
    }
    return result;
  }

  const segments: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < feedback.length; i += 1) {
    const char = feedback[i];

    if (char === '"' && (i === 0 || feedback[i - 1] !== "\\")) {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }

    if (char === ";" && !inQuotes && feedback[i + 1] === " ") {
      segments.push(current);
      current = "";
      i += 1;
      continue;
    }

    current += char;
  }

  if (current) {
    segments.push(current);
  }

  for (const segmentRaw of segments) {
    const segment = segmentRaw.trim();
    if (!segment) {
      continue;
    }

    if (segment.includes("=")) {
      const eqPos = segment.indexOf("=");
      const key = segment.slice(0, eqPos);
      let value = segment.slice(eqPos + 1);
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      }
      result.attributes[key] = value;
    } else if (!result.label) {
      result.label = segment;
    } else if (result.comment) {
      result.comment = `${result.comment}; ${segment}`;
    } else {
      result.comment = segment;
    }
  }

  return result;
}
