import './styles/viewer.css';
import type {
  FailedMessage,
  HostToWebviewMessage,
  ModelMessage,
  Motion,
  OpenMessage,
  PanelLayout,
  Background,
  Preferences,
  ShadingStrings,
  StandardView,
  StructureMessage,
  ViewerStrings,
} from '../shared/protocol';
import { Shell } from './shell';
import { AnimationBar } from './animationBar';
import { Gizmo } from './gizmo';
import { MenuButton, type MenuItem } from './menu';
import { Formatter, fill } from './structure/format';
import { StructureView } from './structure/structureView';
import { helperColors, highlightColor, viewportBackground, watchTheme } from './theme';
import { SHORTCUTS, STANDARD_VIEWS, viewKey } from './viewKeys';
import { vscode } from './vscodeApi';

type SceneModule = typeof import('./scene');
type View = InstanceType<SceneModule['ModelView']>;

/** A model on its way from the host: its JSON, and its parts as they arrive. */
interface Arrival {
  message: ModelMessage;
  parts: Map<string, ArrayBuffer>;
  received: number;
}

const DEFAULT_LAYOUT: PanelLayout = {
  structure: true,
  inspector: true,
  structureWidth: 240,
  inspectorWidth: 300,
  inspectorTab: 'inspector',
};

/** What the user set, as the host kept it from the viewers before. */
let preferences: Preferences = {};

const shell = new Shell(
  document.getElementById('app') as HTMLElement,
  { ...DEFAULT_LAYOUT },
  {
    layoutChanged: (layout) => savePreferences({ layout: { ...layout } }),
    frame: () => void view?.then((target) => target?.frameSelection()),
  },
);
let opened: OpenMessage | undefined;
let strings: ViewerStrings | undefined;
let structure: StructureView | undefined;
let animationBar: AnimationBar | undefined;
/** Formats lengths in the user's language, once it is known. */
let metres = new Formatter('en');
/** The load whose structure the panels show. */
let structureLoad = -1;
/** The structure entry selected, which the 3D view highlights once it has a model. */
let selectedKey = 'model';
let view: Promise<View | undefined> | undefined;
/** The 3D view once it is made, for what has to know its state right away, as the View menu. */
let shownView: View | undefined;
let viewOptions: MenuButton | undefined;
let shadingOptions: MenuButton | undefined;
let arrival: Arrival | undefined;
let latestLoad = 0;
let hasModel = false;
/** What the context menu's reference commands name: what was right-clicked last. */
let menuKey: string | undefined;
/** The context menu the 3D view opened, having set `menuKey` to what is under the pointer. */
let viewContextMenu: Event | undefined;
/** The row or link the context menu was opened on, outlined while the menu shows. */
let menuTarget: Element | undefined;

// Cut and Paste do nothing in a read-only viewer; Copy stays for the values in the inspector.
document.body.dataset.vscodeContext = JSON.stringify({ preventDefaultContextMenuItems: true });
shell.inspectorPanel.body.dataset.vscodeContext = JSON.stringify({
  preventDefaultContextMenuItems: false,
});

window.addEventListener('message', (event: MessageEvent<HostToWebviewMessage>) => {
  const message = event.data;
  switch (message.type) {
    case 'open':
      open(message);
      break;
    case 'structure':
      receiveStructure(message);
      break;
    case 'images':
      if (message.loadId === structureLoad) structure?.setImages(message.images);
      break;
    case 'animations':
      if (message.loadId === structureLoad) receiveMotion(message.motion);
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
    case 'copyReference': {
      const key = message.atPointer ? (menuKey ?? selectedKey) : selectedKey;
      vscode.postMessage({ type: 'reference', ...structure?.reference(key, message.details) });
      break;
    }
  }
});

// A right-click on a tree row, or a link in the panels, refers to that entry; anywhere else, to
// the selection. The 3D view opens its own menu, having set what is under the pointer; the
// browser's, which its orbit controls stop, are left alone.
document.addEventListener('contextmenu', (event) => {
  if (event.defaultPrevented || event === viewContextMenu) return;
  const target = event.target instanceof Element ? event.target : null;
  // Opened from the keyboard in the tree, the menu is for the tree itself: its row in focus.
  const entry =
    target?.closest<HTMLElement>('[data-key]') ??
    target?.querySelector<HTMLElement>('.nm-tree-row.nm-focused');
  menuKey = entry?.dataset.key ?? selectedKey;
  markMenuTarget(entry ?? undefined);
});

watchTheme(
  () =>
    void view?.then((current) => {
      current?.setBackground(viewportBackground(shell.viewport));
      current?.setHighlightColor(highlightColor());
      current?.setHelperColors(helperColors(shell.viewport));
    }),
);

// F frames the selection, Escape lets go of it, as in most 3D tools.
shell.viewport.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.target !== shell.viewport) return;
  if (event.key === 'f' || event.key === 'F') {
    void view?.then((target) => target?.frameSelection());
  } else if (event.key === 'Escape') {
    structure?.select('model');
  } else {
    return;
  }
  event.preventDefault();
});

