import * as vscode from 'vscode';
import type { HostToWebviewMessage } from '../shared/protocol';
import { isTrs, type Trs } from '../shared/transforms';

/**
 * A model open in one or more viewers. A glTF model in a file can have its nodes moved, turned
 * and scaled (D-069): the changes live here until saved, each undoable, and every viewer of the
 * model shows them.
 */
export class ModelDocument implements vscode.CustomDocument {
  /** Each node changed since the file was last saved, as it is now. */
  readonly transforms = new Map<number, Trs>();
  private readonly viewers = new Set<(message: HostToWebviewMessage) => unknown>();
  private readonly changes = new vscode.EventEmitter<
    vscode.CustomDocumentEditEvent<ModelDocument>
  >();
  readonly onDidChange = this.changes.event;

  constructor(
    readonly uri: vscode.Uri,
    /** Whether the model can be changed and saved: glTF, in a file on disk. */
    readonly editable: boolean,
    restored: readonly [number, Trs][] = [],
  ) {
    for (const [node, trs] of restored) this.transforms.set(node, trs);
  }

  /** Keeps a viewer told of the changes; returns what stops that. */
  addViewer(post: (message: HostToWebviewMessage) => unknown): vscode.Disposable {
    this.viewers.add(post);
    return new vscode.Disposable(() => this.viewers.delete(post));
  }

  /** The changes, as a viewer is told them. */
  message(): HostToWebviewMessage {
    return { type: 'transforms', nodes: [...this.transforms] };
  }

  /** A viewer changed node `node` from `from` to `to`: one step for Undo and Redo. */
  edit(node: number, from: unknown, to: unknown): void {
    if (!this.editable || !Number.isInteger(node) || node < 0 || !isTrs(from) || !isTrs(to)) return;
    this.set(node, to);
    this.changes.fire({
      document: this,
      label: vscode.l10n.t('Transform'),
      undo: () => this.set(node, from),
      redo: () => this.set(node, to),
    });
  }

  /**
   * Once saved, the file has the changes. The viewers keep showing them until they have read the
   * saved file, which follows; they are told then.
   */
  saved(): void {
    this.transforms.clear();
  }

  /** Back to the file as it is on disk. */
  revert(): void {
    this.transforms.clear();
    this.tell();
  }

  /** The changes, kept for VS Code to restore after a restart. */
  backup(): string {
    return JSON.stringify([...this.transforms]);
  }

  dispose(): void {
    this.changes.dispose();
    this.viewers.clear();
  }

  private set(node: number, trs: Trs): void {
    this.transforms.set(node, trs);
    this.tell();
  }

  private tell(): void {
    const message = this.message();
    for (const post of this.viewers) post(message);
  }
}

/** The changes a backup kept, as far as they are still changes to make. */
export function restoredTransforms(text: string): [number, Trs][] {
  try {
    const entries: unknown = JSON.parse(text);
    if (!Array.isArray(entries)) return [];
    return entries.filter(
      (entry): entry is [number, Trs] =>
        Array.isArray(entry) && Number.isInteger(entry[0]) && entry[0] >= 0 && isTrs(entry[1]),
    );
  } catch {
    return [];
  }
}
