// Messages exchanged between the extension host and the webview.

/** Formats read into glTF on the way in: they have no structure of their own beyond geometry. */
export type MeshFormat = 'obj' | 'stl' | 'ply' | 'pnts';

export type ModelFormat = 'glb' | 'gltf' | MeshFormat | 'b3dm' | 'i3dm' | 'cmpt' | 'tileset';

/** What a 3D Tiles tile file says in its header and its feature and batch tables. */
export interface TileTables {
  version: number;
  /** The header's bytes: 28, or 20 or 24 in the layouts of files older than 3D Tiles 1.0. */
  header: number;
  featureTable: { json: number; binary: number };
  batchTable: { json: number; binary: number };
  /** How many features the batch IDs count. */
  batchLength: number;
  /** The point the model's positions are relative to, in the tileset's frame. */
  rtcCenter?: [number, number, number];
  /** The batch table's properties, each with what it holds: `JSON` or `FLOAT VEC3`. */
  properties: { name: string; type: string }[];
  /** The tables' extensions, such as `3DTILES_batch_table_hierarchy`. */
  extensions: string[];
}

/**
 * What a Batched (b3dm) or Instanced (i3dm) 3D Model tile says around the GLB it holds, for the
 * inspector: the panels show the GLB as they show any other.
 */
export interface TileFacts extends TileTables {
  format: 'b3dm' | 'i3dm';
  /** An i3dm tile's instances. */
  instances?: number;
  /** What an i3dm tile's feature table gives: `POSITION`, `NORMAL_UP`, `EAST_NORTH_UP`… */
  semantics?: string[];
  /** The glTF file an i3dm tile names, when it doesn't hold its glTF itself. */
  gltfUri?: string;
  /** That file's size, once it is opened: the panels show its glTF. */
  gltfBytes?: number;
}

/** What a Composite (cmpt) tile holds: its tiles, those in inner composites too. */
export interface CmptFacts {
  format: 'cmpt';
  version: number;
  header: number;
  /** Each tile by where it is among the others (`2/1`: the first in the second), and its kind. */
  tiles: { path: string; format: string; bytes: number }[];
}

/** What a Point Cloud (pnts) tile says about itself; its glTF was made from its points. */
export interface PntsFacts extends TileTables {
  format: 'pnts';
  points: number;
  /** What the feature table gives, by name: `POSITION`, `RGB`, `RTC_CENTER`… */
  semantics: string[];
}

/**
 * What an OBJ, STL or PLY file says about itself, for the inspector: the glTF the panels show for
 * it is made up on the way in.
 */
export type SourceFacts = StlFacts | PlyFacts | ObjFacts | PntsFacts;

/**
 * What a 3D printing check finds in an OBJ, STL or PLY file's triangles, with corners at the same
 * place taken as one vertex. Lengths are in the file's own units.
 */
export interface MeshCheck {
  triangles: number;
  area: number;
  /** What the surface holds, when it is closed and its faces wound alike: negative inside out. */
  volume?: number;
  /** Pieces that share no vertex. */
  shells: number;
  /** Triangles with a corner twice, which have no area and no edges. */
  degenerate: number;
  /** Edges of one face only: the rims of holes. */
  openEdges: number;
  /** Edges of more than two faces. */
  nonManifoldEdges: number;
  /** Edges whose two faces are wound the same way along it: one of them faces the wrong way. */
  flippedEdges: number;
}

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
  tile: TileFileStrings;
  compare: CompareStrings;
}

