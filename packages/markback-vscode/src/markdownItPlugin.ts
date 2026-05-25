import * as fs from "node:fs";
import * as path from "node:path";
import { parseString, Record } from "markbackjs";

import { sidecarPathFor } from "./sidecarPath";
import { OutputLogger } from "./output";

type PreviewRecord = {
  id: string;
  startLine: number;
  endLine: number;
  body: string;
  author: string | null;
  replyTo: string | null;
};

type PreviewPayload = {
  records: PreviewRecord[];
};

export function buildMarkdownItPlugin(logger: OutputLogger | null) {
  return function markbackPlugin(md: any) {
    md.core.ruler.push("markback_embed_records", (state: any) => {
      const sourceUri = resolveSourceFromEnv(state.env);
      if (!sourceUri) return false;
      const payload = loadPayload(sourceUri, logger);
      const script = renderScriptTag(payload);
      const token = new state.Token("html_block", "", 0);
      token.content = script;
      state.tokens.unshift(token);
      return true;
    });
  };
}

function resolveSourceFromEnv(env: unknown): string | null {
  if (!env || typeof env !== "object") return null;
  const e = env as { [k: string]: unknown };
  // VS Code's markdown extension passes various env shapes across
  // versions. Try the most common.
  const fromCurrentDoc = e.currentDocument as { fsPath?: string } | undefined;
  if (fromCurrentDoc && typeof fromCurrentDoc.fsPath === "string") {
    return fromCurrentDoc.fsPath;
  }
  const docPath = e.docPath ?? e.documentPath;
  if (typeof docPath === "string") return docPath;
  return null;
}

function loadPayload(sourceFsPath: string, logger: OutputLogger | null): PreviewPayload {
  const sidecarPath = sidecarPathFor(sourceFsPath);
  let text: string;
  try {
    text = fs.readFileSync(sidecarPath, "utf-8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { records: [] };
    }
    logger?.warn(`[md-plugin] could not read ${sidecarPath}: ${(err as Error).message}`);
    return { records: [] };
  }
  const parsed = parseString(text, sidecarPath);
  const sidecarDir = path.dirname(sidecarPath);
  const records: PreviewRecord[] = [];
  for (const r of parsed.records) {
    const preview = projectRecord(r, sourceFsPath, sidecarDir);
    if (preview) records.push(preview);
  }
  return { records };
}

function projectRecord(r: Record, sourceFsPath: string, sidecarDir: string): PreviewRecord | null {
  if (!r.id) return null;
  if (r.replyTo) {
    // Reply records have no anchor of their own; consumer (inject.js)
    // walks the chain to find the parent.
    return {
      id: r.id,
      startLine: -1,
      endLine: -1,
      body: r.feedback,
      author: r.by,
      replyTo: r.replyTo,
    };
  }
  if (!r.file || r.file.startLine === null) return null;
  let resolved: string;
  try {
    resolved = r.file.resolve(sidecarDir);
  } catch {
    return null;
  }
  if (path.resolve(resolved) !== path.resolve(sourceFsPath)) return null;
  return {
    id: r.id,
    startLine: r.file.startLine - 1,
    endLine: (r.file.endLine ?? r.file.startLine) - 1,
    body: r.feedback,
    author: r.by,
    replyTo: null,
  };
}

function renderScriptTag(payload: PreviewPayload): string {
  // Defensive against `</script>` substrings inside record bodies.
  const json = JSON.stringify(payload).replace(/<\/(script)/gi, "<\\/$1");
  return `<script id="markback-preview-data" type="application/json">${json}</script>\n`;
}

