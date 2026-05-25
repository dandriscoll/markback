import * as vscode from "vscode";

import { AuthorResolver } from "./author";
import { CommentControlPlane } from "./commentControlPlane";
import { OutputLogger } from "./output";
import { SidecarRepository } from "./sidecarRepository";
import { registerCommands } from "./commandLayer";
import { buildMarkdownItPlugin } from "./markdownItPlugin";

let mdPluginLogger: OutputLogger | null = null;

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel("MarkBack");
  context.subscriptions.push(channel);
  const logger = new OutputLogger(channel);
  mdPluginLogger = logger;

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

  logger.info("MarkBack extension v0.2 activated");
}

export function deactivate(): void {
  mdPluginLogger = null;
}

// Called by the built-in markdown extension via markdown.markdownItPlugins.
// Returns the modified markdown-it instance with our preview-data plugin
// applied. We embed the current sidecar's records as a JSON <script> block
// at the top of the rendered HTML; inject.js reads them and renders 💬
// badges next to the commented lines.
export function extendMarkdownIt(md: any): any {
  md.use(buildMarkdownItPlugin(mdPluginLogger));
  return md;
}
