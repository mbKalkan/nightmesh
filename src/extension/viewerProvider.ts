import { posix } from 'node:path';
import * as vscode from 'vscode';
import { formatForPath } from '../shared/formats';
import type { HostToWebviewMessage, WebviewToHostMessage } from '../shared/protocol';
import { watchFile } from './fileWatcher';
import { fileResourceOpener } from './model/fileResources';
import { loadMessages, type ResourceOpener } from './model/load';
import { resolveResourceUri } from './model/resources';
import { fileSource, memorySource, type ByteSource } from './model/sources';
import { loadTexts, viewerStrings } from './texts';
import { buildWebviewHtml } from './webviewHtml';

export class ViewerProvider implements vscode.CustomReadonlyEditorProvider {
  static readonly viewType = 'nightmesh.viewer';

  constructor(private readonly extensionUri: vscode.Uri) {}

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new ViewerProvider(context.extensionUri);
    return vscode.window.registerCustomEditorProvider(ViewerProvider.viewType, provider, {
      // Keeps the WebGL context and camera when the tab is hidden, so switching back is instant.
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: true,
    });
  }

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => {} };
  }

  resolveCustomEditor(document: vscode.CustomDocument, panel: vscode.WebviewPanel): void {
    const { uri } = document;
    const format = formatForPath(uri.path);
    if (!format) {
      throw new Error(`Unsupported file type: ${uri.path}`);
    }

    const distWebview = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    panel.webview.options = { enableScripts: true, localResourceRoots: [distWebview] };
    panel.webview.html = buildWebviewHtml({
      cspSource: panel.webview.cspSource,
      scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(distWebview, 'main.js')).toString(),
      styleUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(distWebview, 'main.css')).toString(),
      lang: vscode.env.language,
    });

    const post = (message: HostToWebviewMessage) => panel.webview.postMessage(message);
    let loadId = 0;
    let disposed = false;
    const load = async (reload: boolean) => {
      const id = ++loadId;
      const current = () => id === loadId && !disposed;
      let source: ByteSource;
      try {
        source = await openSource(uri);
      } catch {
        // A save in progress can briefly remove the file; keep showing the last good model.
        if (current()) await post(readFailure(id, reload));
        return;
      }
      try {
        const messages = loadMessages(source, resourceOpener(uri), {
          loadId: id,
          reload,
          texts: loadTexts(vscode.l10n.t),
        });
        for await (const message of messages) {
          if (!current()) break;
          await post(message);
        }
      } catch {
        if (current()) await post(readFailure(id, reload));
      } finally {
        await source.close();
      }
    };

    const subscriptions = [
      panel.webview.onDidReceiveMessage((message: WebviewToHostMessage) => {
        if (message.type === 'ready') {
          void post({
            type: 'open',
            fileName: uri.path.slice(uri.path.lastIndexOf('/') + 1),
            format,
            strings: viewerStrings(vscode.l10n.t),
          });
          void load(false);
        } else if (message.type === 'reload') {
          void load(true);
        }
      }),
      watchFile(uri, () => void load(true)),
    ];
    panel.onDidDispose(() => {
      disposed = true;
      subscriptions.forEach((subscription) => subscription.dispose());
    });
  }
}

function readFailure(loadId: number, reload: boolean): HostToWebviewMessage {
  return {
    type: 'failed',
    loadId,
    reload,
    message: vscode.l10n.t("The file couldn't be read."),
    details: [],
  };
}

/** Local files are read in place; other schemes (Git, remote file systems) only as a whole. */
async function openSource(uri: vscode.Uri): Promise<ByteSource> {
  if (uri.scheme === 'file') return fileSource(uri.fsPath);
  return memorySource(await vscode.workspace.fs.readFile(uri));
}

/** Resources may come from the model's workspace folder, or its own folder outside one. */
function resourceOpener(uri: vscode.Uri): ResourceOpener {
  const modelFolder = posix.dirname(uri.path);
  const root = vscode.workspace.getWorkspaceFolder(uri)?.uri.path ?? modelFolder;
  if (uri.scheme === 'file') {
    return fileResourceOpener(modelFolder, root, (path) => uri.with({ path }).fsPath);
  }
  return async (reference) => {
    const resolution = resolveResourceUri(reference, modelFolder, root);
    if (resolution.kind === 'refused') return resolution.reason;
    if (resolution.kind === 'data') return memorySource(resolution.bytes);
    try {
      return memorySource(await vscode.workspace.fs.readFile(uri.with({ path: resolution.path })));
    } catch (error) {
      return error instanceof vscode.FileSystemError && error.code === 'FileNotFound'
        ? 'missing'
        : 'unreadable';
    }
  };
}
