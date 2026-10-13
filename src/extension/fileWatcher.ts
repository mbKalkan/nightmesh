import * as vscode from 'vscode';
import { fileNameGlob } from './fileNameGlob';

/**
 * Calls `onChange` once the file settles after being changed or re-created on disk.
 * Exporters often save by writing a temporary file and renaming it over the original,
 * which surfaces as a burst of delete/create events.
 */
export function watchFile(uri: vscode.Uri, onChange: () => void, delayMs = 300): vscode.Disposable {
  const folder = vscode.Uri.joinPath(uri, '..');
  const fileName = uri.path.slice(uri.path.lastIndexOf('/') + 1);
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(folder, fileNameGlob(fileName)),
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  const target = uri.toString().toLowerCase();
  const onEvent = (changed: vscode.Uri) => {
    if (changed.toString().toLowerCase() !== target) {
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(onChange, delayMs);
  };

  const subscriptions = [watcher, watcher.onDidChange(onEvent), watcher.onDidCreate(onEvent)];
  return new vscode.Disposable(() => {
    clearTimeout(timer);
    subscriptions.forEach((s) => s.dispose());
  });
}
