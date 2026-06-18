"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ParseResult = exports.Record = exports.SourceRef = exports.FileRef = exports.Diagnostic = exports.WarningCode = exports.ErrorCode = exports.Severity = void 0;
exports.parseFeedback = parseFeedback;
const path_1 = __importDefault(require("path"));
const url_1 = require("url");
var Severity;
(function (Severity) {
    Severity["ERROR"] = "error";
    Severity["WARNING"] = "warning";
})(Severity || (exports.Severity = Severity = {}));
var ErrorCode;
(function (ErrorCode) {
    ErrorCode["E001"] = "E001";
    ErrorCode["E002"] = "E002";
    ErrorCode["E003"] = "E003";
    ErrorCode["E004"] = "E004";
    ErrorCode["E005"] = "E005";
    ErrorCode["E006"] = "E006";
    ErrorCode["E007"] = "E007";
    ErrorCode["E008"] = "E008";
    ErrorCode["E009"] = "E009";
    ErrorCode["E010"] = "E010";
    ErrorCode["E011"] = "E011";
    ErrorCode["E012"] = "E012";
})(ErrorCode || (exports.ErrorCode = ErrorCode = {}));
var WarningCode;
(function (WarningCode) {
    WarningCode["W001"] = "W001";
    WarningCode["W002"] = "W002";
    WarningCode["W003"] = "W003";
    WarningCode["W004"] = "W004";
    WarningCode["W005"] = "W005";
    WarningCode["W006"] = "W006";
    WarningCode["W007"] = "W007";
    WarningCode["W008"] = "W008";
    WarningCode["W009"] = "W009";
    WarningCode["W010"] = "W010";
    WarningCode["W011"] = "W011";
    WarningCode["W012"] = "W012";
})(WarningCode || (exports.WarningCode = WarningCode = {}));
class Diagnostic {
    constructor(init) {
        var _a, _b, _c, _d;
        this.file = (_a = init.file) !== null && _a !== void 0 ? _a : null;
        this.line = (_b = init.line) !== null && _b !== void 0 ? _b : null;
        this.column = (_c = init.column) !== null && _c !== void 0 ? _c : null;
        this.severity = init.severity;
        this.code = init.code;
        this.message = init.message;
        this.recordIndex = (_d = init.recordIndex) !== null && _d !== void 0 ? _d : null;
    }
    get isError() {
        return this.severity === Severity.ERROR;
    }
    toString() {
        const parts = [];
        if (this.file) {
            parts.push(this.file);
        }
        if (this.line !== null && this.line !== undefined) {
            parts.push(String(this.line));
            if (this.column !== null && this.column !== undefined) {
                parts.push(String(this.column));
            }
        }
        const location = parts.length ? parts.join(":") : "<unknown>";
        return `${location}: ${this.code} ${this.message}`;
    }
    toDict() {
        return {
            file: this.file,
            line: this.line,
            column: this.column,
            severity: this.severity,
            code: this.code,
            message: this.message,
            record_index: this.recordIndex,
        };
    }
}
exports.Diagnostic = Diagnostic;
function extractScheme(value) {
    const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(value);
    return match ? match[1] : null;
}
// Regex to parse line/character range from a path
const LINE_RANGE_PATTERN = /^(.+?):(\d+)(?::(\d+))?(?:-(\d+)(?::(\d+))?)?$/;
class FileRef {
    constructor(value, isUri = false) {
        this.value = value;
        this.startLine = null;
        this.endLine = null;
        this.startColumn = null;
        this.endColumn = null;
        this._pathOnly = value;
        this._parseLineRange();
        if (isUri) {
            this.isUri = true;
            return;
        }
        const scheme = extractScheme(this._pathOnly);
        this.isUri = !!scheme && scheme.length > 1;
    }
    _parseLineRange() {
        const match = LINE_RANGE_PATTERN.exec(this.value);
        if (match) {
            this._pathOnly = match[1];
            this.startLine = parseInt(match[2], 10);
            if (match[3]) {
                this.startColumn = parseInt(match[3], 10);
            }
            if (match[4]) {
                this.endLine = parseInt(match[4], 10);
                if (match[5]) {
                    this.endColumn = parseInt(match[5], 10);
                }
            }
            else {
                this.endLine = this.startLine;
                this.endColumn = this.startColumn;
            }
        }
    }
    get path() {
        return this._pathOnly;
    }
    get lineRangeStr() {
        if (this.startLine === null) {
            return null;
        }
        let start;
        if (this.startColumn !== null) {
            start = `:${this.startLine}:${this.startColumn}`;
        }
        else {
            start = `:${this.startLine}`;
        }
        if (this.startLine === this.endLine && this.startColumn === this.endColumn) {
            return start;
        }
        let end;
        if (this.endColumn !== null) {
            end = `-${this.endLine}:${this.endColumn}`;
        }
        else {
            end = `-${this.endLine}`;
        }
        return `${start}${end}`;
    }
    resolve(basePath) {
        if (this.isUri) {
            const scheme = extractScheme(this._pathOnly);
            if (scheme && scheme.toLowerCase() === "file") {
                return (0, url_1.fileURLToPath)(new url_1.URL(this._pathOnly));
            }
            throw new Error(`Cannot resolve non-file URI to path: ${this.value}`);
        }
        if (path_1.default.isAbsolute(this._pathOnly)) {
            return this._pathOnly;
        }
        if (basePath) {
            return path_1.default.join(basePath, this._pathOnly);
        }
        return this._pathOnly;
    }
    toString() {
        return this.value;
    }
}
exports.FileRef = FileRef;
// V1 backward compatibility alias
exports.SourceRef = FileRef;
class Record {
    constructor(init) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
        this.feedback = init.feedback;
        this.id = (_a = init.id) !== null && _a !== void 0 ? _a : null;
        this.replyTo = (_b = init.replyTo) !== null && _b !== void 0 ? _b : null;
        this.by = (_c = init.by) !== null && _c !== void 0 ? _c : null;
        this.file = (_d = init.file) !== null && _d !== void 0 ? _d : null;
        this.input = (_e = init.input) !== null && _e !== void 0 ? _e : null;
        this.tags = (_f = init.tags) !== null && _f !== void 0 ? _f : [];
        this.actions = (_g = init.actions) !== null && _g !== void 0 ? _g : [];
        this.content = (_h = init.content) !== null && _h !== void 0 ? _h : null;
        this.metadata = (_j = init.metadata) !== null && _j !== void 0 ? _j : {};
        this._sourceFile = (_k = init._sourceFile) !== null && _k !== void 0 ? _k : null;
        this._startLine = (_l = init._startLine) !== null && _l !== void 0 ? _l : null;
        this._endLine = (_m = init._endLine) !== null && _m !== void 0 ? _m : null;
    }
    // V1 compat getters
    get uri() { return this.id; }
    get source() { return this.file; }
    get prior() { return this.input; }
    getIdentifier() {
        if (this.id) {
            return this.id;
        }
        if (this.file) {
            return this.file.toString();
        }
        return null;
    }
    hasInlineContent() {
        return this.content !== null && this.content.trim().length > 0;
    }
    hasActions() {
        return this.actions.length > 0;
    }
    toDict() {
        return {
            id: this.id,
            reply_to: this.replyTo,
            by: this.by,
            file: this.file ? this.file.toString() : null,
            input: this.input ? this.input.toString() : null,
            tags: this.tags,
            actions: this.actions.map((a) => ({ verb: a.verb, timestamp: a.timestamp, actor: a.actor })),
            content: this.content,
            feedback: this.feedback,
            metadata: this.metadata,
        };
    }
}
exports.Record = Record;
class ParseResult {
    constructor(records, diagnostics, sourceFile, scope, covers, version) {
        this.records = records;
        this.diagnostics = diagnostics;
        this.sourceFile = sourceFile !== null && sourceFile !== void 0 ? sourceFile : null;
        this.scope = scope !== null && scope !== void 0 ? scope : null;
        this.covers = covers !== null && covers !== void 0 ? covers : null;
        this.version = version !== null && version !== void 0 ? version : null;
    }
    get hasErrors() {
        return this.diagnostics.some((d) => d.severity === Severity.ERROR);
    }
    get hasWarnings() {
        return this.diagnostics.some((d) => d.severity === Severity.WARNING);
    }
    get errorCount() {
        return this.diagnostics.filter((d) => d.severity === Severity.ERROR).length;
    }
    get warningCount() {
        return this.diagnostics.filter((d) => d.severity === Severity.WARNING).length;
    }
}
exports.ParseResult = ParseResult;
function parseFeedback(feedback) {
    const result = {
        raw: feedback,
        label: null,
        attributes: {},
        comment: null,
        isJson: false,
        jsonData: null,
    };
    if (feedback.startsWith("json:")) {
        result.isJson = true;
        try {
            result.jsonData = JSON.parse(feedback.slice(5));
        }
        catch (_err) {
            // Ignore invalid JSON; leave as raw.
        }
        return result;
    }
    const segments = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < feedback.length; i += 1) {
        const char = feedback[i];
        if (char === '"' && (i === 0 || feedback[i - 1] !== "\\")) {
            inQuotes = !inQuotes;
            current += char;
            continue;
        }
        if (char === ";" && !inQuotes && feedback[i + 1] === " ") {
            segments.push(current);
            current = "";
            i += 1;
            continue;
        }
        current += char;
    }
    if (current) {
        segments.push(current);
    }
    for (const segmentRaw of segments) {
        const segment = segmentRaw.trim();
        if (!segment) {
            continue;
        }
        if (segment.includes("=")) {
            const eqPos = segment.indexOf("=");
            const key = segment.slice(0, eqPos);
            let value = segment.slice(eqPos + 1);
            if (value.startsWith('"') && value.endsWith('"')) {
                value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
            }
            result.attributes[key] = value;
        }
        else if (!result.label) {
            result.label = segment;
        }
        else if (result.comment) {
            result.comment = `${result.comment}; ${segment}`;
        }
        else {
            result.comment = segment;
        }
    }
    return result;
}
//# sourceMappingURL=types.js.map