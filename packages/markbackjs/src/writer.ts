import { Record } from "./types";

function normalizeContentLines(content: string): string[] {
  const lines = content.split("\n");
  while (lines.length > 0 && !lines[0].trim()) {
    lines.shift();
  }
  while (lines.length > 0 && !lines[lines.length - 1].trim()) {
    lines.pop();
  }
  return lines;
}

export function writeRecordCanonical(record: Record, preferCompact = true): string {
  const lines: string[] = [];

  const useCompact = preferCompact && record.source !== null && !record.hasInlineContent();

  if (useCompact) {
    if (record.uri) {
      lines.push(`@uri ${record.uri}`);
    }
    if (record.prior) {
      lines.push(`@prior ${record.prior}`);
    }
    lines.push(`@source ${record.source} <<< ${record.feedback}`);
  } else {
    if (record.uri) {
      lines.push(`@uri ${record.uri}`);
    }
    if (record.prior) {
      lines.push(`@prior ${record.prior}`);
    }
    if (record.source) {
      lines.push(`@source ${record.source}`);
    }

    if (record.hasInlineContent() && record.content !== null) {
      lines.push("");
      lines.push(...normalizeContentLines(record.content));
    }

    lines.push(`<<< ${record.feedback}`);
  }

  return lines.join("\n");
}

export function writeRecordsMulti(records: Record[], preferCompact = true): string {
  if (records.length === 0) {
    return "";
  }

  const resultParts: string[] = [];
  let prevWasCompact = false;

  records.forEach((record, index) => {
    const isCompact = preferCompact && record.source !== null && !record.hasInlineContent();

    if (index > 0) {
      if (isCompact && prevWasCompact) {
        resultParts.push("\n");
      } else {
        resultParts.push("\n---\n");
      }
    }

    resultParts.push(writeRecordCanonical(record, preferCompact));
    prevWasCompact = isCompact;
  });

  return resultParts.join("") + "\n";
}
