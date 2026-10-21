// Messages exchanged between the extension host and the webview.

/** Formats read into glTF on the way in: they have no structure of their own beyond geometry. */
export type MeshFormat = 'obj' | 'stl' | 'ply';

export type ModelFormat = 'glb' | 'gltf' | MeshFormat;

/**
 * What an OBJ, STL or PLY file says about itself, for the inspector: the glTF the panels show for
 * it is made up on the way in.
 */
export type SourceFacts = StlFacts | PlyFacts | ObjFacts;

export interface StlFacts {
  format: 'stl';
  encoding: 'binary' | 'ascii';
  /** A binary file's 80-byte header as text, when it is text. */
  header?: string;
  /** The names an ASCII file gives its solids, in order. */
  solids?: string[];
  /** Facets: what a binary file's header declares, or what an ASCII file has. */
  triangles: number;
  /** The facets carry colors, in Materialise Magics' convention. */
  colors?: boolean;
}

export interface PlyFacts {
  format: 'ply';
  encoding: 'ascii' | 'binary_little_endian' | 'binary_big_endian';
  version: string;
  comments: string[];
  objInfo: string[];
  /** Each element with its count and properties as the header declares them: `float x`. */
  elements: { name: string; count: number; properties: string[] }[];
}

export interface ObjFacts {
  format: 'obj';
  /** How many of each statement the file has, by keyword: `v`, `vt`, `f`, `usemtl`… */
  statements: Record<string, number>;
  /** Comments before the first statement, where exporters say who they are. */
  comments: string[];
  /** The material libraries the file names. */
  mtllibs: string[];
  /** Each material's MTL statements as written, by glTF material index; empty if none found. */
  materials: { library?: string; statements: [string, string][] }[];
}

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
    /** What the glTF Validator found, in the model's details. */
    validation: string;
  };
  /** What an OBJ, STL or PLY file says about itself. */
  source: SourceStrings;
}

/** Words for what an OBJ, STL or PLY file says about itself, in the inspector. */
export interface SourceStrings {
  format: string;
  encoding: string;
  encodings: Record<'binary' | 'ascii' | 'binary_little_endian' | 'binary_big_endian', string>;
  version: string;
  header: string;
  /** The PLY header's elements, as a section. */
  elements: string;
  solids: string;
  facets: string;
  colors: string;
  /** STL facet colors as Materialise Magics writes them. */
  materialise: string;
  comments: string;
  libraries: string;
  /** OBJ's statements, as a section: how many of each. */
  statements: string;
  /** Next to statements that are read but not drawn. */
  notDrawn: string;
  /** A material an OBJ file uses that its libraries don't define. */
  notDefined: string;
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
  /** For OBJ, STL and PLY, which don't say: which axis is up, and the units. */
  up: Record<UpAxis, string>;
  units: Record<LengthUnit, string>;
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
  /** The units and up axis picked for each of OBJ, STL and PLY, which don't say theirs. */
  units?: Partial<Record<MeshFormat, Units>>;
}

export type LengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';
export type UpAxis = 'y' | 'z';

/** What a file's coordinates are in, and which of its axes points up. */
export interface Units {
  unit: LengthUnit;
  up: UpAxis;
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
  /** The same for a file that is read before it is drawn: OBJ, STL and PLY. */
  largeReadMessage: string;
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
  /** The toolbar button that opens the glTF JSON beside the viewer. */
  showJson: string;
  /** What the keys do in the view, for screen readers when it takes the focus. */
  viewKeys: string;
  /** What the size in the corner of the view measures. */
  modelSize: string;
  selectionSize: string;
  structure: StructureStrings;
  validation: ValidationStrings;
  size: SizeStrings;
  report: ReportStrings;
  export: ExportStrings;
  animation: AnimationStrings;
  view: ViewStrings;
  shading: ShadingStrings;
}

/** How much a validation issue matters, from the glTF Validator's report. */
export type Severity = 'error' | 'warning' | 'info' | 'hint';

/** One thing the glTF Validator found: where in the JSON (`pointer`) or in a GLB (`offset`). */
export interface ValidationIssue {
  code: string;
  message: string;
  severity: Severity;
  /** A JSON pointer into the model's glTF JSON, as `/meshes/0/primitives/1`. */
  pointer?: string;
  /** A byte offset in a GLB file, for problems with its container. */
  offset?: number;
}

/** What the Khronos glTF Validator says about a model. */
export interface ValidationReport {
  /** The validator's version. */
  validator: string;
  counts: Record<Severity, number>;
  /** Errors first, then warnings, infos and hints; the validator's order within each. */
  issues: ValidationIssue[];
  /** The validator stopped reporting at its limit: there are more issues than listed. */
  truncated: boolean;
}

/**
 * The validation of a load: `running` while the validator reads the model, then its report;
 * `tooLarge` past the bytes the validator can hold, `failed` when it couldn't read the file.
 */
