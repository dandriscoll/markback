// DO NOT EDIT — generated from shared/headers.json by scripts/gen_headers.py.

// Header keywords the parser recognizes (others emit W002).
export const KNOWN_HEADERS = new Set<string>(["id", "by", "file", "input", "tag", "reply-to", "action"]);

// The order headers are emitted in canonical output (SPEC §7.1).
export const CANONICAL_ORDER: string[] = ["id", "reply-to", "by", "action", "tag", "input", "file"];

// Headers inherited by continuation segments of a multi-segment section
// (@id, @reply-to, and @action are per-record and never inherited).
export const SECTION_INHERITED = new Set<string>(["file", "by", "tag", "input"]);

// V1 header names mapped to their V2 equivalents (each emits W010).
export const V1_HEADER_MAP: { [key: string]: string } = { uri: "id", source: "file", prior: "input" };
