import fs from "fs";
import path from "path";
import { Diagnostic, ErrorCode, ParseResult, Record as MarkbackRecord, Severity, WarningCode } from "./types";
import { parseString } from "./parser";
import { writeRecordCanonical, writeRecordsMulti } from "./writer";

export interface LintOptions {
  sourceFile?: string | null;
  checkSources?: boolean;
  checkCanonical?: boolean;
}

function lintFeedbackJson(
  feedback: string,
  file?: string | null,
  line?: number | null,
  recordIdx?: number | null,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (feedback.startsWith("json:")) {
    const jsonStr = feedback.slice(5);
    try {
      JSON.parse(jsonStr);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      diagnostics.push(
        new Diagnostic({
          file: file ?? null,
          line: line ?? null,
          column: null,
          severity: Severity.ERROR,
          code: ErrorCode.E007,
          message: `Invalid JSON after json: prefix: ${message}`,
          recordIndex: recordIdx ?? null,
        }),
      );
    }
  }

  return diagnostics;
}

function lintFeedbackStructured(
  feedback: string,
  file?: string | null,
  line?: number | null,
  recordIdx?: number | null,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  let inQuote = false;
  let escaped = false;

  for (const char of feedback) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inQuote = !inQuote;
    }
  }

  if (inQuote) {
    diagnostics.push(
      new Diagnostic({
        file: file ?? null,
        line: line ?? null,
        column: null,
        severity: Severity.ERROR,
        code: ErrorCode.E008,
        message: "Unclosed quote in structured attribute value",
        recordIndex: recordIdx ?? null,
      }),
    );
  }

  return diagnostics;
}

function lintFileExists(record: MarkbackRecord, basePath: string | null, recordIdx: number): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (record.file && !record.file.isUri) {
    try {
      const resolved = record.file.resolve(basePath);
      if (!fs.existsSync(resolved)) {
        diagnostics.push(
          new Diagnostic({
            file: record._sourceFile ?? null,
            line: record._startLine ?? null,
            column: null,
            severity: Severity.WARNING,
            code: WarningCode.W003,
            message: `@file not found: ${record.file}`,
            recordIndex: recordIdx,
          }),
        );
      }
    } catch (_err) {
      // Ignore URIs that cannot be resolved to paths.
    }
  }

  return diagnostics;
}

function lintInputExists(record: MarkbackRecord, basePath: string | null, recordIdx: number): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (record.input && !record.input.isUri) {
    try {
      const resolved = record.input.resolve(basePath);
      if (!fs.existsSync(resolved)) {
        diagnostics.push(
          new Diagnostic({
            file: record._sourceFile ?? null,
            line: record._startLine ?? null,
            column: null,
            severity: Severity.WARNING,
            code: WarningCode.W009,
            message: `@input not found: ${record.input}`,
            recordIndex: recordIdx,
          }),
        );
      }
    } catch (_err) {
      // Ignore URIs that cannot be resolved to paths.
    }
  }

  return diagnostics;
}

interface PositionCheck {
  isInvalid: boolean;
  errorMsg: string;
}

function isPositionInvalid(ref: { startLine: number | null; endLine: number | null; startColumn: number | null; endColumn: number | null }): PositionCheck {
  if (ref.startLine === null || ref.endLine === null) {
    return { isInvalid: false, errorMsg: "" };
  }

  if (ref.endLine < ref.startLine) {
    return { isInvalid: true, errorMsg: `end line ${ref.endLine} is less than start line ${ref.startLine}` };
  }

  if (ref.endLine === ref.startLine) {
    if (ref.startColumn !== null && ref.endColumn !== null && ref.endColumn < ref.startColumn) {
      return { isInvalid: true, errorMsg: `end column ${ref.endColumn} is less than start column ${ref.startColumn} on line ${ref.startLine}` };
    }
  }

  return { isInvalid: false, errorMsg: "" };
}

function lintLineRange(record: MarkbackRecord, recordIdx: number): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (record.file && record.file.startLine !== null) {
    const { isInvalid, errorMsg } = isPositionInvalid(record.file);
    if (isInvalid) {
      diagnostics.push(
        new Diagnostic({
          file: record._sourceFile ?? null,
          line: record._startLine ?? null,
          column: null,
          severity: Severity.ERROR,
          code: ErrorCode.E011,
          message: `Invalid range in @file: ${errorMsg}`,
          recordIndex: recordIdx,
        }),
      );
    }
  }

  if (record.input && record.input.startLine !== null) {
    const { isInvalid, errorMsg } = isPositionInvalid(record.input);
    if (isInvalid) {
      diagnostics.push(
        new Diagnostic({
          file: record._sourceFile ?? null,
          line: record._startLine ?? null,
          column: null,
          severity: Severity.ERROR,
          code: ErrorCode.E011,
          message: `Invalid range in @input: ${errorMsg}`,
          recordIndex: recordIdx,
        }),
      );
    }
  }

  return diagnostics;
}

