import * as vscode from "vscode";

import { AuthorResolver } from "./author";
import { CommentControlPlane } from "./commentControlPlane";
import { OutputLogger } from "./output";
import { SidecarRepository } from "./sidecarRepository";
import { registerCommands } from "./commandLayer";

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel("MarkBack");
  context.subscriptions.push(channel);
  const logger = new OutputLogger(channel);

  const repo = new SidecarRepository(logger);
  const author = new AuthorResolver(logger);
  const plane = new CommentControlPlane(repo, logger);
  plane.registerSubscriptions(context);

  registerCommands(context, { plane, repo, author, logger });

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("markback.author")) {
        author.invalidate();
        logger.info("markback.author setting changed; cached author reset");
      }
    }),
  );

  logger.info("MarkBack extension v0.1 activated");
}

export function deactivate(): void {
  // VS Code disposes subscriptions automatically.
}
