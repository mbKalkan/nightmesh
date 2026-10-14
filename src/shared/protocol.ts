// Messages exchanged between the extension host and the webview.

export type ModelFormat = 'glb' | 'gltf';

/** Kinds of things in a model, as the structure tree and inspector name them. */
export type StructureKind =
  | 'model'
  | 'scene'
  | 'node'
  | 'mesh'
  | 'primitive'
  | 'material'
  | 'texture'
  | 'image'
  | 'sampler'
  | 'animation'
  | 'skin'
  | 'camera'
  | 'light';

/** Groups in the structure tree. */
export type StructureGroup =
  | 'nodes'
  | 'otherNodes'
  | 'meshes'
  | 'materials'
  | 'textures'
  | 'animations'
  | 'skins'
  | 'cameras'
  | 'lights';

/**
 * Words for the structure tree and inspector. glTF's own property names (`baseColorFactor`,
 * `translation`) are shown as they are, like the file and the specification spell them; these
 * are the rest. `{0}` is filled in by the webview.
 */
export interface StructureStrings {
  structure: string;
  inspector: string;
  statistics: string;
  /** What the statistics count, above them. */
  statisticsNote: string;
  structureWidth: string;
  inspectorWidth: string;
  kinds: Record<StructureKind, string>;
  groups: Record<StructureGroup, string>;
  /** What each kind of motion means, in the inspector and the animation bar's tooltip. */
  motion: Record<Motion, string>;
  sections: {
    file: string;
    contents: string;
    transform: string;
    extensions: string;
    extras: string;
    usedBy: string;
    channels: string;
    joints: string;
  };
  labels: {
    container: string;
    fileSize: string;
    jsonChunk: string;
    binaryChunk: string;
    children: string;
    nodes: string;
    primitives: string;
    vertices: string;
    triangles: string;
    lines: string;
    points: string;
    rotationDegrees: string;
    motion: string;
    /** The animation summary in the statistics. */
    longest: string;
    keyframes: string;
    animatedNodes: string;
    stillClips: string;
    instances: string;
    drawCalls: string;
    dimensions: string;
    total: string;
    mipLevels: string;
    /** Estimates: values show with ≈. */
    gpuMemory: string;
    textureMemory: string;
    /** Why a KTX2 texture has no preview. */
    noPreview: string;
    duration: string;
    size: string;
    required: string;
    /** `{0}` more, after a list cut short. */
    more: string;
    /** Where a node is in a copied reference: `under {0}`, the nodes above it. */
    under: string;
  };
}

/** Words for the animation bar below the view. */
export interface AnimationStrings {
  bar: string;
  clip: string;
  play: string;
  pause: string;
  time: string;
  speed: string;
  /** Short notes next to a clip that moves nothing; the inspector has the longer ones. */
  motion: Record<Exclude<Motion, 'moves'>, string>;
}

/** The six views straight along an axis: a glTF model's front faces +Z, with +Y up. */
export type StandardView = 'front' | 'back' | 'right' | 'left' | 'top' | 'bottom';

export type Projection = 'perspective' | 'orthographic';

/** How the model is drawn: lit as its materials say, unlit, or colored by its normals. */
export type ShadingMode = 'lit' | 'unlit' | 'normals';

/** The Shading menu. */
export interface ShadingStrings {
  menu: string;
  modes: Record<ShadingMode, string>;
  wireframe: string;
  /** No KHR_materials_variants variant picked: the materials the meshes name. */
  defaultVariant: string;
  /** A variant with no name: `Variant {0}`. */
  variant: string;
}

/** The View menu, and the axes gizmo's tooltips. */
export interface ViewStrings {
  menu: string;
  views: Record<StandardView, string>;
  projections: Record<Projection, string>;
  grid: string;
  /** The grid with its cell size: `Grid ({0} squares)`. */
  gridCell: string;
  axes: string;
  bounds: string;
  backgrounds: Record<Background, string>;
}

/** Which side panels show and how wide they are. */
export interface PanelLayout {
  structure: boolean;
  inspector: boolean;
  structureWidth: number;
  inspectorWidth: number;
  /** The right panel's tab: `inspector` or `statistics`. */
  inspectorTab: string;
}

/**
 * What the user set in a viewer, for the next ones to start with: the extension keeps it across
 * files and sessions. Anything left out takes its default.
 */
export interface Preferences {
  layout?: Partial<PanelLayout>;
  grid?: boolean;
  axes?: boolean;
  bounds?: boolean;
  background?: Background;
}

