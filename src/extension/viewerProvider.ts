import * as vscode from 'vscode';
import { formatForPath } from '../shared/formats';
import type { HostToWebviewMessage, WebviewToHostMessage } from '../shared/protocol';
import { viewerStrings } from './strings';
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
    const subscription = panel.webview.onDidReceiveMessage((message: WebviewToHostMessage) => {
      if (message.type === 'ready') {
        void post({
          type: 'load',
          fileName: uri.path.slice(uri.path.lastIndexOf('/') + 1),
          format,
          strings: viewerStrings(),
        });
      }
    });
    panel.onDidDispose(() => subscription.dispose());
  }
}
