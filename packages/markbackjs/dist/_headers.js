"use strict";
// DO NOT EDIT — generated from shared/headers.json by scripts/gen_headers.py.
Object.defineProperty(exports, "__esModule", { value: true });
exports.V1_HEADER_MAP = exports.SECTION_INHERITED = exports.CANONICAL_ORDER = exports.KNOWN_HEADERS = void 0;
// Header keywords the parser recognizes (others emit W002).
exports.KNOWN_HEADERS = new Set(["id", "by", "file", "input", "tag", "reply-to", "action"]);
// The order headers are emitted in canonical output (SPEC §7.1).
exports.CANONICAL_ORDER = ["id", "reply-to", "by", "action", "tag", "input", "file"];
// Headers inherited by continuation segments of a multi-segment section
// (@id, @reply-to, and @action are per-record and never inherited).
exports.SECTION_INHERITED = new Set(["file", "by", "tag", "input"]);
// V1 header names mapped to their V2 equivalents (each emits W010).
exports.V1_HEADER_MAP = { uri: "id", source: "file", prior: "input" };
//# sourceMappingURL=_headers.js.map