export type ValidationMessage = { type: 'validation'; loadId: number } & (
  | { state: 'running' }
  | { state: 'done'; report: ValidationReport }
  | { state: 'tooLarge'; bytes: number }
  | { state: 'failed' }
);

/** Words for the validation tab. */
export interface ValidationStrings {
  tab: string;
  /** Before the validator has started: the model is still loading. */
  waiting: string;
  running: string;
  /** `{0}`: the validator's version. */
  validator: string;
  /** `{0}`: the model's size. */
  tooLarge: string;
  failed: string;
  noIssues: string;
  /** `{0}`: how many issues were listed before the validator stopped. */
  truncated: string;
  /** Where an issue is in a GLB file: `Byte {0}`. */
  offset: string;
  /** The filter buttons, with a count: `Errors`. */
  severities: Record<Severity, string>;
  /** One issue's severity, for screen readers. */
  severity: Record<Severity, string>;
  /** What the count on the tab is: `Errors: {0}, warnings: {1}`. */
  badge: string;
  showInJson: string;
}

/** Where a model's bytes go, by what they are for. */
export type SizeCategory =
  | 'json'
  | 'vertices'
  | 'indices'
  | 'morphTargets'
  | 'animation'
  | 'skins'
  | 'instancing'
  | 'textures'
  | 'unused'
  | 'other';

/** What a suggestion in the size tab is about. */
export type SuggestionKind =
  'geometry' | 'textureMemory' | 'textureDownload' | 'textureSize' | 'unused';

/** Words for the size tab. `{0}` and `{1}` are filled in by the webview. */
export interface SizeStrings {
  tab: string;
  /** `{0}`: the bytes. */
  totalOne: string;
  /** `{0}`: the bytes, `{1}`: how many files. */
  totalMany: string;
  breakdown: string;
  categories: Record<SizeCategory, string>;
  compression: string;
  geometry: string;
  /** `{0}` of `{1}` primitives. */
  draco: string;
  /** `{0}` of `{1}` bufferViews. */
  meshopt: string;
  quantized: string;
  none: string;
  gpuMemory: string;
  largest: string;
  images: string;
  imageWarnings: { large: string; notPowerOfTwo: string };
  unusedImage: string;
  suggestions: string;
  suggestionsNote: string;
  /** Each suggestion's title and why, `{0}` the bytes it is about. */
  suggestion: Record<SuggestionKind, { title: string; text: string }>;
  copy: string;
}

/** Words in a saved report that the tabs don't already have. */
export interface ReportStrings {
  generated: string;
  name: string;
  share: string;
  format: string;
  pixels: string;
  notes: string;
  severity: string;
  code: string;
  message: string;
  where: string;
  /** The report was saved before the validator had run. */
  notValidated: string;
}

/** The Export menu in the toolbar. */
export interface ExportStrings {
  menu: string;
  screenshot: string;
  report: string;
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
  /** What an OBJ, STL or PLY file says about itself; its glTF was made from it. */
  source?: SourceFacts;
}

/** How much of an OBJ, STL or PLY file has been read, before there is a model to send. */
export interface ProgressMessage {
  type: 'progress';
  loadId: number;
  done: number;
  total: number;
}

/** An image's size and format, as its file's header gives them. */
export interface ImageInfo {
  format: 'png' | 'jpeg' | 'webp' | 'ktx2' | 'avif' | 'gif' | 'bmp';
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
  /** How many bytes each image takes in its file, or its own; null where it couldn't be had. */
  bytes: (number | null)[];
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
  | ProgressMessage
  | ImagesMessage
  | AnimationsMessage
  | ModelMessage
  | LargeMessage
  | PartMessage
  | PartsMessage
  | FailedMessage
  | ValidationMessage
  | CopyReferenceMessage
  /** Asks for what to show in the glTF JSON: as `copyReference` does for a reference. */
  | { type: 'showJson'; atPointer: boolean }
  /** The cursor moved in the glTF JSON document: select what it is in. */
  | { type: 'select'; pointer: string }
  /** A command asks for a screenshot or a report to save. */
  | { type: 'export'; what: 'screenshot' | 'report' };

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
  /** Show the glTF JSON beside the viewer, at what a JSON pointer names. */
  | { type: 'json'; pointer: string }
  /** The selection changed: an open glTF JSON document follows it. */
  | { type: 'selected'; pointer: string }
  /** A screenshot to save, as a PNG; no data when there is no 3D view. */
  | { type: 'save'; what: 'screenshot'; data?: Uint8Array }
  /** A report to save, in both formats: the user picks one in the save dialog. */
  | { type: 'save'; what: 'report'; markdown: string; json: string }
  /** Text for the clipboard, such as a command the size tab suggests. */
  | { type: 'copy'; text: string }
  /** The user changed a preference; the host keeps them all for the next viewer. */
  | { type: 'preferences'; preferences: Preferences };
