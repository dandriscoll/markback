import { Diagnostic, ErrorCode, FileRef, ParseResult, Record as MarkbackRecord, Severity, WarningCode } from "./types";

const KNOWN_HEADERS = new Set(["id", "by", "file", "input", "tag"]);
const V1_HEADER_MAP: { [key: string]: string } = { uri: "id", source: "file", prior: "input" };

const HEADER_PATTERN = /^@([a-z]+)\s+(.+)$/;
const FEEDBACK_DELIMITER = "<<<";
const RECORD_SEPARATOR = "---";
const COMPACT_PATTERN = /^@file\s+(.+?)\s+<<<\s+(.*)$/;
const V1_COMPACT_PATTERN = /^@source\s+(.+?)\s+<<<\s+(.*)$/;
const FILE_HEADER_PATTERN = /^%([a-z]+)\s*(.*)$/;

enum LineType {
  COMPACT_RECORD = "compact_record",
  HEADER = "header",
  FEEDBACK = "feedback",
  SEPARATOR = "separator",
  BLANK = "blank",
  CONTENT = "content",
  FILE_HEADER = "file_header",
}

function stripLine(line: string): string {
  return line.replace(/\s+$/, "");
}

function classifyLine(line: string): LineType {
  const stripped = stripLine(line);

  if (!stripped) {
    return LineType.BLANK;
  }

  if (stripped === RECORD_SEPARATOR) {
    return LineType.SEPARATOR;
  }

  if (stripped.startsWith("%")) {
    return LineType.FILE_HEADER;
  }

  if (stripped.includes(FEEDBACK_DELIMITER)) {
    if (stripped.startsWith("@file") || stripped.startsWith("@source")) {
      return LineType.COMPACT_RECORD;
    }
  }

  if (stripped.startsWith("@")) {
    return LineType.HEADER;
  }

  if (stripped.startsWith(FEEDBACK_DELIMITER)) {
    return LineType.FEEDBACK;
  }

  return LineType.CONTENT;
}

function parseHeader(line: string): [string | null, string | null, string | null] {
  const stripped = stripLine(line);
  const match = HEADER_PATTERN.exec(stripped);
  if (!match) {
    return [null, null, `Malformed header syntax: ${stripped}`];
  }
  return [match[1], match[2], null];
}

function parseCompactRecord(line: string): [FileRef | null, string | null, string | null, boolean] {
  const stripped = stripLine(line);

  // Try V2 format first
  let match = COMPACT_PATTERN.exec(stripped);
  if (match) {
    return [new FileRef(match[1]), match[2], null, false];
  }

  // Try V1 format
  match = V1_COMPACT_PATTERN.exec(stripped);
  if (match) {
    return [new FileRef(match[1]), match[2], null, true];
  }

  return [null, null, `Invalid compact record syntax: ${line}`, false];
}

