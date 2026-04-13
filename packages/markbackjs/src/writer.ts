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

function emitExcerpt(excerpt: string): string[] {
  if (excerpt.includes("\n")) {
    return ['@excerpt """', ...excerpt.split("\n"), '"""'];
  }
  return [`@excerpt ${excerpt}`];
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
    if (record.excerpt !== null) {
      lines.push(...emitExcerpt(record.excerpt));
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
    if (record.excerpt !== null) {
      lines.push(...emitExcerpt(record.excerpt));
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

export function writeRecordsMulti(records: Record[], preferCompact = true): string {
  if (records.length === 0) {
    return "";
  }

  const resultParts: string[] = [];
  let prevWasCompact = false;

  records.forEach((record, index) => {
    const isCompact = preferCompact && record.file !== null && !record.hasInlineContent();

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
