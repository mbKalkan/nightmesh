import * as vscode from 'vscode';
import { FormattedJson } from './model/formattedJson';

interface Entry {
  fileName: string;
  json: string;
  formatted?: FormattedJson | null;
}

/**
 * The glTF JSON of each open viewer as a read-only text document beside it, laid out for
 * reading: a GLB's JSON chunk can't be opened as text otherwise. VS Code's JSON support folds,
 * searches and outlines it. A document is named after the model and tied to its viewer.
 */
export class JsonDocuments implements vscode.TextDocumentContentProvider {
  static readonly scheme = 'nightmesh-json';

  private readonly entries = new Map<string, Entry>();
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changed.event;

  static register(): { documents: JsonDocuments; disposable: vscode.Disposable } {
    const documents = new JsonDocuments();
    const disposable = vscode.Disposable.from(
      vscode.workspace.registerTextDocumentContentProvider(JsonDocuments.scheme, documents),
      documents.changed,
    );
    return { documents, disposable };
  }

  /** The JSON of viewer `id`, as its file has it now. An open document shows the new one. */
  set(id: string, fileName: string, json: string): void {
    const previous = this.entries.get(id);
    if (previous?.json === json && previous.fileName === fileName) return;
    this.entries.set(id, { fileName, json });
    if (previous) this.changed.fire(this.uri(id, fileName));
  }

  delete(id: string): void {
    this.entries.delete(id);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.formatted(uri.query)?.text ?? '';
  }

  /** Viewer `id`'s document, if `uri` is one. */
  static viewerOf(uri: vscode.Uri): string | undefined {
    return uri.scheme === JsonDocuments.scheme ? uri.query : undefined;
  }

  /** The JSON pointer of what is at `position` in viewer `id`'s document. */
  pointerAt(id: string, document: vscode.TextDocument, position: vscode.Position): string {
    return this.formatted(id)?.pointerAt(document.offsetAt(position)) ?? '';
  }

  /** Opens viewer `id`'s document beside it, showing what `pointer` names. */
  async show(id: string, pointer: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;
    const document = await vscode.workspace.openTextDocument(this.uri(id, entry.fileName));
    const editor = await vscode.window.showTextDocument(document, {
      viewColumn: vscode.ViewColumn.Beside,
      preview: true,
    });
    this.select(editor, id, pointer);
  }

  /** Shows what `pointer` names in viewer `id`'s document, where it is on screen. */
  reveal(id: string, pointer: string): void {
    for (const editor of vscode.window.visibleTextEditors) {
      if (JsonDocuments.viewerOf(editor.document.uri) === id) this.select(editor, id, pointer);
    }
  }

  private select(editor: vscode.TextEditor, id: string, pointer: string): void {
    const formatted = this.formatted(id);
    if (!formatted) return;
    const { start, end } = formatted.rangeOf(pointer);
    const { document } = editor;
    // The model is the whole document: its top, rather than all of it selected.
    const range = new vscode.Range(
      document.positionAt(start),
      document.positionAt(pointer === '' ? start : end),
    );
    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  private uri(id: string, fileName: string): vscode.Uri {
    return vscode.Uri.from({ scheme: JsonDocuments.scheme, path: `/${fileName}.json`, query: id });
  }

  private formatted(id: string): FormattedJson | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    if (entry.formatted === undefined) {
      try {
        entry.formatted = new FormattedJson(entry.json);
      } catch {
        entry.formatted = null;
      }
    }
    return entry.formatted ?? undefined;
  }
}