/** Words for what a b3dm tile says around the GLB it holds, in the inspector. */
export interface TileFileStrings {
  /** The section's title: the format's name. */
  section: string;
  version: string;
  header: string;
  /** After a header from before 3D Tiles 1.0. */
  legacy: string;
  featureTable: string;
  batchTable: string;
  /** A table's sizes: `{0}` JSON and `{1}` binary. */
  table: string;
  features: string;
  center: string;
  /** Why the view doesn't move the model to its center. */
  centerNote: string;
  properties: string;
  extensions: string;
  /** The pnts format's name. */
  pointCloud: string;
  /** What a pnts or i3dm tile's feature table gives: `POSITION`, `RGB`… */
  semantics: string;
  /** The i3dm format's name. */
  instanced: string;
  instances: string;
  /** The glTF file an i3dm tile names, when it doesn't hold its glTF itself. */
  gltfFile: string;
  /** The section of a feature clicked in the view. */
  feature: string;
  /** Its row: its batch id, `12`, noted `of 340`. */
  featureId: string;
  /** `of {0}` features. */
  featureOf: string;
  /** A note on a property a feature takes from a class of the batch table hierarchy. */
  featureClass: string;
  /** The section of a feature of one of a primitive's feature ID sets: `{0}` its label. */
  featureNamed: string;
  /** Its row: its feature ID, `2`, noted `of 4`. */
  featureIdSet: string;
  /** The metadata class of the properties shown. */
  metadataClass: string;
  /** Sections of what a property texture, or property attributes, give at the point clicked. */
  textureProperties: string;
  vertexProperties: string;
  pointProperties: string;
  /** Rows of the vertex or point clicked, by its number. */
  vertex: string;
  point: string;
  /** The cmpt format's name. */
  composite: string;
  tiles: string;
}

/** Words for the Changes tab and the tree's marks, while two versions of a model are compared. */
export interface CompareStrings {
  tab: string;
  /** How the two versions are compared, above the changes. */
  note: string;
  /** Until the other version's summary arrives. */
  waiting: string;
  none: string;
  /** How many changes: one, and `{0}` for any other number. */
  one: string;
  many: string;
  added: string;
  removed: string;
  changed: string;
  /** On what holds a change: a group, a scene, the nodes above a changed one. */
  contains: string;
  /** What changed about a thing, beside glTF's own property names. */
  visibility: string;
  geometry: string;
  bounds: string;
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
  /** The check of the triangles, as a section, and its rows. */
  check: string;
  area: string;
  volume: string;
  /** Next to a volume whose faces point inward. */
  insideOut: string;
  watertight: string;
  yes: string;
  no: string;
  openEdges: string;
  nonManifoldEdges: string;
  flippedEdges: string;
  shells: string;
  degenerate: string;
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
  /** A tile that came but couldn't be drawn; `{0}` is its file name. */
  tileDamaged: string;
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
  measure: MeasureStrings;
  structure: StructureStrings;
  tileset: TilesetStrings;
  validation: ValidationStrings;
  size: SizeStrings;
  report: ReportStrings;
  export: ExportStrings;
  animation: AnimationStrings;
  view: ViewStrings;
  shading: ShadingStrings;
}

/** What a tile's content is, by its file. */
export type TileContentKind =
  'b3dm' | 'i3dm' | 'pnts' | 'cmpt' | 'glb' | 'gltf' | 'tileset' | 'subtree' | 'other';

/** Where a tile is in the renderer: its content loading, loaded or failed, or none asked for. */
export type TileState = 'unloaded' | 'queued' | 'loading' | 'parsing' | 'loaded' | 'failed';

/** Words for a tileset's metadata (D-058): its schema, entities and statistics. */
export interface TilesetMetadataStrings {
  /** The section of the tileset's or a tile's own metadata. */
  section: string;
  schema: string;
  statisticsTitle: string;
  featureProperties: string;
  /** The metadata of the implicit subtree a tile is the first of. */
  subtree: string;
  content: string;
  /** A content's, when the tile has several: `Content metadata ({0})`. */
  contentOf: string;
  /** A group's section: `Group {0}`. */
  group: string;
  groupLabel: string;
  className: string;
  id: string;
  name: string;
  description: string;
  version: string;
  file: string;
  classes: string;
  enums: string;
  groups: string;
  /** How many entities of a class there are: `{0} entities`. */
  entities: string;
  /** Notes after a value the class gave, not the entity. */
  defaultValue: string;
  noData: string;
  /** `{0} to {1}` */
  range: string;
  statistics: Record<
    'min' | 'max' | 'mean' | 'median' | 'standardDeviation' | 'variance' | 'sum',
    string
  >;
}

