"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeRecordCanonical = writeRecordCanonical;
exports.writeRecordsMulti = writeRecordsMulti;
exports.writeString = writeString;
const _headers_1 = require("./_headers");
function feedbackIsMultiline(feedback) {
    return feedback.includes("\n");
}
function formatAction(a) {
    return `@action ${a.verb} ${a.timestamp}${a.actor ? ` ${a.actor}` : ""}`;
}
// Render the line(s) for one header of `record`, or [] when absent. Emission
// order across headers is driven by CANONICAL_ORDER (from the shared header
// registry); this owns only each header's own formatting.
function renderHeader(record, name, compactFile = false) {
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
            if (!record.file)
                return [];
            return compactFile ? [`@file ${record.file} <<< ${record.feedback}`] : [`@file ${record.file}`];
        default:
            return [];
    }
}
function formatFeedback(feedback) {
    if (feedbackIsMultiline(feedback)) {
        return `"""\n${feedback}\n"""`;
    }
    return feedback;
}
function normalizeContentLines(content) {
    const lines = content.split("\n");
    while (lines.length > 0 && !lines[0].trim()) {
        lines.shift();
    }
    while (lines.length > 0 && !lines[lines.length - 1].trim()) {
        lines.pop();
    }
    return lines;
}
function writeRecordCanonical(record, preferCompact = true) {
    const lines = [];
    const useCompact = preferCompact && record.file !== null && !record.hasInlineContent() && !feedbackIsMultiline(record.feedback);
    if (useCompact) {
        // Compact format: headers on own lines, then @file ... <<< (which the
        // canonical order already places last, carrying the feedback).
        for (const name of _headers_1.CANONICAL_ORDER) {
            lines.push(...renderHeader(record, name, true));
        }
    }
    else {
        // Full format: headers in canonical order, then content and feedback.
        for (const name of _headers_1.CANONICAL_ORDER) {
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
function sectionSignature(record) {
    return JSON.stringify([
        record.file ? record.file.toString() : null,
        record.by,
        record.input ? record.input.toString() : null,
        [...record.tags],
    ]);
}
function canContinueSection(prev, current) {
    if (prev.file === null || current.file === null)
        return false;
    return (sectionSignature(prev) === sectionSignature(current)
        && prev.hasInlineContent()
        && current.hasInlineContent()
        && current.id === null
        && current.replyTo === null
        // A continuation segment writes no headers, so a record carrying actions
        // must use the full layout or its action log would be silently dropped.
        && !current.hasActions());
}
function writeContinuation(record) {
    var _a;
    const lines = normalizeContentLines((_a = record.content) !== null && _a !== void 0 ? _a : "");
    return ["", "", ...lines, `<<< ${formatFeedback(record.feedback)}`].join("\n");
}
function writeRecordsMulti(records, preferCompact = true) {
    if (records.length === 0) {
        return "";
    }
    const resultParts = [];
    let prevWasCompact = false;
    let prevRecord = null;
    records.forEach((record, index) => {
        const isCompact = preferCompact && record.file !== null && !record.hasInlineContent();
        if (index > 0 && prevRecord !== null && canContinueSection(prevRecord, record)) {
            resultParts.push(writeContinuation(record));
        }
        else {
            if (index > 0) {
                if (isCompact && prevWasCompact) {
                    resultParts.push("\n");
                }
                else {
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
function writeString(records, options = {}) {
    var _a, _b, _c;
    const versionHeader = (_a = options.versionHeader) !== null && _a !== void 0 ? _a : true;
    const scope = (_b = options.scope) !== null && _b !== void 0 ? _b : null;
    const covers = (_c = options.covers) !== null && _c !== void 0 ? _c : null;
    if (records.length === 0 && !scope && !covers) {
        return "";
    }
    const parts = [];
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
//# sourceMappingURL=writer.js.map