export function parseString(text: string, sourceFile?: string | null): ParseResult {
  let lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines = lines.slice(0, -1);
  }

  const records: MarkbackRecord[] = [];
  const diagnostics: Diagnostic[] = [];

  let fileVersion: number | null = null;
  let fileScope: string[] | null = null;
  let fileCovers: string | null = null;

  const addDiagnostic = (
    severity: Severity,
    code: ErrorCode | WarningCode,
    message: string,
    lineNum?: number | null,
    col?: number | null,
    recordIdx?: number | null,
  ) => {
    diagnostics.push(
      new Diagnostic({
        file: sourceFile ?? null,
        line: lineNum ?? null,
        column: col ?? null,
        severity,
        code,
        message,
        recordIndex: recordIdx ?? null,
      }),
    );
  };

  let currentHeaders: { [key: string]: string } = {};
  let currentContentLines: string[] = [];
  let currentStartLine = 1;
  let pendingId: string | null = null;
  let inContent = false;
  let hadBlankLine = false;
  let pastFileHeaders = false;

  const finalizeRecord = (feedback: string, endLine: number) => {
    const id = currentHeaders.id ?? pendingId;
    const by = currentHeaders.by ?? null;
    const fileStr = currentHeaders.file;
    const fileRef = fileStr ? new FileRef(fileStr) : null;
    const inputStr = currentHeaders.input;
    const inputRef = inputStr ? new FileRef(inputStr) : null;
    const tagStr = currentHeaders.tag;
    const tags = tagStr ? tagStr.split(/\s+/) : [];

    let content: string | null = null;
    if (currentContentLines.length > 0) {
      const contentLines = [...currentContentLines];
      while (contentLines.length > 0 && !contentLines[0].trim()) {
        contentLines.shift();
      }
      while (contentLines.length > 0 && !contentLines[contentLines.length - 1].trim()) {
        contentLines.pop();
      }
      content = contentLines.length > 0 ? contentLines.join("\n") : null;
    }

    records.push(
      new MarkbackRecord({
        feedback,
        id: id ?? null,
        by,
        file: fileRef,
        input: inputRef,
        tags,
        content,
        _sourceFile: sourceFile ?? null,
        _startLine: currentStartLine,
        _endLine: endLine,
      }),
    );

    currentHeaders = {};
    currentContentLines = [];
    currentStartLine = endLine + 1;
    pendingId = null;
    inContent = false;
    hadBlankLine = false;
  };

  let lineNum = 0;
  while (lineNum < lines.length) {
    const line = lines[lineNum];
    lineNum += 1;
    const lineType = classifyLine(line);

    if (line !== line.replace(/\s+$/, "")) {
      addDiagnostic(Severity.WARNING, WarningCode.W004, "Trailing whitespace", lineNum);
    }

    // File-level headers
    if (lineType === LineType.FILE_HEADER) {
      if (pastFileHeaders) {
        inContent = true;
        currentContentLines.push(line);
        continue;
      }

      const stripped = stripLine(line);
      const match = FILE_HEADER_PATTERN.exec(stripped);
      if (match) {
        const keyword = match[1];
        const value = match[2].trim();

        if (keyword === "markback") {
          const v = parseInt(value, 10);
          if (!isNaN(v)) {
            fileVersion = v;
          }
        } else if (keyword === "scope") {
          fileScope = value ? value.split(/\s+/) : [];
        } else if (keyword === "covers") {
          fileCovers = value || null;
        }
      }
      continue;
    }

    if (lineType !== LineType.BLANK) {
      pastFileHeaders = true;
    }

    if (lineType === LineType.SEPARATOR) {
      if (Object.keys(currentHeaders).length > 0 || currentContentLines.length > 0) {
        addDiagnostic(Severity.ERROR, ErrorCode.E001, "Missing feedback (no <<< delimiter found)", currentStartLine, undefined, records.length);
      }
      currentStartLine = lineNum + 1;
      pendingId = null;
      inContent = false;
      hadBlankLine = false;
      continue;
    }

    if (lineType === LineType.BLANK) {
      if (Object.keys(currentHeaders).length > 0 && !inContent) {
        hadBlankLine = true;
      } else if (inContent) {
        currentContentLines.push("");
      }
      continue;
    }

    if (lineType === LineType.COMPACT_RECORD) {
      const [fileRef, feedback, error, isV1] = parseCompactRecord(line);
      if (error) {
        addDiagnostic(Severity.ERROR, ErrorCode.E006, error, lineNum);
        continue;
      }

      if (isV1) {
        addDiagnostic(Severity.WARNING, WarningCode.W010, "V1 format detected: @source mapped to @file", lineNum);
      }

      if (feedback !== null && feedback.length === 0) {
        addDiagnostic(Severity.ERROR, ErrorCode.E009, "Empty feedback (nothing after <<< )", lineNum);
      }

      const id = pendingId ?? currentHeaders.id ?? null;
      const by = currentHeaders.by ?? null;
      const inputStr = currentHeaders.input;
      const inputRef = inputStr ? new FileRef(inputStr) : null;
      const tagStr = currentHeaders.tag;
      const tags = tagStr ? tagStr.split(/\s+/) : [];

      records.push(
        new MarkbackRecord({
          feedback: feedback ?? "",
          id,
          by,
          file: fileRef,
          input: inputRef,
          tags,
          content: null,
          _sourceFile: sourceFile ?? null,
          _startLine: currentStartLine,
          _endLine: lineNum,
        }),
      );

      currentHeaders = {};
      currentContentLines = [];
      currentStartLine = lineNum + 1;
      pendingId = null;
      inContent = false;
      hadBlankLine = false;
      continue;
    }

    if (lineType === LineType.HEADER) {
      if (hadBlankLine || inContent) {
        inContent = true;
        currentContentLines.push(line);
        continue;
      }

      let [keyword, value, error] = parseHeader(line);
      if (error) {
        addDiagnostic(Severity.ERROR, ErrorCode.E006, error, lineNum);
        continue;
      }

      // V1 backward compat
      if (keyword && keyword in V1_HEADER_MAP) {
        const newKeyword = V1_HEADER_MAP[keyword];
        addDiagnostic(Severity.WARNING, WarningCode.W010, `V1 format detected: @${keyword} mapped to @${newKeyword}`, lineNum);
        keyword = newKeyword;
      }

      if (keyword && !KNOWN_HEADERS.has(keyword)) {
        addDiagnostic(Severity.WARNING, WarningCode.W002, `Unknown header keyword: @${keyword}`, lineNum);
      }

      if (keyword === "id" && value) {
        pendingId = value;
      }

      // Merge tags
      if (keyword === "tag" && currentHeaders.tag && value) {
        currentHeaders.tag = currentHeaders.tag + " " + value;
      } else if (keyword && value) {
        currentHeaders[keyword] = value;
      }
      continue;
    }

    if (lineType === LineType.FEEDBACK) {
      const stripped = stripLine(line);
      let feedback = "";

      if (stripped === FEEDBACK_DELIMITER) {
        addDiagnostic(Severity.ERROR, ErrorCode.E009, "Empty feedback (nothing after <<< )", lineNum);
      } else if (stripped.startsWith(`${FEEDBACK_DELIMITER} `)) {
        feedback = stripped.slice(FEEDBACK_DELIMITER.length + 1);
      } else {
        feedback = stripped.slice(FEEDBACK_DELIMITER.length).trimStart();
      }

      if (currentContentLines.length > 0 && !hadBlankLine) {
        const firstContent = currentContentLines[0] ?? "";
        if (firstContent.startsWith("@")) {
          addDiagnostic(Severity.ERROR, ErrorCode.E010, "Missing blank line before inline content (content starts with @)", currentStartLine, undefined, records.length);
        }
      }

      finalizeRecord(feedback, lineNum);
      continue;
    }

    if (lineType === LineType.CONTENT) {
      inContent = true;
      currentContentLines.push(line);
    }
  }

  if (Object.keys(currentHeaders).length > 0 || currentContentLines.length > 0) {
    addDiagnostic(Severity.ERROR, ErrorCode.E001, "Missing feedback (no <<< delimiter found)", currentStartLine, undefined, records.length);
  }

  // Check for duplicate IDs
  const seenIds: { [key: string]: number } = {};
  records.forEach((record, idx) => {
    if (record.id) {
      if (seenIds[record.id] !== undefined) {
        addDiagnostic(Severity.WARNING, WarningCode.W001, `Duplicate ID: ${record.id} (first seen in record ${seenIds[record.id]})`, record._startLine ?? undefined, undefined, idx);
      } else {
        seenIds[record.id] = idx;
      }
    }
  });

  // Check for missing IDs
  records.forEach((record, idx) => {
    if (!record.id) {
      addDiagnostic(Severity.WARNING, WarningCode.W006, "Missing @id (record has no identifier)", record._startLine ?? undefined, undefined, idx);
    }
  });

  return new ParseResult(records, diagnostics, sourceFile ?? null, fileScope, fileCovers, fileVersion);
}
