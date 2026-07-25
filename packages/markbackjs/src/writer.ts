import { CANONICAL_ORDER } from "./_headers";
import { Action, Record } from "./types";

function feedbackIsMultiline(feedback: string): boolean {
  return feedback.includes("\n");
}

function formatAction(a: Action): string {
  return `@action ${a.verb} ${a.timestamp}${a.actor ? ` ${a.actor}` : ""}`;
}

// Render the line(s) for one header of `record`, or [] when absent. Emission
// order across headers is driven by CANONICAL_ORDER (from the shared header
// registry); this owns only each header's own formatting.
function renderHeader(record: Record, name: string, compactFile = false): string[] {
  switch (name) {
    case "id":
      return record.id ? [`@id ${record.id}`] : [];
    case "reply-to":
      return record.replyTo ? [`@reply-to ${record.replyTo}`] : [];
    case "by":
      return record.by ? [`@by ${record.by}`] : [];
    case "action":
      return record.actions.map(formatAction);
    case "tag":
      return record.tags.length > 0 ? [`@tag ${record.tags.join(" ")}`] : [];
    case "input":
      return record.input ? [`@input ${record.input}`] : [];
    case "file":
      if (!record.file) return [];
      return compactFile ? [`@file ${record.file} <<< ${record.feedback}`] : [`@file ${record.file}`];
    default:
      return [];
  }
}

function formatFeedback(feedback: string): string {
  if (feedbackIsMultiline(feedback)) {
    return `"""\n${feedback}\n"""`;
  }
  return feedback;
}

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

  const useCompact = preferCompact && record.file !== null && !record.hasInlineContent() && !feedbackIsMultiline(record.feedback);

  if (useCompact) {
    // Compact format: headers on own lines, then @file ... <<< (which the
    // canonical order already places last, carrying the feedback).
    for (const name of CANONICAL_ORDER) {
      lines.push(...renderHeader(record, name, true));
    }
  } else {
    // Full format: headers in canonical order, then content and feedback.
    for (const name of CANONICAL_ORDER) {
      lines.push(...renderHeader(record, name));
    }

    if (record.hasInlineContent() && record.content !== null) {
      lines.push("");
      lines.push(...normalizeContentLines(record.content));
    }

    lines.push(`<<< ${formatFeedback(record.feedback)}`);
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
    && current.replyTo === null
    // A continuation segment writes no headers, so a record carrying actions
    // must use the full layout or its action log would be silently dropped.
    && !current.hasActions()
  );
}

function writeContinuation(record: Record): string {
  const lines = normalizeContentLines(record.content ?? "");
  return ["", "", ...lines, `<<< ${formatFeedback(record.feedback)}`].join("\n");
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