// The number keys turn to standard views and 5 switches projection, as on Blender's number pad;
// + and - zoom; in the view, the arrows orbit. Not in the panels, where keys move through lists
// and find rows by what is typed.
document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey || !shownView) return;
  const target = event.target as HTMLElement;
  const inView = target === shell.viewport;
  if (!inView && target !== document.body && !target.closest('.nm-toolbar')) return;
  const action = viewKey(event, inView);
  if (!action) return;
  event.preventDefault();
  action(shownView);
});

// Space plays and pauses wherever it has no job of its own: not on a button or a list, which it
// presses or opens, nor in the panels, where it folds the tree and scrolls the details.
document.addEventListener('keydown', (event) => {
  if (event.key !== ' ' || event.ctrlKey || event.metaKey || event.altKey) return;
  if (!animationBar || animationBar.element.hidden) return;
  const target = event.target as HTMLElement;
  if (target instanceof HTMLButtonElement || target instanceof HTMLSelectElement) return;
  if (target.closest('.nm-panel')) return;
  event.preventDefault();
  void view?.then((current) => current?.togglePlaying());
});

vscode.postMessage({ type: 'ready' });

function open(message: OpenMessage): void {
  // The host sends this once per viewer; the preferences then are the ones it starts with.
  if (!opened) {
    preferences = message.preferences ?? {};
    shell.setLayout({ ...DEFAULT_LAYOUT, ...preferences.layout });
    showBackground();
  }
  opened = message;
  strings = message.strings;
  metres = new Formatter(message.locale);
  shell.setDocument(message.fileName, message.format, strings);
  viewOptions ??= new MenuButton(shell.viewButton, document.getElementById('app')!, viewMenuItems);
  shadingOptions ??= new MenuButton(
    shell.shadingButton,
    document.getElementById('app')!,
    shadingMenuItems,
  );
  if (!animationBar) {
    animationBar = new AnimationBar(strings.animation, strings.structure.motion, message.locale, {
      clip: (index) => void view?.then((target) => target?.setClip(index)),
      playing: (playing) => void view?.then((target) => target?.setPlaying(playing)),
      seek: (time) => void view?.then((target) => target?.seek(time)),
      speed: (speed) => void view?.then((target) => target?.setSpeed(speed)),
    });
    shell.addBelowViewport(animationBar.element);
  }
  structure ??= new StructureView(shell, strings, message.locale, {
    selected: (key) => {
      selectedKey = key;
      void view?.then((target) => {
        target?.select(key);
        // Picking an animation in the structure makes it the one the bar plays.
        const animation = /^animation:(\d+)$/.exec(key);
        if (animation) target?.setClip(Number(animation[1]));
      });
    },
    activated: () => void view?.then((target) => target?.frameSelection()),
    preview: async (texture) => (await view)?.textureImage(texture),
  });
}

/** The Shading menu: how the model is drawn, then the wireframe over it. */
function shadingMenuItems(): MenuItem[] {
  const current = shownView;
  const text = strings?.shading;
  if (!current || !text) return [];
  return [
    ...(['lit', 'unlit', 'normals'] as const).map((mode) => ({
      label: text.modes[mode],
      kind: 'radio' as const,
      checked: current.shadingMode === mode,
      run: () => current.setShadingMode(mode),
    })),
    'separator',
    {
      label: text.wireframe,
      kind: 'check',
      checked: current.wireframe,
      run: () => current.setWireframe(!current.wireframe),
    },
    ...variantItems(current, text),
  ];
}

/** KHR_materials_variants, when the model has them: its own materials or one of its variants. */
function variantItems(current: View, text: ShadingStrings): MenuItem[] {
  if (current.variants.length === 0) return [];
  const pick = (variant: number | undefined, label: string): MenuItem => ({
    label,
    kind: 'radio',
    checked: current.variant === variant,
    run: () => current.setVariant(variant),
  });
  return [
    'separator',
    pick(undefined, text.defaultVariant),
    ...current.variants.map((name, index) => pick(index, name ?? fill(text.variant, index))),
  ];
}

/** The View menu: the standard views, the projection, then the grid and axes. */
function viewMenuItems(): MenuItem[] {
  const current = shownView;
  const text = strings?.view;
  if (!current || !text) return [];
  const shown = helpersShown();
  const cell = current.gridCell;
  return [
    ...STANDARD_VIEWS.map((name) => ({
      label: text.views[name],
      shortcut: SHORTCUTS[name],
      run: () => current.look(name),
    })),
    'separator',
    ...(['perspective', 'orthographic'] as const).map((projection) => ({
      label: text.projections[projection],
      shortcut: '5',
      kind: 'radio' as const,
      checked: current.projection === projection,
      run: () => current.setProjection(projection),
    })),
    'separator',
    {
      label: cell === undefined ? text.grid : fill(text.gridCell, metres.metres(cell)),
      kind: 'check',
      checked: shown.grid,
      run: () => setHelpers({ grid: !shown.grid }),
    },
    {
      label: text.axes,
      kind: 'check',
      checked: shown.axes,
      run: () => setHelpers({ axes: !shown.axes }),
    },
    {
      label: text.bounds,
      kind: 'check',
      checked: shown.bounds,
      run: () => setHelpers({ bounds: !shown.bounds }),
    },
    'separator',
    ...(['theme', 'dark', 'neutral', 'light'] as const).map((background) => ({
      label: text.backgrounds[background],
      kind: 'radio' as const,
      checked: (preferences.background ?? 'theme') === background,
      run: () => setBackground(background),
    })),
    ...cameraItems(current),
  ];
}

