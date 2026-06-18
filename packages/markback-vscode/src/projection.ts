import * as path from "node:path";
import { Record } from "markbackjs";

import { markbackToVsRange, type RangeLike } from "./rangeCodec";
import { isResolved } from "./actionState";

export type ThreadDescriptor = {
  parentRecordId: string;
  range: RangeLike;
  comments: CommentDescriptor[];
  staleReason: string | null;
  // Resolution state derived from the parent record's action log (#11).
  resolved: boolean;
};

export type CommentDescriptor = {
  recordId: string;
  body: string;
  author: string | null;
};

export type ProjectionWarning =
  | { kind: "missingParent"; replyId: string; replyTo: string }
  | { kind: "rangeOutOfBounds"; recordId: string; recordLine: number; sourceLineCount: number };

export type ProjectionResult = {
  threads: ThreadDescriptor[];
  warnings: ProjectionWarning[];
};

function recordAnchorsTo(
  record: Record,
  sourceAbsPath: string,
  sidecarAbsPath: string,
): boolean {
  if (!record.file) return false;
  if (record.file.startLine === null) return false;
  let resolved: string;
  try {
    resolved = record.file.resolve(path.dirname(sidecarAbsPath));
  } catch {
    return false;
  }
  return path.resolve(resolved) === path.resolve(sourceAbsPath);
}

export function projectRecordsToThreads(args: {
  records: Record[];
  sourceAbsPath: string;
  sidecarAbsPath: string;
  sourceLineCount?: number;
}): ProjectionResult {
  const warnings: ProjectionWarning[] = [];

  const parents: Record[] = [];
  const parentById = new Map<string, Record>();
  const replies: Record[] = [];

  for (const r of args.records) {
    if (recordAnchorsTo(r, args.sourceAbsPath, args.sidecarAbsPath)) {
      parents.push(r);
      if (r.id) parentById.set(r.id, r);
    } else if (r.replyTo) {
      replies.push(r);
    }
  }

  const repliesByParent = new Map<string, Record[]>();
  for (const reply of replies) {
    let cursorId = reply.replyTo;
    let rootParentId: string | null = null;
    const visited = new Set<string>();
    while (cursorId && !visited.has(cursorId)) {
      visited.add(cursorId);
      if (parentById.has(cursorId)) {
        rootParentId = cursorId;
        break;
      }
      const nextRecord = args.records.find((r) => r.id === cursorId);
      if (!nextRecord || !nextRecord.replyTo) {
        break;
      }
      cursorId = nextRecord.replyTo;
    }

    if (rootParentId === null) {
      if (reply.id) {
        warnings.push({
          kind: "missingParent",
          replyId: reply.id,
          replyTo: reply.replyTo ?? "",
        });
      }
      continue;
    }
    const list = repliesByParent.get(rootParentId) ?? [];
    list.push(reply);
    repliesByParent.set(rootParentId, list);
  }

  const threads: ThreadDescriptor[] = [];

  for (const parent of parents) {
    if (!parent.id) continue;
    const fileRef = parent.file!;
    const startLine = fileRef.startLine!;
    const endLine = fileRef.endLine ?? startLine;
    const endColumn = fileRef.endColumn;
    const startColumn = fileRef.startColumn ?? 1;

    if (args.sourceLineCount !== undefined && startLine > args.sourceLineCount) {
      warnings.push({
        kind: "rangeOutOfBounds",
        recordId: parent.id,
        recordLine: startLine,
        sourceLineCount: args.sourceLineCount,
      });
    }

    const range = markbackToVsRange({
      startLine,
      startColumn,
      endLine,
      endColumn,
    });

    const comments: CommentDescriptor[] = [
      {
        recordId: parent.id,
        body: parent.feedback,
        author: parent.by,
      },
    ];
    for (const reply of repliesByParent.get(parent.id) ?? []) {
      if (!reply.id) continue;
      comments.push({
        recordId: reply.id,
        body: reply.feedback,
        author: reply.by,
      });
    }

    threads.push({
      parentRecordId: parent.id,
      range,
      comments,
      staleReason: null,
      resolved: isResolved(parent.actions),
    });
  }

  return { threads, warnings };
}
