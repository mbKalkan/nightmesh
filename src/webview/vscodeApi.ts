import type { WebviewToHostMessage } from '../shared/protocol';

interface VsCodeApi {
  postMessage(message: WebviewToHostMessage): void;
  /** State kept while the webview lives, across hiding and showing it. */
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

export const vscode = acquireVsCodeApi();
