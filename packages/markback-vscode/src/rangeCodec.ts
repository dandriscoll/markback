export type Position = { line: number; character: number };
export type RangeLike = { start: Position; end: Position };

export type MarkbackRangeParts = {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number | null;
};

export function vsRangeToMarkback(range: RangeLike): MarkbackRangeParts {
  const startLine = range.start.line + 1;
  const startColumn = range.start.character + 1;
  if (range.end.character === 0 && range.end.line > range.start.line) {
    return { startLine, startColumn, endLine: range.end.line, endColumn: null };
  }
  return {
    startLine,
    startColumn,
    endLine: range.end.line + 1,
    endColumn: range.end.character,
  };
}

export function markbackToVsRange(parts: MarkbackRangeParts): RangeLike {
  const start: Position = {
    line: parts.startLine - 1,
    character: parts.startColumn - 1,
  };
  let end: Position;
  if (parts.endColumn === null) {
    end = { line: parts.endLine, character: 0 };
  } else {
    end = { line: parts.endLine - 1, character: parts.endColumn };
  }
  return { start, end };
}

export function formatRangeForFileRef(parts: MarkbackRangeParts): string {
  let s = `:${parts.startLine}:${parts.startColumn}`;
  if (parts.endColumn === null) {
    s += `-${parts.endLine}`;
  } else {
    s += `-${parts.endLine}:${parts.endColumn}`;
  }
  return s;
}
