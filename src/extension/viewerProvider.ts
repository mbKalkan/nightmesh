import { join, posix } from 'node:path';
import * as vscode from 'vscode';
import { formatForPath, isGltfFormat, isMeshFormat } from '../shared/formats';
import type {
  HostToWebviewMessage,
  ModelFormat,
  Preferences,
  WebviewToHostMessage,
  TileTablesBytes,
} from '../shared/protocol';
import { composeReference } from '../shared/reference';
import { DiffPairs, type DiffMember } from './diffPairs';
import { EnvironmentStore } from './environmentStore';
import { watchFile } from './fileWatcher';
import { gitSibling, readGitBlob } from './gitBlob';
import { JsonDocuments } from './jsonDocuments';
import { lfsObjectId } from './gitObject';
import { sniff } from './model/container';
import { isI3dm } from './model/i3dm';
import { isB3dm } from './model/tileFile';
import { gltfFile, type GltfFile } from './model/tileGltf';
import { readTileTables } from './model/tileTables';
import { fileResourceOpener } from './model/fileResources';
import { loadMessages, type ResourceOpener } from './model/load';
import { looksLike } from './model/mesh/parse';
import { resolveResourceUri } from './model/resources';
import { fileSource, memorySource, type ByteSource } from './model/sources';
import { readTile, tilesetPlace } from './model/tiles';
import { validationMessage } from './model/validation';
import { loadTexts, viewerStrings } from './texts';
import { buildWebviewHtml } from './webviewHtml';
import { workerMeshParser } from './workerMesh';
import { workerValidator } from './workerValidator';

const PREFERENCES = 'nightmesh.preferences';

export class ViewerProvider implements vscode.CustomReadonlyEditorProvider {
  static readonly viewType = 'nightmesh.viewer';
  /** 3D Tiles tilesets, which are JSON files: opened with Nightmesh only when the user says so. */
  static readonly tilesetViewType = 'nightmesh.tileset';

  /** The viewer in front, which commands act on. */
  private active: vscode.WebviewPanel | undefined;
  /** Numbers the viewers, for their glTF JSON documents. */
  private viewers = 0;
  /** The two sides of each comparison, which move together. */
  private readonly diffs = new DiffPairs();

