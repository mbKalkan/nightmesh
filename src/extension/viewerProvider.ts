import { join, posix } from 'node:path';
import * as vscode from 'vscode';
import { formatForPath } from '../shared/formats';
import type { HostToWebviewMessage, Preferences, WebviewToHostMessage } from '../shared/protocol';
import { composeReference } from '../shared/reference';
import { watchFile } from './fileWatcher';
import { gitSibling, readGitBlob } from './gitBlob';
import { lfsObjectId } from './gitObject';
import { sniff } from './model/container';
import { fileResourceOpener } from './model/fileResources';
import { loadMessages, type ResourceOpener } from './model/load';
import { resolveResourceUri } from './model/resources';
import { fileSource, memorySource, type ByteSource } from './model/sources';
import { validationMessage } from './model/validation';
import { loadTexts, viewerStrings } from './texts';
import { buildWebviewHtml } from './webviewHtml';
import { workerValidator } from './workerValidator';

const PREFERENCES = 'nightmesh.preferences';

export class ViewerProvider implements vscode.CustomReadonlyEditorProvider {
  static readonly viewType = 'nightmesh.viewer';

  /** The viewer in front, which commands act on. */
  private active: vscode.WebviewPanel | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    /** Where the viewers' preferences are kept, for every window and session. */
    private readonly globalState: vscode.Memento,
  ) {}

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new ViewerProvider(context.extensionUri, context.globalState);
    return vscode.Disposable.from(
      vscode.window.registerCustomEditorProvider(ViewerProvider.viewType, provider, {
        // Keeps the WebGL context and camera when the tab is hidden, so switching back is instant.
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: true,
      }),
      vscode.commands.registerCommand('nightmesh.copyReference', (menu?: unknown) =>
        provider.copyReference(false, menu),
      ),
      vscode.commands.registerCommand('nightmesh.copyReferenceWithDetails', (menu?: unknown) =>
        provider.copyReference(true, menu),
      ),
    );
  }

  /**
   * Asks the viewer in front for a reference. VS Code hands commands run from the webview's
   * context menu what the menu was opened on; the viewer has remembered what was under the
   * pointer. From the Command Palette, the reference is to the selection.
   */
  private copyReference(details: boolean, menu: unknown): void {
    const atPointer = typeof menu === 'object' && menu !== null && 'webview' in menu;
    void this.active?.webview.postMessage({
      type: 'copyReference',
      details,
      atPointer,
    } satisfies HostToWebviewMessage);
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
    /** Once the user drew a large model here, its next loads don't ask again. */
    let largeApproved = false;
    /** Lets a load waiting for the user's word on a large model go on. */
    let drawRequest: (() => void) | undefined;
    const validator = workerValidator(join(this.extensionUri.fsPath, 'dist', 'validator.js'));
    const load = async (reload: boolean) => {
      const id = ++loadId;
      // A load still waiting gives way to this one: it ends, and closes its file.
      drawRequest?.();
      validator.stop();
      const current = () => id === loadId && !disposed;
      let structured = false;
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
          largeBytes: largeApproved ? Infinity : undefined,
        });
        for await (const message of messages) {
          if (!current()) break;
          await post(message);
          if (message.type === 'structure') structured = true;
          if (message.type === 'large') {
            await new Promise<void>((resolve) => (drawRequest = resolve));
            drawRequest = undefined;
            if (!current()) break;
          }
        }
      } catch {
        if (current()) await post(readFailure(id, reload));
      } finally {
        await source.close();
      }
      // Validation comes once the model is drawn, so the two don't compete; any glTF JSON gets
      // it, also a model that couldn't be drawn.
      if (structured && current()) await validate(id);
    };
    const validate = async (id: number) => {
      const current = () => id === loadId && !disposed;
      await post({ type: 'validation', loadId: id, state: 'running' });
      let source: ByteSource | undefined;
      try {
        source = await openSource(uri);
        const message = await validationMessage(
          source,
          resourceOpener(uri),
          validator.validate,
          id,
          loadTexts(vscode.l10n.t),
        );
        if (current()) await post(message);
      } catch {
        if (current()) await post({ type: 'validation', loadId: id, state: 'failed' });
      } finally {
        await source?.close();
      }
    };

    const subscriptions = [
      panel.webview.onDidReceiveMessage((message: WebviewToHostMessage) => {
        if (message.type === 'ready') {
          void post({
            type: 'open',
            fileName: uri.path.slice(uri.path.lastIndexOf('/') + 1),
            format,
            locale: vscode.env.language,
            strings: viewerStrings(vscode.l10n.t),
            preferences: this.globalState.get<Preferences>(PREFERENCES) ?? {},
          });
          void load(false);
        } else if (message.type === 'reload') {
          void load(true);
        } else if (message.type === 'draw') {
          largeApproved = true;
          drawRequest?.();
        } else if (message.type === 'preferences') {
          void this.globalState.update(PREFERENCES, message.preferences);
        } else if (message.type === 'reference') {
          const reference = composeReference(referencePath(uri), message.location, message.details);
          void vscode.env.clipboard
            .writeText(reference)
            .then(() =>
              vscode.window.setStatusBarMessage(
                message.details
                  ? vscode.l10n.t('Copied reference with details')
                  : vscode.l10n.t('Copied reference'),
                3000,
              ),
            );
        }
      }),
      watchFile(uri, () => void load(true)),
      panel.onDidChangeViewState(() => this.track(panel)),
    ];
    this.track(panel);
    panel.onDidDispose(() => {
      disposed = true;
      drawRequest?.();
      validator.stop();
      if (this.active === panel) this.active = undefined;
      subscriptions.forEach((subscription) => subscription.dispose());
    });
  }

  private track(panel: vscode.WebviewPanel): void {
    if (panel.active) this.active = panel;
    else if (this.active === panel) this.active = undefined;
  }
}

/**
 * How a copied reference names the file: relative to its workspace folder, so that an assistant
 * working in the workspace finds it; versions from Git and other virtual files by name only.
 */
function referencePath(uri: vscode.Uri): string {
  if (uri.scheme === 'file') return vscode.workspace.asRelativePath(uri, false);
  return uri.path.slice(uri.path.lastIndexOf('/') + 1);
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
  // A model is a GLB or JSON; anything else from Git is text converted from it, or a pointer.
  return memorySource(
    await readVersion(uri, (data) => sniff(data) === 'unknown' || sniff(data) === 'lfsPointer'),
  );
}

/**
 * Reads a file of another scheme whole. A version from Git can come back converted to text by a
 * `textconv`, or as a Git LFS pointer; when `converted` says so, Git itself is asked for the
 * bytes as committed.
 */
async function readVersion(
  uri: vscode.Uri,
  converted: (data: Uint8Array) => boolean,
): Promise<Uint8Array> {
  const data = await vscode.workspace.fs.readFile(uri);
  if (uri.scheme !== 'git' || !converted(data)) return data;
  return (await readGitBlob(uri)) ?? data;
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
    const resource =
      uri.scheme === 'git' ? gitSibling(uri, resolution.path) : uri.with({ path: resolution.path });
    try {
      return memorySource(await readVersion(resource, (data) => lfsObjectId(data) !== undefined));
    } catch (error) {
      return error instanceof vscode.FileSystemError && error.code === 'FileNotFound'
        ? 'missing'
        : 'unreadable';
    }
  };
}
