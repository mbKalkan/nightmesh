// Messages exchanged between the extension host and the webview.

export type ModelFormat = 'glb' | 'gltf';

/** UI strings localized by the extension host and handed to the webview. */
export interface ViewerStrings {
  loading: string;
  errorTitle: string;
  errorWebGL: string;
  errorContextLost: string;
  errorRender: string;
  /** Title of the notice listing what couldn't be loaded. */
  partialTitle: string;
  close: string;
}

/** Sent once the webview is ready: what file this is. */
export interface OpenMessage {
  type: 'open';
  fileName: string;
  format: ModelFormat;
  strings: ViewerStrings;
}

/**
 * A model to draw. Its bytes follow in `part` and `parts` messages, `parts` keys in all;
 * the webview hands them to glTF's loader under those keys, so the loader never fetches.
 */
export interface ModelMessage {
  type: 'model';
  /** Increases with each load; messages of an older load are ignored. */
  loadId: number;
  /** True when the file changed on disk and the view should keep its camera. */
  reload: boolean;
  json: string;
  parts: number;
  bytes: number;
  /** What couldn't be loaded, in sentences for the user; empty when all of it could. */
  notices: string[];
}

/** One large part, as a buffer of its own. */
export interface PartMessage {
  type: 'part';
  loadId: number;
  key: string;
  data: Uint8Array;
}

/**
 * Small parts packed in one buffer: a message can carry only so many separate arrays.
 * Part `i` is `data` from `offsets[i]` to `offsets[i + 1]` (or the end).
 */
export interface PartsMessage {
  type: 'parts';
  loadId: number;
  keys: string[];
  offsets: number[];
  data: Uint8Array;
}

/** The model can't be shown at all. */
export interface FailedMessage {
  type: 'failed';
  loadId: number;
  reload: boolean;
  message: string;
  details: string[];
}

export type HostToWebviewMessage =
  OpenMessage | ModelMessage | PartMessage | PartsMessage | FailedMessage;

export type WebviewToHostMessage =
  | { type: 'ready' }
  /** The GPU context came back; the model has to be sent again to be drawn. */
  | { type: 'reload' };