/** Words for a 3D Tiles tileset's tree and inspector (D-046). */
export interface TilesetStrings {
  /** The tree, as screen readers name it. */
  tree: string;
  /** What the top entry is. */
  tileset: string;
  /** What a tile is, and a tile without content's label: `Tile 0/2`. */
  tile: string;
  sections: {
    tileset: string;
    tiles: string;
    tile: string;
    content: string;
    volume: string;
    implicit: string;
    /** What the renderer has of it now. */
    live: string;
  };
  labels: {
    version: string;
    generator: string;
    tilesetVersion: string;
    geometricError: string;
    extensionsUsed: string;
    extensionsRequired: string;
    tiles: string;
    depth: string;
    withContent: string;
    externalTilesets: string;
    implicitRoots: string;
    /** Tiles of external tilesets and implicit tiling, listed as the renderer reads them. */
    found: string;
    path: string;
    refine: string;
    /** After a refinement the tile takes from above it. */
    inherited: string;
    children: string;
    volumeType: string;
    center: string;
    halfAxes: string;
    radius: string;
    west: string;
    south: string;
    east: string;
    north: string;
    minHeight: string;
    maxHeight: string;
    transform: string;
    requestVolume: string;
    scheme: string;
    subtreeLevels: string;
    availableLevels: string;
    subtrees: string;
    /** An implicit tile's level and coordinates in its tree. */
    level: string;
    coordinates: string;
    state: string;
    drawn: string;
    screenError: string;
    loaded: string;
    drawnTiles: string;
    downloading: string;
    failed: string;
    memory: string;
    yes: string;
    no: string;
  };
  volumes: Record<'box' | 'region' | 'sphere', string>;
  contents: Record<TileContentKind, string>;
  metadata: TilesetMetadataStrings;
  states: Record<TileState, string>;
  /** Screen-space error, in pixels: `{0} px`. */
  pixels: string;
}

/** Measuring the distance between two points clicked on the model. */
export interface MeasureStrings {
  /** The toolbar button, with its shortcut. */
  button: string;
  /** What to click next, in the corner of the view. */
  first: string;
  second: string;
  /** What the corner of the view shows once both points are placed. */
  distance: string;
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
  | 'tile'
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
  /** The lighting environment a viewer made before, kept by the host for the next ones. */
  environment?: Environment;
}

/**
 * The prefiltered environment the 3D view lights models with (three.js PMREM, CubeUV layout),
 * as half floats, four to a texel. Making it takes most of a second of shader work on some
 * GPUs; uploading it takes milliseconds. `key` says how it was made.
 */
