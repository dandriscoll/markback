"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseString = parseString;
const types_1 = require("./types");
const KNOWN_HEADERS = new Set(["id", "by", "file", "input", "tag", "reply-to", "action"]);
const V1_HEADER_MAP = { uri: "id", source: "file", prior: "input" };
const HEADER_PATTERN = /^@([a-z][a-z-]*)\s+(.+)$/;
const FEEDBACK_DELIMITER = "<<<";
const FENCE_MARKER = '"""';
const RECORD_SEPARATOR = "---";
const COMPACT_PATTERN = /^@file\s+(.+?)\s+<<<\s+(.*)$/;
const V1_COMPACT_PATTERN = /^@source\s+(.+?)\s+<<<\s+(.*)$/;
const FILE_HEADER_PATTERN = /^%([a-z]+)\s*(.*)$/;
var LineType;
(function (LineType) {
    LineType["COMPACT_RECORD"] = "compact_record";
    LineType["HEADER"] = "header";
    LineType["FEEDBACK"] = "feedback";
    LineType["SEPARATOR"] = "separator";
    LineType["BLANK"] = "blank";
    LineType["CONTENT"] = "content";
    LineType["FILE_HEADER"] = "file_header";
})(LineType || (LineType = {}));
function stripLine(line) {
    return line.replace(/\s+$/, "");
}
function classifyLine(line) {
    const stripped = stripLine(line);
    if (!stripped) {
        return LineType.BLANK;
    }
    if (stripped === RECORD_SEPARATOR) {
        return LineType.SEPARATOR;
    }
    if (stripped.startsWith("%")) {
        return LineType.FILE_HEADER;
    }
    if (stripped.includes(FEEDBACK_DELIMITER)) {
        if (stripped.startsWith("@file") || stripped.startsWith("@source")) {
            return LineType.COMPACT_RECORD;
        }
    }
    if (stripped.startsWith("@")) {
        return LineType.HEADER;
    }
    if (stripped.startsWith(FEEDBACK_DELIMITER)) {
        return LineType.FEEDBACK;
    }
    return LineType.CONTENT;
}
function parseHeader(line) {
    const stripped = stripLine(line);
    const match = HEADER_PATTERN.exec(stripped);
    if (!match) {
        return [null, null, `Malformed header syntax: ${stripped}`];
    }
    return [match[1], match[2], null];
}
// Parse an @action header value: "<verb> <timestamp> [actor]". The actor is
// everything after the timestamp (may contain spaces), preserved verbatim.
// Returns [action, null] or [null, errorMessage] when fewer than two tokens.
function parseActionValue(value) {
    const trimmed = value.trim();
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) {
        return [null, `Malformed @action (expected: <verb> <timestamp> [actor]): ${trimmed}`];
    }
    const verb = parts[0];
    const timestamp = parts[1];
    const afterVerb = trimmed.slice(verb.length).trimStart();
    const actorRaw = afterVerb.slice(timestamp.length).trimStart();
    return [{ verb, timestamp, actor: actorRaw.length > 0 ? actorRaw : null }, null];
}
function parseCompactRecord(line) {
    const stripped = stripLine(line);
    // Try V2 format first
    let match = COMPACT_PATTERN.exec(stripped);
    if (match) {
        return [new types_1.FileRef(match[1]), match[2], null, false];
    }
    // Try V1 format
    match = V1_COMPACT_PATTERN.exec(stripped);
    if (match) {
        return [new types_1.FileRef(match[1]), match[2], null, true];
    }
    return [null, null, `Invalid compact record syntax: ${line}`, false];
}
function readFenceBody(lines, startIdx) {
    const body = [];
    let i = startIdx;
    while (i < lines.length) {
        if (stripLine(lines[i]) === FENCE_MARKER) {
            return [body.join("\n"), i + 1, true];
        }
        body.push(lines[i]);
        i += 1;
    }
    return [body.join("\n"), i, false];
}
function parseString(text, sourceFile) {
    var _a, _b, _c, _d, _e, _f, _g;
    // Normalize line endings first so CRLF and CR inputs parse identically to LF
    // (no stray carriage returns leak into content or trip whitespace checks).
    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    let lines = text.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") {
        lines = lines.slice(0, -1);
    }
    const records = [];
    const diagnostics = [];
    let fileVersion = null;
    let fileScope = null;
    let fileCovers = null;
    const addDiagnostic = (severity, code, message, lineNum, col, recordIdx) => {
        diagnostics.push(new types_1.Diagnostic({
            file: sourceFile !== null && sourceFile !== void 0 ? sourceFile : null,
            line: lineNum !== null && lineNum !== void 0 ? lineNum : null,
            column: col !== null && col !== void 0 ? col : null,
            severity,
            code,
            message,
            recordIndex: recordIdx !== null && recordIdx !== void 0 ? recordIdx : null,
        }));
    };
    // sectionHeaders carries forward across <<< boundaries within a section.
    // A `---` separator clears them. @id is per-record and never inherited.
    const SECTION_INHERITED = new Set(["file", "by", "tag", "input"]);
    let sectionHeaders = {};
    let currentHeaders = {};
    // Actions are per-record and order-preserving — NOT section-inherited and NOT
    // merged like tags. Reset whenever currentHeaders is reset.
    let currentActions = [];
    let currentContentLines = [];
    let currentStartLine = 1;
    let pendingId = null;
    let inContent = false;
    let hadBlankLine = false;
    let pastFileHeaders = false;
    const finalizeRecord = (feedback, endLine) => {
        var _a, _b, _c, _d, _e, _f, _g;
        // Section-inherited headers (@file, @by, @tag, @input) fall back to the
        // section value only when this segment did not declare its own. @id and
        // @reply-to are per-record and never inherited.
        const id = (_a = currentHeaders.id) !== null && _a !== void 0 ? _a : pendingId;
        const by = (_c = (_b = currentHeaders.by) !== null && _b !== void 0 ? _b : sectionHeaders.by) !== null && _c !== void 0 ? _c : null;
        const replyTo = (_d = currentHeaders["reply-to"]) !== null && _d !== void 0 ? _d : null;
        const fileStr = (_e = currentHeaders.file) !== null && _e !== void 0 ? _e : sectionHeaders.file;
        const fileRef = fileStr ? new types_1.FileRef(fileStr) : null;
        const inputStr = (_f = currentHeaders.input) !== null && _f !== void 0 ? _f : sectionHeaders.input;
        const inputRef = inputStr ? new types_1.FileRef(inputStr) : null;
        const tagStr = (_g = currentHeaders.tag) !== null && _g !== void 0 ? _g : sectionHeaders.tag;
        const tags = tagStr ? tagStr.split(/\s+/) : [];
        let content = null;
        if (currentContentLines.length > 0) {
            const contentLines = [...currentContentLines];
            while (contentLines.length > 0 && !contentLines[0].trim()) {
                contentLines.shift();
            }
            while (contentLines.length > 0 && !contentLines[contentLines.length - 1].trim()) {
                contentLines.pop();
            }
            content = contentLines.length > 0 ? contentLines.join("\n") : null;
        }
        records.push(new types_1.Record({
            feedback,
            id: id !== null && id !== void 0 ? id : null,
            replyTo,
            by,
            file: fileRef,
            input: inputRef,
            tags,
            actions: currentActions,
            content,
            _sourceFile: sourceFile !== null && sourceFile !== void 0 ? sourceFile : null,
            _startLine: currentStartLine,
            _endLine: endLine,
        }));
        if (Object.keys(sectionHeaders).length === 0) {
            const inherited = {};
            for (const [k, v] of Object.entries(currentHeaders)) {
                if (SECTION_INHERITED.has(k)) {
                    inherited[k] = v;
                }
            }
            sectionHeaders = inherited;
        }
        // Reset for the next segment. currentHeaders holds only what the NEXT
        // segment declares itself; inherited values live in sectionHeaders and are
        // merged in at finalize. Starting empty (rather than a copy of
        // sectionHeaders) is what lets a blank line between records read as a record
        // separator, and a re-declared @tag override rather than merge.
        currentHeaders = {};
        currentActions = [];
        currentContentLines = [];
        currentStartLine = endLine + 1;
        pendingId = null;
        inContent = false;
        hadBlankLine = false;
    };
    let lineNum = 0;
    while (lineNum < lines.length) {
        const line = lines[lineNum];
        lineNum += 1;
        const lineType = classifyLine(line);
        if (line !== line.replace(/\s+$/, "")) {
            addDiagnostic(types_1.Severity.WARNING, types_1.WarningCode.W004, "Trailing whitespace", lineNum);
        }
        // File-level headers
        if (lineType === LineType.FILE_HEADER) {
            if (pastFileHeaders) {
                inContent = true;
                currentContentLines.push(line);
                continue;
            }
            const stripped = stripLine(line);
            const match = FILE_HEADER_PATTERN.exec(stripped);
            if (match) {
                const keyword = match[1];
                const value = match[2].trim();
                if (keyword === "markback") {
                    const v = parseInt(value, 10);
                    if (!isNaN(v)) {
                        fileVersion = v;
                    }
                }
                else if (keyword === "scope") {
                    fileScope = value ? value.split(/\s+/) : [];
                }
                else if (keyword === "covers") {
                    fileCovers = value || null;
                }
            }
            continue;
        }
        if (lineType !== LineType.BLANK) {
            pastFileHeaders = true;
        }
        if (lineType === LineType.SEPARATOR) {
            if (currentContentLines.length > 0 || Object.keys(currentHeaders).length > 0) {
                addDiagnostic(types_1.Severity.ERROR, types_1.ErrorCode.E001, "Missing feedback (no <<< delimiter found)", currentStartLine, undefined, records.length);
            }
            sectionHeaders = {};
            currentHeaders = {};
            currentActions = [];
            currentStartLine = lineNum + 1;
            pendingId = null;
            inContent = false;
            hadBlankLine = false;
            continue;
        }
        if (lineType === LineType.BLANK) {
            if (inContent) {
                currentContentLines.push("");
            }
            else if (Object.keys(currentHeaders).length > 0) {
                // A blank AFTER this segment's own headers is the header/content
                // separator (§3.2.1). A blank when the segment has declared no headers
                // of its own is a between-records separator and is ignored (§3.5) — so
                // the next @-lines are read as the following record's headers, not as
                // content.
                hadBlankLine = true;
            }
            continue;
        }
        if (lineType === LineType.COMPACT_RECORD) {
            const [fileRef, feedback, error, isV1] = parseCompactRecord(line);
            if (error) {
                addDiagnostic(types_1.Severity.ERROR, types_1.ErrorCode.E006, error, lineNum);
                continue;
            }
            if (isV1) {
                addDiagnostic(types_1.Severity.WARNING, types_1.WarningCode.W010, "V1 format detected: @source mapped to @file", lineNum);
            }
            let endLine = lineNum;
            let actualFeedback = feedback;
            if (actualFeedback === FENCE_MARKER) {
                const [fenceBody, newLineNum, closed] = readFenceBody(lines, lineNum);
                if (!closed) {
                    addDiagnostic(types_1.Severity.ERROR, types_1.ErrorCode.E012, 'Unclosed fenced feedback block (missing """)', lineNum);
                }
                if (!fenceBody) {
                    addDiagnostic(types_1.Severity.ERROR, types_1.ErrorCode.E009, "Empty feedback (empty fenced block)", lineNum);
                }
                actualFeedback = fenceBody;
                endLine = newLineNum;
                lineNum = newLineNum;
            }
            else if (actualFeedback !== null && actualFeedback.length === 0) {
                addDiagnostic(types_1.Severity.ERROR, types_1.ErrorCode.E009, "Empty feedback (nothing after <<< )", lineNum);
            }
            const id = (_a = pendingId !== null && pendingId !== void 0 ? pendingId : currentHeaders.id) !== null && _a !== void 0 ? _a : null;
            const replyTo = (_b = currentHeaders["reply-to"]) !== null && _b !== void 0 ? _b : null;
            const by = (_d = (_c = currentHeaders.by) !== null && _c !== void 0 ? _c : sectionHeaders.by) !== null && _d !== void 0 ? _d : null;
            const inputStr = (_e = currentHeaders.input) !== null && _e !== void 0 ? _e : sectionHeaders.input;
            const inputRef = inputStr ? new types_1.FileRef(inputStr) : null;
            const tagStr = (_f = currentHeaders.tag) !== null && _f !== void 0 ? _f : sectionHeaders.tag;
            const tags = tagStr ? tagStr.split(/\s+/) : [];
            records.push(new types_1.Record({
                feedback: actualFeedback !== null && actualFeedback !== void 0 ? actualFeedback : "",
                id,
                replyTo,
                by,
                file: fileRef,
                input: inputRef,
                tags,
                actions: currentActions,
                content: null,
                _sourceFile: sourceFile !== null && sourceFile !== void 0 ? sourceFile : null,
                _startLine: currentStartLine,
                _endLine: endLine,
            }));
            // Compact records also seed a section so subsequent records inherit @file.
            if (Object.keys(sectionHeaders).length === 0) {
                const inherited = {};
                for (const [k, v] of Object.entries(currentHeaders)) {
                    if (SECTION_INHERITED.has(k)) {
                        inherited[k] = v;
                    }
                }
                if (fileRef) {
                    inherited.file = fileRef.toString();
                }
                sectionHeaders = inherited;
            }
            currentHeaders = {};
            currentActions = [];
            currentContentLines = [];
            currentStartLine = lineNum + 1;
            pendingId = null;
            inContent = false;
            hadBlankLine = false;
            continue;
        }
        if (lineType === LineType.HEADER) {
            if (hadBlankLine || inContent) {
                inContent = true;
                currentContentLines.push(line);
                continue;
            }
            let [keyword, value, error] = parseHeader(line);
            if (error) {
                addDiagnostic(types_1.Severity.ERROR, types_1.ErrorCode.E006, error, lineNum);
                continue;
            }
            // V1 backward compat
            if (keyword && keyword in V1_HEADER_MAP) {
                const newKeyword = V1_HEADER_MAP[keyword];
                addDiagnostic(types_1.Severity.WARNING, types_1.WarningCode.W010, `V1 format detected: @${keyword} mapped to @${newKeyword}`, lineNum);
                keyword = newKeyword;
            }
            if (keyword && !KNOWN_HEADERS.has(keyword)) {
                addDiagnostic(types_1.Severity.WARNING, types_1.WarningCode.W002, `Unknown header keyword: @${keyword}`, lineNum);
            }
            if (keyword === "id" && value) {
                pendingId = value;
            }
            // Actions accumulate into an ordered, per-record list (not the single-value
            // header map, not merged like tags, not section-inherited).
            if (keyword === "action") {
                const [action, actionErr] = parseActionValue(value !== null && value !== void 0 ? value : "");
                if (actionErr) {
                    addDiagnostic(types_1.Severity.WARNING, types_1.WarningCode.W012, actionErr, lineNum);
                }
                else if (action) {
                    currentActions.push(action);
                }
                continue;
            }
            // Merge tags
            if (keyword === "tag" && currentHeaders.tag && value) {
                currentHeaders.tag = currentHeaders.tag + " " + value;
            }
            else if (keyword && value) {
                currentHeaders[keyword] = value;
            }
            continue;
        }
        if (lineType === LineType.FEEDBACK) {
            const stripped = stripLine(line);
            let feedback = "";
            let fenceEndLine = lineNum;
            if (stripped === FEEDBACK_DELIMITER) {
                addDiagnostic(types_1.Severity.ERROR, types_1.ErrorCode.E009, "Empty feedback (nothing after <<< )", lineNum);
            }
            else if (stripped === `${FEEDBACK_DELIMITER} ${FENCE_MARKER}`) {
                const [fenceBody, newLineNum, closed] = readFenceBody(lines, lineNum);
                if (!closed) {
                    addDiagnostic(types_1.Severity.ERROR, types_1.ErrorCode.E012, 'Unclosed fenced feedback block (missing """)', lineNum);
                }
                if (!fenceBody) {
                    addDiagnostic(types_1.Severity.ERROR, types_1.ErrorCode.E009, "Empty feedback (empty fenced block)", lineNum);
                }
                feedback = fenceBody;
                fenceEndLine = newLineNum;
                lineNum = newLineNum;
            }
            else if (stripped.startsWith(`${FEEDBACK_DELIMITER} `)) {
                feedback = stripped.slice(FEEDBACK_DELIMITER.length + 1);
            }
            else {
                feedback = stripped.slice(FEEDBACK_DELIMITER.length).trimStart();
            }
            if (currentContentLines.length > 0 && !hadBlankLine) {
                const firstContent = (_g = currentContentLines[0]) !== null && _g !== void 0 ? _g : "";
                if (firstContent.startsWith("@")) {
                    addDiagnostic(types_1.Severity.ERROR, types_1.ErrorCode.E010, "Missing blank line before inline content (content starts with @)", currentStartLine, undefined, records.length);
                }
            }
            finalizeRecord(feedback, fenceEndLine);
            continue;
        }
        if (lineType === LineType.CONTENT) {
            inContent = true;
            currentContentLines.push(line);
        }
    }
    if (currentContentLines.length > 0 || Object.keys(currentHeaders).length > 0) {
        addDiagnostic(types_1.Severity.ERROR, types_1.ErrorCode.E001, "Missing feedback (no <<< delimiter found)", currentStartLine, undefined, records.length);
    }
    // Check for duplicate IDs
    const seenIds = {};
    records.forEach((record, idx) => {
        var _a;
        if (record.id) {
            if (seenIds[record.id] !== undefined) {
                addDiagnostic(types_1.Severity.WARNING, types_1.WarningCode.W001, `Duplicate ID: ${record.id} (first seen in record ${seenIds[record.id]})`, (_a = record._startLine) !== null && _a !== void 0 ? _a : undefined, undefined, idx);
            }
            else {
                seenIds[record.id] = idx;
            }
        }
    });
    // Check for missing IDs
    records.forEach((record, idx) => {
        var _a;
        if (!record.id) {
            addDiagnostic(types_1.Severity.WARNING, types_1.WarningCode.W006, "Missing @id (record has no identifier)", (_a = record._startLine) !== null && _a !== void 0 ? _a : undefined, undefined, idx);
        }
    });
    return new types_1.ParseResult(records, diagnostics, sourceFile !== null && sourceFile !== void 0 ? sourceFile : null, fileScope, fileCovers, fileVersion);
}
//# sourceMappingURL=parser.js.map