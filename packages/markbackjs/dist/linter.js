"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.lintString = lintString;
exports.lintFile = lintFile;
exports.lintFiles = lintFiles;
exports.formatDiagnostics = formatDiagnostics;
exports.summarizeResults = summarizeResults;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const types_1 = require("./types");
const parser_1 = require("./parser");
const writer_1 = require("./writer");
function lintFeedbackJson(feedback, file, line, recordIdx) {
    const diagnostics = [];
    if (feedback.startsWith("json:")) {
        const jsonStr = feedback.slice(5);
        try {
            JSON.parse(jsonStr);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            diagnostics.push(new types_1.Diagnostic({
                file: file !== null && file !== void 0 ? file : null,
                line: line !== null && line !== void 0 ? line : null,
                column: null,
                severity: types_1.Severity.ERROR,
                code: types_1.ErrorCode.E007,
                message: `Invalid JSON after json: prefix: ${message}`,
                recordIndex: recordIdx !== null && recordIdx !== void 0 ? recordIdx : null,
            }));
        }
    }
    return diagnostics;
}
function lintFeedbackStructured(feedback, file, line, recordIdx) {
    const diagnostics = [];
    let inQuote = false;
    let escaped = false;
    for (const char of feedback) {
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === "\\") {
            escaped = true;
            continue;
        }
        if (char === '"') {
            inQuote = !inQuote;
        }
    }
    if (inQuote) {
        diagnostics.push(new types_1.Diagnostic({
            file: file !== null && file !== void 0 ? file : null,
            line: line !== null && line !== void 0 ? line : null,
            column: null,
            severity: types_1.Severity.ERROR,
            code: types_1.ErrorCode.E008,
            message: "Unclosed quote in structured attribute value",
            recordIndex: recordIdx !== null && recordIdx !== void 0 ? recordIdx : null,
        }));
    }
    return diagnostics;
}
function lintFileExists(record, basePath, recordIdx) {
    var _a, _b;
    const diagnostics = [];
    if (record.file && !record.file.isUri) {
        try {
            const resolved = record.file.resolve(basePath);
            if (!fs_1.default.existsSync(resolved)) {
                diagnostics.push(new types_1.Diagnostic({
                    file: (_a = record._sourceFile) !== null && _a !== void 0 ? _a : null,
                    line: (_b = record._startLine) !== null && _b !== void 0 ? _b : null,
                    column: null,
                    severity: types_1.Severity.WARNING,
                    code: types_1.WarningCode.W003,
                    message: `@file not found: ${record.file}`,
                    recordIndex: recordIdx,
                }));
            }
        }
        catch (_err) {
            // Ignore URIs that cannot be resolved to paths.
        }
    }
    return diagnostics;
}
function lintInputExists(record, basePath, recordIdx) {
    var _a, _b;
    const diagnostics = [];
    if (record.input && !record.input.isUri) {
        try {
            const resolved = record.input.resolve(basePath);
            if (!fs_1.default.existsSync(resolved)) {
                diagnostics.push(new types_1.Diagnostic({
                    file: (_a = record._sourceFile) !== null && _a !== void 0 ? _a : null,
                    line: (_b = record._startLine) !== null && _b !== void 0 ? _b : null,
                    column: null,
                    severity: types_1.Severity.WARNING,
                    code: types_1.WarningCode.W009,
                    message: `@input not found: ${record.input}`,
                    recordIndex: recordIdx,
                }));
            }
        }
        catch (_err) {
            // Ignore URIs that cannot be resolved to paths.
        }
    }
    return diagnostics;
}
function isPositionInvalid(ref) {
    if (ref.startLine === null || ref.endLine === null) {
        return { isInvalid: false, errorMsg: "" };
    }
    if (ref.endLine < ref.startLine) {
        return { isInvalid: true, errorMsg: `end line ${ref.endLine} is less than start line ${ref.startLine}` };
    }
    if (ref.endLine === ref.startLine) {
        if (ref.startColumn !== null && ref.endColumn !== null && ref.endColumn < ref.startColumn) {
            return { isInvalid: true, errorMsg: `end column ${ref.endColumn} is less than start column ${ref.startColumn} on line ${ref.startLine}` };
        }
    }
    return { isInvalid: false, errorMsg: "" };
}
function lintLineRange(record, recordIdx) {
    var _a, _b, _c, _d;
    const diagnostics = [];
    if (record.file && record.file.startLine !== null) {
        const { isInvalid, errorMsg } = isPositionInvalid(record.file);
        if (isInvalid) {
            diagnostics.push(new types_1.Diagnostic({
                file: (_a = record._sourceFile) !== null && _a !== void 0 ? _a : null,
                line: (_b = record._startLine) !== null && _b !== void 0 ? _b : null,
                column: null,
                severity: types_1.Severity.ERROR,
                code: types_1.ErrorCode.E011,
                message: `Invalid range in @file: ${errorMsg}`,
                recordIndex: recordIdx,
            }));
        }
    }
    if (record.input && record.input.startLine !== null) {
        const { isInvalid, errorMsg } = isPositionInvalid(record.input);
        if (isInvalid) {
            diagnostics.push(new types_1.Diagnostic({
                file: (_c = record._sourceFile) !== null && _c !== void 0 ? _c : null,
                line: (_d = record._startLine) !== null && _d !== void 0 ? _d : null,
                column: null,
                severity: types_1.Severity.ERROR,
                code: types_1.ErrorCode.E011,
                message: `Invalid range in @input: ${errorMsg}`,
                recordIndex: recordIdx,
            }));
        }
    }
    return diagnostics;
}
function lintReplyTo(records, sourceFile) {
    const diagnostics = [];
    const idToIdx = {};
    records.forEach((record, idx) => {
        if (record.id && idToIdx[record.id] === undefined) {
            idToIdx[record.id] = idx;
        }
    });
    records.forEach((record, idx) => {
        var _a, _b;
        if (!record.replyTo) {
            return;
        }
        if (idToIdx[record.replyTo] === undefined) {
            diagnostics.push(new types_1.Diagnostic({
                file: sourceFile !== null && sourceFile !== void 0 ? sourceFile : null,
                line: (_a = record._startLine) !== null && _a !== void 0 ? _a : null,
                column: null,
                severity: types_1.Severity.WARNING,
                code: types_1.WarningCode.W011,
                message: `@reply-to points at unknown id: ${record.replyTo}`,
                recordIndex: idx,
            }));
            return;
        }
        // Walk up the chain to detect cycles.
        const seen = new Set([idx]);
        let cursor = idToIdx[record.replyTo];
        while (true) {
            if (seen.has(cursor)) {
                diagnostics.push(new types_1.Diagnostic({
                    file: sourceFile !== null && sourceFile !== void 0 ? sourceFile : null,
                    line: (_b = record._startLine) !== null && _b !== void 0 ? _b : null,
                    column: null,
                    severity: types_1.Severity.WARNING,
                    code: types_1.WarningCode.W011,
                    message: `@reply-to forms a cycle through: ${record.replyTo}`,
                    recordIndex: idx,
                }));
                break;
            }
            seen.add(cursor);
            const parent = records[cursor].replyTo;
            if (!parent || idToIdx[parent] === undefined) {
                break;
            }
            cursor = idToIdx[parent];
        }
    });
    return diagnostics;
}
function lintCanonicalFormat(records, originalText, file, scope, covers, version) {
    const diagnostics = [];
    // The comparison render must carry the file's own %-headers, otherwise any
    // canonical file with %markback/%scope/%covers mismatches and reports a
    // false W008. The record body is written exactly as before; the file-level
    // headers are prepended when the file declared them.
    const body = records.length === 1 ? `${(0, writer_1.writeRecordCanonical)(records[0])}\n` : (0, writer_1.writeRecordsMulti)(records);
    const headerLines = [];
    if (version !== null && version !== undefined) {
        headerLines.push("%markback 2");
    }
    if (scope && scope.length > 0) {
        headerLines.push(`%scope ${scope.join(" ")}`);
    }
    if (covers) {
        headerLines.push(`%covers ${covers}`);
    }
    const canonical = headerLines.length > 0 ? `${headerLines.join("\n")}\n\n${body}` : body;
    const originalNormalized = originalText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (originalNormalized !== canonical) {
        diagnostics.push(new types_1.Diagnostic({
            file: file !== null && file !== void 0 ? file : null,
            line: 1,
            column: null,
            severity: types_1.Severity.WARNING,
            code: types_1.WarningCode.W008,
            message: "Non-canonical formatting detected",
        }));
    }
    return diagnostics;
}
class InvalidUtf8Error extends Error {
    constructor(message) {
        super(message);
        this.code = "ERR_INVALID_UTF8";
    }
}
function readUtf8FileSync(filePath) {
    const data = fs_1.default.readFileSync(filePath);
    const decoder = new TextDecoder("utf-8", { fatal: true });
    try {
        return decoder.decode(data);
    }
    catch (_err) {
        throw new InvalidUtf8Error("File is not valid UTF-8");
    }
}
function lintString(text, options = {}) {
    var _a, _b, _c;
    const sourceFile = (_a = options.sourceFile) !== null && _a !== void 0 ? _a : null;
    const checkSources = (_b = options.checkSources) !== null && _b !== void 0 ? _b : true;
    const checkCanonical = (_c = options.checkCanonical) !== null && _c !== void 0 ? _c : true;
    const result = (0, parser_1.parseString)(text, sourceFile);
    result.records.forEach((record, idx) => {
        result.diagnostics.push(...lintFeedbackJson(record.feedback, sourceFile, record._endLine, idx));
        if (!record.feedback.startsWith("json:")) {
            result.diagnostics.push(...lintFeedbackStructured(record.feedback, sourceFile, record._endLine, idx));
        }
        if (checkSources) {
            const basePath = sourceFile ? path_1.default.dirname(sourceFile) : null;
            result.diagnostics.push(...lintFileExists(record, basePath, idx));
            result.diagnostics.push(...lintInputExists(record, basePath, idx));
        }
        result.diagnostics.push(...lintLineRange(record, idx));
    });
    result.diagnostics.push(...lintReplyTo(result.records, sourceFile));
    if (checkCanonical && result.records.length > 0 && !result.hasErrors) {
        result.diagnostics.push(...lintCanonicalFormat(result.records, text, sourceFile, result.scope, result.covers, result.version));
    }
    return result;
}
function lintFile(filePath, options = {}) {
    try {
        const text = readUtf8FileSync(filePath);
        return lintString(text, { ...options, sourceFile: filePath });
    }
    catch (err) {
        if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
            return new types_1.ParseResult([], [new types_1.Diagnostic({ file: filePath, line: null, column: null, severity: types_1.Severity.ERROR, code: types_1.ErrorCode.E006, message: "File not found" })], filePath);
        }
        if (err && typeof err === "object" && "code" in err && err.code === "ERR_INVALID_UTF8") {
            return new types_1.ParseResult([], [new types_1.Diagnostic({ file: filePath, line: null, column: null, severity: types_1.Severity.ERROR, code: types_1.ErrorCode.E006, message: "File is not valid UTF-8" })], filePath);
        }
        throw err;
    }
}
function walkFiles(dir) {
    const entries = fs_1.default.readdirSync(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const fullPath = path_1.default.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...walkFiles(fullPath));
        }
        else if (entry.isFile()) {
            files.push(fullPath);
        }
    }
    return files;
}
function lintFiles(paths, options = {}) {
    const results = [];
    for (const inputPath of paths) {
        let stats = null;
        try {
            stats = fs_1.default.statSync(inputPath);
        }
        catch (_err) {
            results.push(lintFile(inputPath, options));
            continue;
        }
        if (stats.isDirectory()) {
            const files = walkFiles(inputPath).sort();
            for (const file of files) {
                if (file.endsWith(".mb")) {
                    results.push(lintFile(file, options));
                }
            }
        }
        else {
            results.push(lintFile(inputPath, options));
        }
    }
    return results;
}
function formatDiagnostics(diagnostics, format = "human") {
    if (format === "json") {
        return JSON.stringify(diagnostics.map((d) => d.toDict()), null, 2);
    }
    return diagnostics.map((d) => d.toString()).join("\n");
}
function summarizeResults(results) {
    const totalRecords = results.reduce((sum, result) => sum + result.records.length, 0);
    const totalErrors = results.reduce((sum, result) => sum + result.errorCount, 0);
    const totalWarnings = results.reduce((sum, result) => sum + result.warningCount, 0);
    const filesWithErrors = results.filter((result) => result.hasErrors).length;
    const filesWithWarnings = results.filter((result) => result.hasWarnings).length;
    return {
        files: results.length,
        records: totalRecords,
        errors: totalErrors,
        warnings: totalWarnings,
        files_with_errors: filesWithErrors,
        files_with_warnings: filesWithWarnings,
    };
}
//# sourceMappingURL=linter.js.map