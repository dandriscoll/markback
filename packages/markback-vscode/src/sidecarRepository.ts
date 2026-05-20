import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  parseString,
  writeString,
  Record,
  FileRef,
  Diagnostic,
  Severity,
} from "markbackjs";

import { generateRecordId } from "./ids";
import {
  vsRangeToMarkback,
  formatRangeForFileRef,
  type RangeLike,
} from "./rangeCodec";
import { relativeFromSidecar } from "./sidecarPath";

export type LoadResult = {
  records: Record[];
  diagnostics: Diagnostic[];
  hasErrors: boolean;
};

export type AddResult = {
  record: Record;
};

type CachedSidecar = {
  records: Record[];
  scope: string[] | null;
  covers: string | null;
  hasParseErrors: boolean;
};

export interface RepositoryLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

const noopLogger: RepositoryLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

export class SidecarRepository {
  private cache = new Map<string, CachedSidecar>();
  private mutexes = new Map<string, Promise<unknown>>();
  private logger: RepositoryLogger;

  constructor(logger: RepositoryLogger = noopLogger) {
    this.logger = logger;
  }

  private async withMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.mutexes.get(key) ?? Promise.resolve();
    const next = prior.catch(() => undefined).then(fn);
    this.mutexes.set(key, next);
    try {
      return (await next) as T;
    } finally {
      if (this.mutexes.get(key) === next) {
        this.mutexes.delete(key);
      }
    }
  }

  async load(sidecarPath: string): Promise<LoadResult> {
    let text: string;
    try {
      text = await fs.readFile(sidecarPath, "utf-8");
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        const empty: CachedSidecar = {
          records: [],
          scope: null,
          covers: null,
          hasParseErrors: false,
        };
        this.cache.set(sidecarPath, empty);
        return { records: [], diagnostics: [], hasErrors: false };
      }
      this.logger.error(`[repo] failed to read ${sidecarPath}: ${(err as Error).message}`);
      throw err;
    }

    const result = parseString(text, sidecarPath);
    const hasErrors = result.hasErrors;

    if (hasErrors) {
      this.logger.warn(
        `[repo] parse errors in ${sidecarPath} — ${result.errorCount} error(s); ` +
          `commenting blocked until fixed.`,
      );
    }
    for (const d of result.diagnostics) {
      const line = `[repo] ${d.toString()}`;
      if (d.severity === Severity.ERROR) {
        this.logger.error(line);
      } else {
        this.logger.warn(line);
      }
    }

    const cached: CachedSidecar = {
      records: hasErrors ? [] : result.records,
      scope: result.scope,
      covers: result.covers,
      hasParseErrors: hasErrors,
    };
    this.cache.set(sidecarPath, cached);

    return {
      records: cached.records,
      diagnostics: result.diagnostics,
      hasErrors,
    };
  }

  invalidate(sidecarPath: string): void {
    this.cache.delete(sidecarPath);
  }

  hasParseErrors(sidecarPath: string): boolean {
    return this.cache.get(sidecarPath)?.hasParseErrors ?? false;
  }

  recordById(sidecarPath: string, id: string): Record | null {
    const cached = this.cache.get(sidecarPath);
    if (!cached) return null;
    return cached.records.find((r) => r.id === id) ?? null;
  }

  async addRecord(args: {
    sidecarPath: string;
    sourceAbsPath: string;
    range: RangeLike;
    feedback: string;
    by: string | null;
  }): Promise<AddResult> {
    return this.withMutex(args.sidecarPath, async () => {
      const cached = await this.ensureLoaded(args.sidecarPath);
      if (cached.hasParseErrors) {
        throw new Error(
          `Sidecar ${args.sidecarPath} has parse errors; fix the file before adding comments.`,
        );
      }

      const parts = vsRangeToMarkback(args.range);
      const relSource = relativeFromSidecar(args.sourceAbsPath, args.sidecarPath);
      const fileRefValue = relSource + formatRangeForFileRef(parts);
      const record = new Record({
        feedback: args.feedback,
        id: generateRecordId(),
        by: args.by,
        file: new FileRef(fileRefValue),
      });

      const nextRecords = [...cached.records, record];
      await this.writeNow(args.sidecarPath, { ...cached, records: nextRecords });
      cached.records = nextRecords;
      return { record };
    });
  }

  async addReply(args: {
    sidecarPath: string;
    parentId: string;
    feedback: string;
    by: string | null;
  }): Promise<AddResult> {
    return this.withMutex(args.sidecarPath, async () => {
      const cached = await this.ensureLoaded(args.sidecarPath);
      if (cached.hasParseErrors) {
        throw new Error(
          `Sidecar ${args.sidecarPath} has parse errors; fix the file before adding comments.`,
        );
      }

      const record = new Record({
        feedback: args.feedback,
        id: generateRecordId(),
        replyTo: args.parentId,
        by: args.by,
      });

      const nextRecords = [...cached.records, record];
      await this.writeNow(args.sidecarPath, { ...cached, records: nextRecords });
      cached.records = nextRecords;
      return { record };
    });
  }

  private async ensureLoaded(sidecarPath: string): Promise<CachedSidecar> {
    if (!this.cache.has(sidecarPath)) {
      await this.load(sidecarPath);
    }
    return this.cache.get(sidecarPath)!;
  }

  private async writeNow(sidecarPath: string, cached: CachedSidecar): Promise<void> {
    const text = writeString(cached.records, {
      versionHeader: true,
      scope: cached.scope,
      covers: cached.covers,
    });
    const dir = path.dirname(sidecarPath);
    const tmpPath = path.join(
      dir,
      `.${path.basename(sidecarPath)}.${process.pid}.${Date.now()}.tmp`,
    );
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(tmpPath, text, "utf-8");
      await fs.rename(tmpPath, sidecarPath);
      this.logger.info(`[repo] wrote ${sidecarPath} (${cached.records.length} records)`);
    } catch (err: unknown) {
      try {
        await fs.unlink(tmpPath);
      } catch {
        // ignore — temp file may not exist
      }
      throw err;
    }
  }
}

