import './styles/viewer.css';
import type {
  FailedMessage,
  HostToWebviewMessage,
  ModelMessage,
  OpenMessage,
  StructureMessage,
  ViewerStrings,
} from '../shared/protocol';
import { Shell, type PanelLayout } from './shell';
import { StructureView } from './structure/structureView';
import { viewportBackground, watchTheme } from './theme';
import { vscode } from './vscodeApi';

type SceneModule = typeof import('./scene');
type View = InstanceType<SceneModule['ModelView']>;

/** A model on its way from the host: its JSON, and its parts as they arrive. */
interface Arrival {
  message: ModelMessage;
  parts: Map<string, ArrayBuffer>;
  received: number;
}

const shell = new Shell(document.getElementById('app') as HTMLElement, savedLayout(), (layout) =>
  vscode.setState({ layout }),
);
let opened: OpenMessage | undefined;
let strings: ViewerStrings | undefined;
let structure: StructureView | undefined;
/** The load whose structure the panels show. */
let structureLoad = -1;
let view: Promise<View | undefined> | undefined;
let arrival: Arrival | undefined;
let latestLoad = 0;
let hasModel = false;

window.addEventListener('message', (event: MessageEvent<HostToWebviewMessage>) => {
  const message = event.data;
  switch (message.type) {
    case 'open':
      open(message);
      break;
    case 'structure':
      receiveStructure(message);
      break;
    case 'model':
      receiveModel(message);
      break;
    case 'part':
      receivePart(message.loadId, message.key, ownBuffer(message.data));
      break;
    case 'parts':
      message.keys.forEach((key, i) => {
        const end = message.offsets[i + 1] ?? message.data.byteLength;
        receivePart(message.loadId, key, message.data.slice(message.offsets[i], end).buffer);
      });
      break;
    case 'failed':
      fail(message);
      break;
  }
});

watchTheme(
  () => void view?.then((current) => current?.setBackground(viewportBackground(shell.viewport))),
);

vscode.postMessage({ type: 'ready' });

function open(message: OpenMessage): void {
  opened = message;
  strings = message.strings;
  shell.setDocument(message.fileName, message.format, strings);
  structure ??= new StructureView(shell, strings, message.locale);
}

/** The panels' layout as the user left it in this editor, or the default. */
function savedLayout(): PanelLayout {
  const saved = (vscode.getState() as { layout?: Partial<PanelLayout> } | undefined)?.layout;
  return { structure: true, inspector: true, structureWidth: 240, inspectorWidth: 300, ...saved };
}

function receiveStructure(message: StructureMessage): void {
  if (message.loadId < latestLoad || !opened) return;
  latestLoad = message.loadId;
  structureLoad = message.loadId;
  structure?.setStructure(message, opened.fileName, opened.format);
  shell.setPanelsAvailable(true);
}

/** Probes WebGL 2 first, so a machine without it gets a message and not a stack of errors. */
async function createView(text: ViewerStrings): Promise<View | undefined> {
  const canvas = document.createElement('canvas');
  canvas.className = 'nm-canvas';
  const context = canvas.getContext('webgl2', {
    alpha: false,
    antialias: true,
    powerPreference: 'high-performance',
  });
  if (!context) {
    shell.showError(text.errorTitle, text.errorWebGL);
    return undefined;
  }
  shell.viewport.prepend(canvas);
  canvas.addEventListener('webglcontextlost', () =>
    shell.showError(text.errorTitle, text.errorContextLost),
  );
  canvas.addEventListener('webglcontextrestored', () => {
    shell.hideError();
    if (hasModel) shell.setState('shown');
    // Vertex data left memory once it was on the GPU; the host sends the model again.
    if (hasModel) vscode.postMessage({ type: 'reload' });
  });
  const scene: SceneModule = await import('./scene');
  const created = new scene.ModelView(shell.viewport, canvas, context);
  created.setBackground(viewportBackground(shell.viewport));
  return created;
}

function receiveModel(message: ModelMessage): void {
  if (message.loadId < latestLoad) return;
  latestLoad = message.loadId;
  arrival = { message, parts: new Map(), received: 0 };
  // The 3D view starts once there is a model to draw: a file that isn't one needs no GPU.
  view ??= createView(strings!);
  if (!(message.reload && hasModel)) shell.setProgress(message.bytes > 0 ? 0 : undefined);
  // Decoders load while the bytes arrive; build() finds them ready.
  void view?.then((target) => target?.decoders(message.extensions));
  if (message.parts === 0) void build(arrival);
}

function receivePart(loadId: number, key: string, data: ArrayBuffer): void {
  const current = arrival;
  if (!current || current.message.loadId !== loadId) return;
  current.parts.set(key, data);
  current.received += data.byteLength;
  if (!(current.message.reload && hasModel)) {
    shell.setProgress(current.received / current.message.bytes);
  }
  if (current.parts.size === current.message.parts) void build(current);
}

async function build(current: Arrival): Promise<void> {
  const text = strings!;
  try {
    const target = await view;
    if (!target) {
      // No WebGL: the message saying so stays.
      shell.setState('failed');
      return;
    }
    const { parseModel } = await import('./scene');
    const decoders = await target.decoders(current.message.extensions);
    const gltf = await parseModel(current.message.json, current.parts, decoders);
    if (current !== arrival) return;
    target.show(gltf.scene, current.message.reload && hasModel);
    hasModel = true;
    shell.hideError();
    shell.setState('shown');
    shell.setNotices(text.partialTitle, current.message.notices);
  } catch (error) {
    if (current !== arrival) return;
    console.warn(error);
    // A file caught mid-save can be incomplete; keep showing the last good model.
    if (!(current.message.reload && hasModel)) shell.showError(text.errorTitle, text.errorRender);
  } finally {
    if (current === arrival) {
      shell.setProgress(undefined);
      arrival = undefined;
    }
  }
}

function fail(message: FailedMessage): void {
  if (message.loadId < latestLoad) return;
  latestLoad = message.loadId;
  arrival = undefined;
  shell.setProgress(undefined);
  if (message.reload && hasModel) return;
  // A file that isn't a model has no structure to show either.
  if (structureLoad !== message.loadId) shell.setPanelsAvailable(false);
  shell.showError(strings?.errorTitle ?? '', message.message, message.details);
}

/** An array that is exactly its buffer, as glTF's loader expects; copies only when it isn't. */
function ownBuffer(data: Uint8Array): ArrayBuffer {
  const whole = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength;
  return (whole ? data : data.slice()).buffer as ArrayBuffer;
}
