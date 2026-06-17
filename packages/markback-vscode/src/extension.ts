import * as vscode from "vscode";

import { AuthorResolver } from "./author";
import { CommentControlPlane } from "./commentControlPlane";
import { OutputLogger } from "./output";
import { SidecarRepository } from "./sidecarRepository";
import { registerCommands } from "./commandLayer";
import { buildMarkdownItPlugin } from "./markdownItPlugin";

let mdPluginLogger: OutputLogger | null = null;

export type MarkbackTestApi = {
  hasDraftForSource(sourceUri: vscode.Uri): boolean;
  getDraftRangeForSource(sourceUri: vscode.Uri): vscode.Range | null;
  wasFocusHandoffSkipped(sourceUri: vscode.Uri): boolean | null;
  persistedThreadCountForSource(sourceUri: vscode.Uri): number;
  firstCommentForSource(sourceUri: vscode.Uri): vscode.Comment | null;
  hasEditInProgress(): boolean;
};

export function activate(
  context: vscode.ExtensionContext,
): { _testApi: MarkbackTestApi } {
  const channel = vscode.window.createOutputChannel("Markback");
  context.subscriptions.push(channel);
  const logger = new OutputLogger(channel);
  mdPluginLogger = logger;

  // New sidecars follow the editor's files.eol setting; "auto" (or unset)
  // resolves to the OS-native ending. Existing sidecars keep their own EOL.
  const repo = new SidecarRepository(logger, () => {
    const cfg = vscode.workspace.getConfiguration("files").get<string>("eol");
    return cfg === "\r\n" || cfg === "\n" ? cfg : process.platform === "win32" ? "\r\n" : "\n";
  });
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

  logger.info("Markback extension v0.2 activated");

  return {
    _testApi: {
      hasDraftForSource: (uri) => plane.hasDraftForSource(uri),
      getDraftRangeForSource: (uri) => plane.getDraftRangeForSource(uri),
      wasFocusHandoffSkipped: (uri) => plane.wasFocusHandoffSkipped(uri),
      persistedThreadCountForSource: (uri) => plane.persistedThreadCountForSource(uri),
      firstCommentForSource: (uri) => plane.firstCommentForSource(uri),
      hasEditInProgress: () => plane.hasEditInProgress(),
    },
  };
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
