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

  const useCompact = preferCompact && record.file !== null && !record.hasInlineContent();

  if (useCompact) {
    if (record.id) {
      lines.push(`@id ${record.id}`);
    }
    if (record.by) {
      lines.push(`@by ${record.by}`);
    }
    if (record.tags.length > 0) {
      lines.push(`@tag ${record.tags.join(" ")}`);
    }
    if (record.input) {
      lines.push(`@input ${record.input}`);
    }
    lines.push(`@file ${record.file} <<< ${record.feedback}`);
  } else {
    if (record.id) {
      lines.push(`@id ${record.id}`);
    }
    if (record.by) {
      lines.push(`@by ${record.by}`);
    }
    if (record.tags.length > 0) {
      lines.push(`@tag ${record.tags.join(" ")}`);
    }
    if (record.input) {
      lines.push(`@input ${record.input}`);
    }
    if (record.file) {
      lines.push(`@file ${record.file}`);
    }

    if (record.hasInlineContent() && record.content !== null) {
      lines.push("");
      lines.push(...normalizeContentLines(record.content));
    }

    lines.push(`<<< ${record.feedback}`);
  }

  return lines.join("\n");
}

function sectionSignature(record: Record): string {
  return JSON.stringify([
    record.file ? record.file.toString() : null,
    record.by,
    record.input ? record.input.toString() : null,
    [...record.tags],
  ]);
}

function canContinueSection(prev: Record, current: Record): boolean {
  if (prev.file === null || current.file === null) return false;
  return (
    sectionSignature(prev) === sectionSignature(current)
    && prev.hasInlineContent()
    && current.hasInlineContent()
    && current.id === null
  );
}

function writeContinuation(record: Record): string {
  const lines = normalizeContentLines(record.content ?? "");
  return ["", "", ...lines, `<<< ${record.feedback}`].join("\n");
}

export function writeRecordsMulti(records: Record[], preferCompact = true): string {
  if (records.length === 0) {
    return "";
  }

  const resultParts: string[] = [];
  let prevWasCompact = false;
  let prevRecord: Record | null = null;

  records.forEach((record, index) => {
    const isCompact = preferCompact && record.file !== null && !record.hasInlineContent();

    if (index > 0 && prevRecord !== null && canContinueSection(prevRecord, record)) {
      resultParts.push(writeContinuation(record));
    } else {
      if (index > 0) {
        if (isCompact && prevWasCompact) {
          resultParts.push("\n");
        } else {
          resultParts.push("\n---\n");
        }
      }
      resultParts.push(writeRecordCanonical(record, preferCompact));
    }

    prevWasCompact = isCompact;
    prevRecord = record;
  });

  return resultParts.join("") + "\n";
}

export function writeString(
  records: Record[],
  options: {
    compact?: boolean;
    scope?: string[] | null;
    covers?: string | null;
    versionHeader?: boolean;
  } = {},
): string {
  const versionHeader = options.versionHeader ?? true;
  const scope = options.scope ?? null;
  const covers = options.covers ?? null;

  if (records.length === 0 && !scope && !covers) {
    return "";
  }

  const parts: string[] = [];

  // File-level headers
  if (versionHeader) {
    parts.push("%markback 2");
  }
  if (scope && scope.length > 0) {
    parts.push(`%scope ${scope.join(" ")}`);
  }
  if (covers) {
    parts.push(`%covers ${covers}`);
  }

  if (parts.length > 0) {
    parts.push("");
  }

  if (records.length > 0) {
    parts.push(writeRecordsMulti(records));
  }

  return parts.join("\n");
}
