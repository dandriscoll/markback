import { spawn } from "node:child_process";
import * as vscode from "vscode";

import { OutputLogger } from "./output";

type ResolvedAuthor = {
  value: string | null;
  source: "settings" | "git" | "none";
};

export class AuthorResolver {
  private cached: ResolvedAuthor | null = null;

  constructor(private logger: OutputLogger) {}

  async resolve(): Promise<string | null> {
    if (this.cached) return this.cached.value;

    const settingValue = vscode.workspace
      .getConfiguration("markback")
      .get<string>("author", "");
    if (settingValue && settingValue.trim().length > 0) {
      this.cached = { value: settingValue.trim(), source: "settings" };
      this.logger.info(`[author] resolved from markback.author setting: ${this.cached.value}`);
      return this.cached.value;
    }

    const gitValue = await this.runGitConfig();
    if (gitValue && gitValue.length > 0) {
      this.cached = { value: gitValue, source: "git" };
      this.logger.info(`[author] resolved from git config user.email: ${gitValue}`);
      return gitValue;
    }

    this.cached = { value: null, source: "none" };
    this.logger.warn(
      "[author] unresolved — no markback.author setting and `git config user.email` returned empty; @by will be omitted",
    );
    return null;
  }

  invalidate(): void {
    this.cached = null;
  }

  private runGitConfig(): Promise<string | null> {
    return new Promise((resolve) => {
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const proc = spawn("git", ["config", "user.email"], { cwd });
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      proc.on("error", (err) => {
        this.logger.warn(`[author] git spawn failed: ${err.message}`);
        resolve(null);
      });
      proc.on("close", (code) => {
        if (code === 0) {
          resolve(stdout.trim() || null);
        } else {
          this.logger.warn(
            `[author] git config user.email exited ${code}` +
              (stderr.trim() ? `: ${stderr.trim()}` : ""),
          );
          resolve(null);
        }
      });
    });
  }
}
