import {
  Record,
  FileRef,
  parseString,
  writeRecordCanonical,
} from "markbackjs";

export interface ExcerptOptions {
  /** When false, never embed inline content (always range-only). */
  enabled: boolean;
  /** Maximum normalized line count for an embeddable excerpt. */
  maxLines: number;
  /** Maximum character length for an embeddable excerpt. */
  maxChars: number;
}

export const DEFAULT_EXCERPT_OPTIONS: ExcerptOptions = {
  enabled: true,
  maxLines: 10,
  maxChars: 600,
};

/** Why a candidate excerpt was not embedded — surfaced to the output channel. */
export type ExcerptOmission =
  | "disabled"
  | "empty"
  | "too-large"
  | "unsafe-roundtrip";

export type ExcerptDecision =
  | { content: string; omitted: null }
  | { content: null; omitted: ExcerptOmission };

// Mirror of the writer's content normalization (trim leading/trailing blank
// lines) so the manageability bounds and the round-trip probe operate on exactly
// the text the writer will emit. Splits on \r?\n so a CRLF selection is measured
// by logical lines, not bytes.
function normalizeContent(text: string): string {
  const lines = text.split(/\r?\n/);
  while (lines.length > 0 && lines[0].trim() === "") {
    lines.shift();
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }
  return lines.join("\n");
}

// Markback content has no escape mechanism: a content line the parser
// reclassifies (a bare `---` separator, a leading-`<<<` feedback line, a
// `@file … <<<` compact line) would split, error, or drop the record. Rather than
// enumerate parser rules, prove safety empirically — write the candidate through
// the real writer and read it back through the real parser. (Global insight: feed
// the renderer's output through the consumer at least once.)
//
// Returns the round-trip-STABLE content to embed — the fixpoint a write→read cycle
// yields — or null if the candidate would structurally corrupt the .mb. Returning
// the reparsed fixpoint (not the raw candidate) absorbs the parser's benign
// per-line whitespace normalization (an interior blank line that carried spaces
// re-reads as empty), so such excerpts are embedded in canonical form instead of
// being rejected — while a content line that changes the RECORD STRUCTURE (count,
// errors) is still refused.
function roundTripStable(candidate: string): string | null {
  const probe = () =>
    new Record({ feedback: "x", id: "probe", file: new FileRef("./probe") });

  const first = parseString(
    writeRecordCanonical(
      Object.assign(probe(), { content: candidate }),
      /* preferCompact */ true,
    ),
  );
  if (first.hasErrors || first.records.length !== 1) return null;
  const stable = first.records[0].content;
  if (stable === null || stable.trim().length === 0) return null;

  // Confirm the fixpoint: the stored form must itself re-parse unchanged, so the
  // sidecar stays stable across any future canonicalization.
  const second = parseString(
    writeRecordCanonical(
      Object.assign(probe(), { content: stable }),
      /* preferCompact */ true,
    ),
  );
  if (
    second.hasErrors ||
    second.records.length !== 1 ||
    second.records[0].content !== stable
  ) {
    return null;
  }
  return stable;
}

/**
 * Decide whether a selected source span is "manageable" enough to embed as inline
 * content (an excerpt) under `@file`. Returns the exact normalized text to embed,
 * or the reason it was omitted (caller falls back to a range-only record).
 *
 * Pure — no vscode, no I/O — so it is unit-testable in the `node --test` lane.
 */
export function decideExcerpt(
  selectedText: string,
  opts: ExcerptOptions = DEFAULT_EXCERPT_OPTIONS,
): ExcerptDecision {
  if (!opts.enabled) {
    return { content: null, omitted: "disabled" };
  }

  const normalized = normalizeContent(selectedText);
  if (normalized.length === 0) {
    return { content: null, omitted: "empty" };
  }

  const lineCount = normalized.split("\n").length;
  if (lineCount > opts.maxLines || normalized.length > opts.maxChars) {
    return { content: null, omitted: "too-large" };
  }

  const stable = roundTripStable(normalized);
  if (stable === null) {
    return { content: null, omitted: "unsafe-roundtrip" };
  }

  return { content: stable, omitted: null };
}

/** Convenience: the embeddable content, or null. */
export function manageableExcerpt(
  selectedText: string,
  opts: ExcerptOptions = DEFAULT_EXCERPT_OPTIONS,
): string | null {
  return decideExcerpt(selectedText, opts).content;
}
