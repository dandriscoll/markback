import { Diagnostic, ErrorCode, ParseResult, Record as MarkbackRecord, Severity, SourceRef, WarningCode } from "./types";

const KNOWN_HEADERS = new Set(["uri", "source", "prior"]);

const HEADER_PATTERN = /^@([a-z]+)\s+(.+)$/;
const FEEDBACK_DELIMITER = "<<<";
const RECORD_SEPARATOR = "---";
const COMPACT_PATTERN = /^@source\s+(.+?)\s+<<<\s+(.*)$/;

enum LineType {
  COMPACT_RECORD = "compact_record",
  HEADER = "header",
  FEEDBACK = "feedback",
  SEPARATOR = "separator",
  BLANK = "blank",
  CONTENT = "content",
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

  if (stripped.startsWith("@source") && stripped.includes(FEEDBACK_DELIMITER)) {
    return LineType.COMPACT_RECORD;
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

function validateUri(uri: string): string | null {
  const schemeMatch = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(uri);
  if (!schemeMatch) {
    return `URI missing scheme: ${uri}`;
  }
  return null;
}

function parseCompactRecord(line: string): [SourceRef | null, string | null, string | null] {
  const match = COMPACT_PATTERN.exec(stripLine(line));
  if (!match) {
    return [null, null, `Invalid compact record syntax: ${line}`];
  }

  const sourcePath = match[1];
  const feedback = match[2];

  return [new SourceRef(sourcePath), feedback, null];
}

export function parseString(text: string, sourceFile?: string | null): ParseResult {
  let lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines = lines.slice(0, -1);
  }

  const records: MarkbackRecord[] = [];
  const diagnostics: Diagnostic[] = [];

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
  let pendingUri: string | null = null;
  let inContent = false;
  let hadBlankLine = false;

  const finalizeRecord = (feedback: string, endLine: number, isCompact = false) => {
    const uri = currentHeaders.uri ?? pendingUri;
    const sourceStr = currentHeaders.source;
    const source = sourceStr ? new SourceRef(sourceStr) : null;
    const priorStr = currentHeaders.prior;
    const prior = priorStr ? new SourceRef(priorStr) : null;

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
        uri: uri ?? null,
        source,
        prior,
        content,
        _sourceFile: sourceFile ?? null,
        _startLine: currentStartLine,
        _endLine: endLine,
        _isCompact: isCompact,
      }),
    );

    currentHeaders = {};
    currentContentLines = [];
    currentStartLine = endLine + 1;
    pendingUri = null;
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

    if (lineType === LineType.SEPARATOR) {
      if (Object.keys(currentHeaders).length > 0 || currentContentLines.length > 0) {
        addDiagnostic(
          Severity.ERROR,
          ErrorCode.E001,
          "Missing feedback (no <<< delimiter found)",
          currentStartLine,
          undefined,
          records.length,
        );
      }
      currentStartLine = lineNum + 1;
      pendingUri = null;
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
      const [source, feedback, error] = parseCompactRecord(line);
      if (error) {
        addDiagnostic(Severity.ERROR, ErrorCode.E006, error, lineNum);
        continue;
      }

      if (feedback !== null && feedback.length === 0) {
        addDiagnostic(Severity.ERROR, ErrorCode.E009, "Empty feedback (nothing after <<< )", lineNum);
      }

      const uri = pendingUri ?? currentHeaders.uri ?? null;
      const priorStr = currentHeaders.prior;
      const prior = priorStr ? new SourceRef(priorStr) : null;

      records.push(
      new MarkbackRecord({
          feedback: feedback ?? "",
          uri,
          source,
          prior,
          content: null,
          _sourceFile: sourceFile ?? null,
          _startLine: currentStartLine,
          _endLine: lineNum,
          _isCompact: true,
        }),
      );

      currentHeaders = {};
      currentContentLines = [];
      currentStartLine = lineNum + 1;
      pendingUri = null;
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

      const [keyword, value, error] = parseHeader(line);
      if (error) {
        addDiagnostic(Severity.ERROR, ErrorCode.E006, error, lineNum);
        continue;
      }

      if (keyword && !KNOWN_HEADERS.has(keyword)) {
        addDiagnostic(Severity.WARNING, WarningCode.W002, `Unknown header keyword: @${keyword}`, lineNum);
      }

      if (keyword === "uri") {
        if (value) {
          const uriError = validateUri(value);
          if (uriError) {
            addDiagnostic(Severity.ERROR, ErrorCode.E003, uriError, lineNum);
          }
          pendingUri = value;
        }
      }

      if (keyword && value) {
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

      if (currentHeaders.source && currentContentLines.length > 0) {
        const contentText = currentContentLines.join("\n").trim();
        if (contentText) {
          addDiagnostic(
            Severity.ERROR,
            ErrorCode.E005,
            "Content present when @source specified",
            currentStartLine,
            undefined,
            records.length,
          );
        }
      }

      if (currentContentLines.length > 0 && !hadBlankLine) {
        const firstContent = currentContentLines[0] ?? "";
        if (firstContent.startsWith("@")) {
          addDiagnostic(
            Severity.ERROR,
            ErrorCode.E010,
            "Missing blank line before inline content (content starts with @)",
            currentStartLine,
            undefined,
            records.length,
          );
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
    addDiagnostic(
      Severity.ERROR,
      ErrorCode.E001,
      "Missing feedback (no <<< delimiter found)",
      currentStartLine,
      undefined,
      records.length,
    );
  }

  const seenUris: { [key: string]: number } = {};
  records.forEach((record, idx) => {
    if (record.uri) {
      if (seenUris[record.uri] !== undefined) {
        addDiagnostic(
          Severity.WARNING,
          WarningCode.W001,
          `Duplicate URI: ${record.uri} (first seen in record ${seenUris[record.uri]})`,
          record._startLine ?? undefined,
          undefined,
          idx,
        );
      } else {
        seenUris[record.uri] = idx;
      }
    }
  });

  records.forEach((record, idx) => {
    if (!record.uri) {
      addDiagnostic(
        Severity.WARNING,
        WarningCode.W006,
        "Missing @uri (record has no identifier)",
        record._startLine ?? undefined,
        undefined,
        idx,
      );
    }
  });

  return new ParseResult(records, diagnostics, sourceFile ?? null);
}