/** The cameras in the model, to look through; 0 goes through them one after the other. */
function cameraItems(current: View): MenuItem[] {
  const nodes = current.cameraNodes;
  if (nodes.length === 0) return [];
  const kind = strings?.structure.kinds.camera ?? '';
  return [
    'separator',
    ...nodes.map((node, index) => ({
      label: (node !== undefined && structure?.nodeName(node)) || `${kind} ${index}`,
      shortcut: index === 0 ? '0' : undefined,
      run: () => current.lookThrough(index),
    })),
  ];
}

function markMenuTarget(target: Element | undefined): void {
  menuTarget?.classList.remove('nm-menu-target');
  menuTarget = target;
  menuTarget?.classList.add('nm-menu-target');
}

/** Keeps a change for this viewer and, through the host, for the next ones. */
function savePreferences(change: Preferences): void {
  preferences = { ...preferences, ...change };
  vscode.postMessage({ type: 'preferences', preferences });
}

/** The ground grid shows unless the user hid it; the origin axes and bounding box when asked. */
function helpersShown(): { grid: boolean; axes: boolean; bounds: boolean } {
  return {
    grid: preferences.grid ?? true,
    axes: preferences.axes ?? false,
    bounds: preferences.bounds ?? false,
  };
}

function setHelpers(change: { grid?: boolean; axes?: boolean; bounds?: boolean }): void {
  savePreferences(change);
  shownView?.setHelpers(helpersShown());
}

/** Clears the view to the background picked, and draws the helpers to show on it. */
function showBackground(): void {
  const background = preferences.background ?? 'theme';
  if (background === 'theme') delete shell.viewport.dataset.background;
  else shell.viewport.dataset.background = background;
  shownView?.setBackground(viewportBackground(shell.viewport));
  shownView?.setHelperColors(helperColors(shell.viewport));
}

function setBackground(background: Background): void {
  savePreferences({ background });
  showBackground();
}

function receiveStructure(message: StructureMessage): void {
  if (message.loadId < latestLoad || !opened) return;
  latestLoad = message.loadId;
  structureLoad = message.loadId;
  structure?.setStructure(message, opened.fileName, opened.format);
  // The new file's animations are read next; until then nothing is said about them.
  animationBar?.setMotion([]);
  shell.setPanelsAvailable(true);
}

/** Says in the inspector, and next to the clip in the bar, which animations move nothing. */
function receiveMotion(motion: readonly (Motion | null)[]): void {
  structure?.setMotion(motion);
  animationBar?.setMotion(motion);
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
  const titles = Object.fromEntries(
    STANDARD_VIEWS.map((name) => [name, `${text.view.views[name]} (${SHORTCUTS[name]})`]),
  ) as Record<StandardView, string>;
  const gizmo = new Gizmo(titles, (name) => created.look(name));
  shell.viewport.append(gizmo.element);
  const created = new scene.ModelView(shell.viewport, canvas, context, {
    picked: (node, frame) => {
      // The structure shows what was picked, and tells the view to highlight it.
      structure?.select(node === undefined ? 'model' : `node:${node}`);
      if (frame) created.frameSelection();
    },
    animation: (state) =>
      animationBar?.update(state && { ...state, names: structure?.animationNames() ?? [] }),
    measured: (size, selection) => shell.setSize(size, selection, (value) => metres.metres(value)),
    menu: (node, x, y) => {
      menuKey = node === undefined ? 'model' : `node:${node}`;
      markMenuTarget(undefined);
      // VS Code opens its menu for a context menu event no one has handled.
      viewContextMenu = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
      });
      shell.viewport.dispatchEvent(viewContextMenu);
    },
    turned: (rotation) => gizmo.update(rotation),
  });
  shownView = created;
  shell.viewButton.hidden = false;
  shell.shadingButton.hidden = false;
  created.setBackground(viewportBackground(shell.viewport));
  created.setHighlightColor(highlightColor());
  created.setHelperColors(helperColors(shell.viewport));
  created.setHelpers(helpersShown());
  created.select(selectedKey);
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
    target.show(gltf, current.message.reload && hasModel);
    // A texture selected before the model was drawn can show its image now.
    structure?.refresh();
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