export interface Environment {
  key: string;
  width: number;
  height: number;
  data: Uint8Array;
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
  /**
   * What a b3dm or i3dm tile says around the GLB it holds, or what a cmpt tile holds;
   * `fileSize` is the tile's.
   */
  tile?: TileFacts | CmptFacts;
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
 * Nodes drawn with GPU instances (EXT_mesh_gpu_instancing), each with the box around all its
 * instances in the node's own space, read from their transforms in the binary data. Nodes whose
 * transforms couldn't be read aren't listed.
 */
export interface InstancesMessage {
  type: 'instances';
  loadId: number;
  nodes: { node: number; min: number[]; max: number[] }[];
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

/**
 * A 3D Tiles tileset to draw (D-046), in place of `structure` and `model`: the webview walks its
 * tiles and asks for each one it needs with a `tile` request.
 */
export interface TilesetMessage {
  type: 'tileset';
  loadId: number;
  reload: boolean;
  /** The tileset's path for `tile` requests; references in it resolve against this. */
  url: string;
  json: string;
  fileSize: number;
  /** The metadata schema, when the tileset gives it as a file of its own (D-058). */
  schema?: object;
  /** What couldn't be read, in sentences: a schema file. */
  notices?: string[];
}

/** The bytes of a tile the webview asked for, or why it can't have them, in a sentence. */
export type TileMessage = { type: 'tile'; id: number } & (
  { data: Uint8Array } | { problem: string }
);

/**
 * A b3dm, i3dm or pnts tile's feature and batch tables, each its JSON then its binary body, for
 * the webview to read a clicked feature's properties from.
 */
export interface TileTablesBytes {
  format: 'b3dm' | 'i3dm' | 'pnts';
  feature: { bytes: Uint8Array; json: number };
  batch: { bytes: Uint8Array; json: number };
}

/** The tables of the tile the webview asked for; none when it has none or can't be read. */
export interface TileTablesMessage {
  type: 'tileTables';
  id: number;
  tables?: TileTablesBytes;
}

/** The model can't be shown at all. */
export interface FailedMessage {
  type: 'failed';
  loadId: number;
  reload: boolean;
  message: string;
  details: string[];
}

/** Which side of a comparison a viewer is: the older version on the left, the newer right. */
export type DiffSide = 'original' | 'modified';

/** Where the camera is and what it sees, to put the other side of a comparison in the same place. */
export interface CameraState {
  projection: Projection;
  position: [number, number, number];
  /** The point the camera orbits. */
  target: [number, number, number];
  /** Perspective: the vertical field of view, in degrees. */
  fov: number;
  /** Orthographic: half the view's height at zoom 1, and the zoom. */
  height: number;
  zoom: number;
}

/** The kinds of things a comparison matches between two versions of a model. */
export type SummaryCollection = 'nodes' | 'meshes' | 'materials' | 'textures' | 'animations';

/** One thing in a model's summary. */
export interface SummaryEntry {
  /** What matches it in the other version: its name, with the names above it for a node. */
  key: string;
  /** Its glTF index in this version. */
  index: number;
  /** What it is, by aspect, written so that equal things read the same. */
  facets: Record<string, string>;
}

export interface SummaryTotals {
  fileSize: number;
  nodes: number;
  drawCalls: number;
  vertices: number;
  triangles: number;
  materials: number;
  textures: number;
}

/** A model in short, for the other side of a comparison to find what changed. */
export interface ModelSummary {
  totals: SummaryTotals;
  /** The scene's size along X, Y and Z, in metres. */
  dimensions?: number[];
  /** An OBJ, STL or PLY model's mesh check, in the file's units. */
  check?: MeshCheck;
  nodes: SummaryEntry[];
  meshes: SummaryEntry[];
  materials: SummaryEntry[];
  textures: SummaryEntry[];
  animations: SummaryEntry[];
}

/**
 * An entry of the structure as the other side of a comparison can find it: a thing it matches by
 * name, or else an entry key (`model`, `scene:0`, `group:meshes`).
 */
export interface CompareTarget {
  collection?: SummaryCollection;
  key: string;
}

/** The check of an OBJ, STL or PLY model's triangles, once its parts are sent. */
export interface MeshCheckMessage {
  type: 'meshCheck';
  loadId: number;
  check: MeshCheck;
}

export type HostToWebviewMessage =
  | OpenMessage
  | StructureMessage
  | ProgressMessage
  | ImagesMessage
  | AnimationsMessage
  | InstancesMessage
  | MeshCheckMessage
  | ModelMessage
  | TilesetMessage
  | TileMessage
  | TileTablesMessage
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
  | { type: 'export'; what: 'screenshot' | 'report' }
  /** The viewer is one side of a comparison, or no longer is. */
  | { type: 'diff'; side: DiffSide | undefined }
  /** The other side of the comparison moved its camera. */
  | { type: 'peerCamera'; camera: CameraState }
  /** The other side of the comparison, in short, to find what changed. */
  | { type: 'peerSummary'; summary: ModelSummary }
  /** The other side of the comparison selected something: select it here too. */
  | { type: 'peerSelect'; target: CompareTarget };

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
  /** The lighting environment the 3D view made, for the host to keep for the next viewers. */
  | { type: 'environment'; environment: Environment }
  /** A tile of the tileset shown, by a path made from `TilesetMessage.url` and its references. */
  | { type: 'tile'; id: number; path: string }
  /**
   * The feature and batch tables of the tile file shown, or of the tile at `part` inside it (a
   * composite's `2/1`), to read a clicked feature from.
   */
  | { type: 'tileTables'; id: number; part?: string }
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
  | { type: 'preferences'; preferences: Preferences }
  /** The camera moved, in a viewer that is one side of a comparison. */
  | { type: 'camera'; camera: CameraState }
  /** The model in short, in a viewer that is one side of a comparison, for the other side. */
  | { type: 'summary'; summary: ModelSummary }
  /** The selection changed, in a viewer that is one side of a comparison. */
  | { type: 'compareSelect'; target: CompareTarget };