function lintReplyTo(records: MarkbackRecord[], sourceFile?: string | null): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const idToIdx: { [key: string]: number } = {};
  records.forEach((record, idx) => {
    if (record.id && idToIdx[record.id] === undefined) {
      idToIdx[record.id] = idx;
    }
  });

  records.forEach((record, idx) => {
    if (!record.replyTo) {
      return;
    }

    if (idToIdx[record.replyTo] === undefined) {
      diagnostics.push(
        new Diagnostic({
          file: sourceFile ?? null,
          line: record._startLine ?? null,
          column: null,
          severity: Severity.WARNING,
          code: WarningCode.W011,
          message: `@reply-to points at unknown id: ${record.replyTo}`,
          recordIndex: idx,
        }),
      );
      return;
    }

    // Walk up the chain to detect cycles.
    const seen = new Set<number>([idx]);
    let cursor = idToIdx[record.replyTo];
    while (true) {
      if (seen.has(cursor)) {
        diagnostics.push(
          new Diagnostic({
            file: sourceFile ?? null,
            line: record._startLine ?? null,
            column: null,
            severity: Severity.WARNING,
            code: WarningCode.W011,
            message: `@reply-to forms a cycle through: ${record.replyTo}`,
            recordIndex: idx,
          }),
        );
        break;
      }
      seen.add(cursor);
      const parent = records[cursor].replyTo;
      if (!parent || idToIdx[parent] === undefined) {
        break;
      }
      cursor = idToIdx[parent];
    }
  });

  return diagnostics;
}

function lintCanonicalFormat(records: MarkbackRecord[], originalText: string, file?: string | null): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const canonical =
    records.length === 1 ? `${writeRecordCanonical(records[0])}\n` : writeRecordsMulti(records);
  const originalNormalized = originalText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  if (originalNormalized !== canonical) {
    diagnostics.push(
      new Diagnostic({
        file: file ?? null,
        line: 1,
        column: null,
        severity: Severity.WARNING,
        code: WarningCode.W008,
        message: "Non-canonical formatting detected",
      }),
    );
  }

  return diagnostics;
}

class InvalidUtf8Error extends Error {
  code: string;

  constructor(message: string) {
    super(message);
    this.code = "ERR_INVALID_UTF8";
  }
}

function readUtf8FileSync(filePath: string): string {
  const data = fs.readFileSync(filePath);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    return decoder.decode(data);
  } catch (_err) {
    throw new InvalidUtf8Error("File is not valid UTF-8");
  }
}

export function lintString(text: string, options: LintOptions = {}): ParseResult {
  const sourceFile = options.sourceFile ?? null;
  const checkSources = options.checkSources ?? true;
  const checkCanonical = options.checkCanonical ?? true;

  const result = parseString(text, sourceFile);

  result.records.forEach((record, idx) => {
    result.diagnostics.push(...lintFeedbackJson(record.feedback, sourceFile, record._endLine, idx));

    if (!record.feedback.startsWith("json:")) {
      result.diagnostics.push(...lintFeedbackStructured(record.feedback, sourceFile, record._endLine, idx));
    }

    if (checkSources) {
      const basePath = sourceFile ? path.dirname(sourceFile) : null;
      result.diagnostics.push(...lintFileExists(record, basePath, idx));
      result.diagnostics.push(...lintInputExists(record, basePath, idx));
    }

    result.diagnostics.push(...lintLineRange(record, idx));
  });

  result.diagnostics.push(...lintReplyTo(result.records, sourceFile));

  if (checkCanonical && result.records.length > 0 && !result.hasErrors) {
    result.diagnostics.push(...lintCanonicalFormat(result.records, text, sourceFile));
  }

  return result;
}

export function lintFile(filePath: string, options: Omit<LintOptions, "sourceFile"> = {}): ParseResult {
  try {
    const text = readUtf8FileSync(filePath);
    return lintString(text, { ...options, sourceFile: filePath });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      return new ParseResult([], [new Diagnostic({ file: filePath, line: null, column: null, severity: Severity.ERROR, code: ErrorCode.E006, message: "File not found" })], filePath);
    }
    if (err && typeof err === "object" && "code" in err && err.code === "ERR_INVALID_UTF8") {
      return new ParseResult([], [new Diagnostic({ file: filePath, line: null, column: null, severity: Severity.ERROR, code: ErrorCode.E006, message: "File is not valid UTF-8" })], filePath);
    }
    throw err;
  }
}

function walkFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

export function lintFiles(paths: string[], options: Omit<LintOptions, "sourceFile"> = {}): ParseResult[] {
  const results: ParseResult[] = [];

  for (const inputPath of paths) {
    let stats: fs.Stats | null = null;
    try {
      stats = fs.statSync(inputPath);
    } catch (_err) {
      results.push(lintFile(inputPath, options));
      continue;
    }

    if (stats.isDirectory()) {
      const files = walkFiles(inputPath).sort();
      for (const file of files) {
        if (file.endsWith(".mb")) {
          results.push(lintFile(file, options));
        }
      }
    } else {
      results.push(lintFile(inputPath, options));
    }
  }

  return results;
}

export function formatDiagnostics(diagnostics: Diagnostic[], format: "human" | "json" = "human"): string {
  if (format === "json") {
    return JSON.stringify(diagnostics.map((d) => d.toDict()), null, 2);
  }

  return diagnostics.map((d) => d.toString()).join("\n");
}

export function summarizeResults(results: ParseResult[]): { [key: string]: number } {
  const totalRecords = results.reduce((sum, result) => sum + result.records.length, 0);
  const totalErrors = results.reduce((sum, result) => sum + result.errorCount, 0);
  const totalWarnings = results.reduce((sum, result) => sum + result.warningCount, 0);
  const filesWithErrors = results.filter((result) => result.hasErrors).length;
  const filesWithWarnings = results.filter((result) => result.hasWarnings).length;

  return {
    files: results.length,
    records: totalRecords,
    errors: totalErrors,
    warnings: totalWarnings,
    files_with_errors: filesWithErrors,
    files_with_warnings: filesWithWarnings,
  };
}
