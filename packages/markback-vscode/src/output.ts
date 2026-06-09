import * as vscode from "vscode";

import { RepositoryLogger } from "./sidecarRepository";

export class OutputLogger implements RepositoryLogger {
  constructor(private channel: vscode.OutputChannel) {}

  info(msg: string): void {
    this.write("INFO", msg);
  }

  warn(msg: string): void {
    this.write("WARN", msg);
  }

  error(msg: string): void {
    this.write("ERROR", msg);
  }

  private write(level: string, msg: string): void {
    const ts = new Date().toISOString();
    this.channel.appendLine(`[${ts}] ${level} ${msg}`);
  }

  reveal(): void {
    this.channel.show(true);
  }
}