/** What the view clears to: the theme's editor background, or a fixed shade. */
export type Background = 'theme' | 'dark' | 'neutral' | 'light';

/** UI strings localized by the extension host and handed to the webview. */
export interface ViewerStrings {
  loading: string;
  /** How much of the model has arrived: `{0} of {1}`. */
  loadingBytes: string;
  /** Every byte is in; the model is being built and sent to the GPU. */
  preparing: string;
  largeTitle: string;
  /** Why a large model waits to be drawn: `{0}` is how many bytes it sends. */
  largeMessage: string;
  draw: string;
  errorTitle: string;
  errorWebGL: string;
  errorContextLost: string;
  errorRender: string;
  /** Title of the notice listing what couldn't be loaded. */
  partialTitle: string;
  close: string;
  /** The toolbar button that frames the selection, with its shortcut. */
  frame: string;
  /** What the size in the corner of the view measures. */
  modelSize: string;
  selectionSize: string;
  structure: StructureStrings;
  animation: AnimationStrings;
  view: ViewStrings;
  shading: ShadingStrings;
}

/** Sent once the webview is ready: what file this is. */
export interface OpenMessage {
  type: 'open';
  fileName: string;
  format: ModelFormat;
  /** VS Code's display language, for formatting numbers. */
  locale: string;
  strings: ViewerStrings;
  preferences: Preferences;
}

/**
 * The model's glTF JSON as the file has it, sent as soon as it is read, before anything else is:
 * the scene tree and inspector show it while the bytes to draw it are on their way, and when the
 * model can't be drawn at all.
 */
export interface StructureMessage {
  type: 'structure';
  loadId: number;
  reload: boolean;
  json: string;
  fileSize: number;
  /** A GLB's chunk sizes in bytes, as its header gives them. */
  chunks?: { json: number; bin?: number };
}

/** An image's size and format, as its file's header gives them. */
export interface ImageInfo {
  format: 'png' | 'jpeg' | 'webp' | 'ktx2' | 'avif' | 'gif';
  width: number;
  height: number;
  /** Mipmap levels stored in the file (KTX2); others are generated on the GPU. */
  levels?: number;
}

/** The model's images, by index: null where an image's size couldn't be read. */
export interface ImagesMessage {
  type: 'images';
  loadId: number;
  images: (ImageInfo | null)[];
}

/**
 * What an animation does when it plays: `moves` something over time, `holds` one pose other than
 * the model's rest pose, or moves `none` of it, every keyframe matching the rest pose.
 */
export type Motion = 'moves' | 'holds' | 'none';

/** Each animation's motion, by index: null where its keyframes couldn't be read. */
export interface AnimationsMessage {
  type: 'animations';
  loadId: number;
  motion: (Motion | null)[];
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
  /** `extensionsUsed`, so the webview can load the decoders it needs while bytes arrive. */
  extensions: string[];
  parts: number;
  bytes: number;
  /** What couldn't be loaded, in sentences for the user; empty when all of it could. */
  notices: string[];
}

/**
 * The model is large enough that drawing it takes long and a lot of memory: the host waits for a
 * `draw` from the webview before it sends it. Its structure and statistics are shown already.
 */
export interface LargeMessage {
  type: 'large';
  loadId: number;
  bytes: number;
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
  | OpenMessage
  | StructureMessage
  | ImagesMessage
  | AnimationsMessage
  | ModelMessage
  | LargeMessage
  | PartMessage
  | PartsMessage
  | FailedMessage
  | CopyReferenceMessage;

/**
 * Asks for a reference to copy: to what was right-clicked when the context menu ran the command
 * (`atPointer`), to the selection otherwise. With `details`, what the inspector says about it.
 */
export interface CopyReferenceMessage {
  type: 'copyReference';
  details: boolean;
  atPointer: boolean;
}

export type WebviewToHostMessage =
  | { type: 'ready' }
  /** The GPU context came back; the model has to be sent again to be drawn. */
  | { type: 'reload' }
  /** The user asked to draw a large model after all. */
  | { type: 'draw' }
  /**
   * A place in the model to put on the clipboard, for a chat with an AI assistant or a note: the
   * host puts the file's path first. No `location` means the model itself.
   */
  | { type: 'reference'; location?: string; details?: string }
  /** The user changed a preference; the host keeps them all for the next viewer. */
  | { type: 'preferences'; preferences: Preferences };