  constructor(
    private readonly extensionUri: vscode.Uri,
    /** Where the viewers' preferences are kept, for every window and session. */
    private readonly globalState: vscode.Memento,
    private readonly jsonDocuments: JsonDocuments,
    /** The lighting environment for the 3D view, made once and kept. */
    private readonly environment: EnvironmentStore,
  ) {}

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    const json = JsonDocuments.register();
    const provider = new ViewerProvider(
      context.extensionUri,
      context.globalState,
      json.documents,
      new EnvironmentStore(context.globalStorageUri.fsPath),
    );
    return vscode.Disposable.from(
      json.disposable,
      vscode.commands.registerCommand('nightmesh.showJson', (menu?: unknown) =>
        provider.showJson(menu),
      ),
      vscode.commands.registerCommand('nightmesh.saveScreenshot', () =>
        provider.askToExport('screenshot'),
      ),
      vscode.commands.registerCommand('nightmesh.saveReport', () => provider.askToExport('report')),
      ...[ViewerProvider.viewType, ViewerProvider.tilesetViewType].map((viewType) =>
        vscode.window.registerCustomEditorProvider(viewType, provider, {
          // Keeps the WebGL context and camera when the tab is hidden, so switching back is
          // instant.
          webviewOptions: { retainContextWhenHidden: true },
          supportsMultipleEditorsPerDocument: true,
        }),
      ),
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

  /** Asks the viewer in front what to show in its glTF JSON, as for a reference. */
  private showJson(menu: unknown): void {
    const atPointer = typeof menu === 'object' && menu !== null && 'webview' in menu;
    void this.active?.webview.postMessage({
      type: 'showJson',
      atPointer,
    } satisfies HostToWebviewMessage);
  }

  /** Asks the viewer in front for a screenshot or a report, which it sends back to save. */
  private askToExport(what: 'screenshot' | 'report'): void {
    void this.active?.webview.postMessage({ type: 'export', what } satisfies HostToWebviewMessage);
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
    const viewer = String(++this.viewers);
    const member: DiffMember = { uri, post, ready: false };
    this.diffs.add(member, panel.viewColumn);
    const fileName = uri.path.slice(uri.path.lastIndexOf('/') + 1);
    let loadId = 0;
    let disposed = false;
    /** Once the user drew a large model here, its next loads don't ask again. */
    let largeApproved = false;
    /** Lets a load waiting for the user's word on a large model go on. */
    let drawRequest: (() => void) | undefined;
    const validator = workerValidator(join(this.extensionUri.fsPath, 'dist', 'validator.js'));
    const meshParser = workerMeshParser(join(this.extensionUri.fsPath, 'dist', 'mesh.js'));
    const gltf = isGltfFormat(format);
    // A tileset's tiles are asked for by their path in the folder the viewer may read.
    const { root, path: tilesetPath } = tilesetPlace(uri.path, readableRoot(uri));
    const tileOpener = resourceOpener(uri, root);
    const load = async (reload: boolean) => {
      const id = ++loadId;
      // A load still waiting gives way to this one: it ends, and closes its file.
      drawRequest?.();
      validator.stop();
      meshParser.stop();
      const current = () => id === loadId && !disposed;
      let structured = false;
      let source: ByteSource;
      try {
        source = await openSource(uri, format);
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
          format,
          fileName,
          largeBytes: largeApproved ? Infinity : undefined,
          parseMesh: meshParser.parse,
          tilesetPath,
        });
        for await (const message of messages) {
          if (!current()) break;
          await post(message);
          // OBJ, STL and PLY have no glTF JSON of their own, nor anything to validate.
          if (message.type === 'structure' && gltf) {
            structured = true;
            this.jsonDocuments.set(viewer, fileName, message.json);
          }
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
      let gltf: GltfFile | undefined;
      try {
        source = await openSource(uri, format);
        gltf = await gltfFile(source, format, resourceOpener(uri));
        const message = await validationMessage(
          gltf.source,
          gltf.open,
          validator.validate,
          id,
          loadTexts(vscode.l10n.t),
        );
        if (current()) await post(message);
      } catch {
        if (current()) await post({ type: 'validation', loadId: id, state: 'failed' });
      } finally {
        await gltf?.close();
        await source?.close();
      }
    };

    const subscriptions = [
      panel.webview.onDidReceiveMessage((message: WebviewToHostMessage) => {
        if (message.type === 'ready') {
          void this.environment.get().then(async (environment) => {
            if (disposed) return;
            await post({
              type: 'open',
              fileName,
              format,
              locale: vscode.env.language,
              strings: viewerStrings(vscode.l10n.t),
              preferences: this.globalState.get<Preferences>(PREFERENCES) ?? {},
              environment,
            });
            void load(false);
            this.diffs.ready(member);
          });
        } else if (message.type === 'environment') {
          void this.environment.keep(message.environment);
        } else if (message.type === 'tile') {
          void readTile(message.path, tileOpener, loadTexts(vscode.l10n.t)).then((tile) => {
            if (!disposed) void post({ type: 'tile', id: message.id, ...tile });
          });
        } else if (message.type === 'tileTables') {
          void tileTables(uri, format, message.part).then((tables) => {
            if (!disposed) void post({ type: 'tileTables', id: message.id, tables });
          });
        } else if (message.type === 'camera') {
          this.diffs.camera(member, message.camera);
        } else if (message.type === 'summary') {
          this.diffs.summary(member, message.summary);
        } else if (message.type === 'compareSelect') {
          this.diffs.select(member, message.target);
        } else if (message.type === 'reload') {
          void load(true);
        } else if (message.type === 'draw') {
          largeApproved = true;
          drawRequest?.();
        } else if (message.type === 'json') {
          void this.jsonDocuments.show(viewer, message.pointer);
        } else if (message.type === 'selected') {
          this.jsonDocuments.reveal(viewer, message.pointer);
        } else if (message.type === 'save') {
          void save(uri, message);
        } else if (message.type === 'copy') {
          void vscode.env.clipboard
            .writeText(message.text)
            .then(() => vscode.window.setStatusBarMessage(vscode.l10n.t('Copied'), 3000));
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
      // Moving through the glTF JSON with the keyboard or mouse selects what the cursor is in; a
      // selection the viewer made there itself is left alone.
      vscode.window.onDidChangeTextEditorSelection((event) => {
        const { document } = event.textEditor;
        if (JsonDocuments.viewerOf(document.uri) !== viewer) return;
        const { Keyboard, Mouse } = vscode.TextEditorSelectionChangeKind;
        if (event.kind !== Keyboard && event.kind !== Mouse) return;
        const pointer = this.jsonDocuments.pointerAt(viewer, document, event.selections[0].active);
        void post({ type: 'select', pointer });
      }),
      panel.onDidChangeViewState(() => this.track(panel, format)),
    ];
    this.track(panel, format);
    panel.onDidDispose(() => {
      disposed = true;
      drawRequest?.();
      validator.stop();
      meshParser.stop();
      this.jsonDocuments.delete(viewer);
      this.diffs.remove(member);
      if (this.active === panel) this.active = undefined;
      subscriptions.forEach((subscription) => subscription.dispose());
    });
  }

  /** Keeps the viewer in front, and whether it shows glTF, which has JSON to show. */
  private track(panel: vscode.WebviewPanel, format: ModelFormat): void {
    if (panel.active) {
      this.active = panel;
      void vscode.commands.executeCommand('setContext', 'nightmesh.gltf', isGltfFormat(format));
    } else if (this.active === panel) {
      this.active = undefined;
    }
  }
}

/**
 * Saves a screenshot or a report where the user picks, by default next to the model. The model
 * itself is never written: Nightmesh is read-only.
 */
async function save(
  model: vscode.Uri,
  message: Extract<WebviewToHostMessage, { type: 'save' }>,
): Promise<void> {
  const t = vscode.l10n.t;
  if (message.what === 'screenshot' && !message.data) {
    void vscode.window.showInformationMessage(t('There is no drawn model to take a picture of.'));
    return;
  }
  const name = posix.basename(model.path);
  const base = name.slice(0, name.lastIndexOf('.')) || name;
  const screenshot = message.what === 'screenshot';
  const target = await vscode.window.showSaveDialog({
    title: screenshot ? t('Save Screenshot') : t('Save Report'),
    saveLabel: t('Save'),
    defaultUri: saveLocation(model, screenshot ? `${base}.png` : `${base}-report.md`),
    filters: screenshot
      ? { [t('PNG Image')]: ['png'] }
      : { [t('Markdown')]: ['md'], [t('JSON')]: ['json'] },
  });
  if (!target) return;
  const same =
    target.scheme === model.scheme &&
    (target.scheme === 'file'
      ? target.fsPath.toLowerCase() === model.fsPath.toLowerCase()
      : target.path === model.path);
  if (same) {
    void vscode.window.showErrorMessage(
      t("Nightmesh doesn't write to the model it shows. Pick another file."),
    );
    return;
  }
  const bytes =
    message.what === 'screenshot'
      ? message.data!
      : new TextEncoder().encode(
          target.path.toLowerCase().endsWith('.json') ? message.json : message.markdown,
        );
  const saved = posix.basename(target.path);
  try {
    await vscode.workspace.fs.writeFile(target, bytes);
    vscode.window.setStatusBarMessage(t('Saved {0}', saved), 3000);
  } catch {
    void vscode.window.showErrorMessage(t("{0} couldn't be saved.", saved));
  }
}

/** Where a saved file goes unless the user picks elsewhere: next to the model, if it is a file. */
function saveLocation(model: vscode.Uri, name: string): vscode.Uri | undefined {
  if (model.scheme === 'file')
    return model.with({ path: posix.join(posix.dirname(model.path), name) });
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  return folder && vscode.Uri.joinPath(folder, name);
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

/** The feature and batch tables of a tile file, or of a tile inside a composite. */
async function tileTables(
  uri: vscode.Uri,
  format: ModelFormat,
  part: string | undefined,
): Promise<TileTablesBytes | undefined> {
  let source: ByteSource | undefined;
  try {
    source = await openSource(uri, format);
    return await readTileTables(source, part);
  } catch {
    return undefined;
  } finally {
    await source?.close();
  }
}

/** Local files are read in place; other schemes (Git, remote file systems) only as a whole. */
async function openSource(uri: vscode.Uri, format: ModelFormat): Promise<ByteSource> {
  if (uri.scheme === 'file') return fileSource(uri.fsPath);
  // Anything from Git that isn't what the format looks like is text converted from it, or a
  // pointer.
  return memorySource(
    await readVersion(
      uri,
      (data) =>
        sniff(data) === 'lfsPointer' ||
        (isMeshFormat(format)
          ? looksLike(format, data.subarray(0, 64 * 1024), data.length) !== 'yes'
          : format === 'b3dm'
            ? !isB3dm(data)
            : format === 'i3dm'
              ? !isI3dm(data)
              : sniff(data) === 'unknown'),
    ),
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
function readableRoot(uri: vscode.Uri): string {
  return vscode.workspace.getWorkspaceFolder(uri)?.uri.path ?? posix.dirname(uri.path);
}

/** Opens what `uri` refers to, relative to `modelFolder`: by default the model's own. */
function resourceOpener(uri: vscode.Uri, modelFolder = posix.dirname(uri.path)): ResourceOpener {
  const root = readableRoot(uri);
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
