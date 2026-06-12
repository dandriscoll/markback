import { Record } from "./types";
export declare function writeRecordCanonical(record: Record, preferCompact?: boolean): string;
export declare function writeRecordsMulti(records: Record[], preferCompact?: boolean): string;
export declare function writeString(records: Record[], options?: {
    compact?: boolean;
    scope?: string[] | null;
    covers?: string | null;
    versionHeader?: boolean;
}): string;
//# sourceMappingURL=writer.d.ts.map