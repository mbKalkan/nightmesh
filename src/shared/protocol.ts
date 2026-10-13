// Messages exchanged between the extension host and the webview.

export type ModelFormat = 'glb' | 'gltf';

/** UI strings localized by the extension host and handed to the webview. */
export interface ViewerStrings {
  errorTitle: string;
  errorWebGL: string;
  errorContextLost: string;
}

export interface LoadMessage {
  type: 'load';
  fileName: string;
  format: ModelFormat;
  strings: ViewerStrings;
}

export type HostToWebviewMessage = LoadMessage;

export type WebviewToHostMessage = { type: 'ready' };
