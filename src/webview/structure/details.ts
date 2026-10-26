import type {
  ImageInfo,
  MeshCheck,
  ModelFormat,
  Motion,
  SourceFacts,
  StructureKind,
  StructureStrings,
} from '../../shared/protocol';
import { fill, type Formatter } from './format';
import {
  fileName,
  isObject,
  num,
  numbers,
  objects,
  text,
  type Collection,
  type GltfModel,
  type JsonObject,
} from './gltf';
import { meshCounts, primitiveCounts } from './counts';
import { entryKey, parseKey, type EntryKey } from './outline';
import { meshBounds, nodeSize, nodesBounds, positionBounds, sizeOf } from './bounds';
import { drawnImage, textureMemory } from './textures';

/** Something the inspector shows a link to; following it selects that entry. */
export interface Link {
  text: string;
  key: EntryKey;
}

/** One line of the inspector: a label, and a value made of any of these parts. */
export interface Row {
  label: string;
  text?: string;
  /** Set the text in the editor's monospace font: it is a number or a value from the file. */
  mono?: boolean;
  links?: Link[];
  /** A CSS color, shown as a swatch before the text. */
  swatch?: string;
  /** Indented JSON shown below the label, for values with no simpler form. */
  json?: string;
  /** Dimmed text after the value. */
  note?: string;
  /** No label: the value takes the full width, for names too long to sit in the label column. */
  wide?: boolean;
}

export interface Section {
  title: string;
  rows: Row[];
}

export interface Inspection {
  title: string;
  /** What the entry is, and its index: "Node 12". */
  kind: string;
  sections: Section[];
  /** A texture whose image the inspector shows above its sections, once the view has it. */
  preview?: number;
}

export interface FileFacts {
  name: string;
  size: number;
  container: ModelFormat;
  chunks?: { json: number; bin?: number };
}

export interface InspectContext {
  model: GltfModel;
  strings: StructureStrings;
  format: Formatter;
  file: FileFacts;
  /** Image sizes by index, once the host has read them. */
  images?: readonly (ImageInfo | null)[];
  /** Whether each animation moves anything, once the host has read its keyframes. */
  motion?: readonly (Motion | null)[];
  /** What the glTF Validator found, in a few words, once it has run. */
  validation?: string;
  /** What an OBJ, STL or PLY file says about itself; its glTF was made from it. */
  source?: SourceFacts;
  /** The check of an OBJ, STL or PLY model's triangles, once the host has made it. */
  check?: MeshCheck;
}

/** Lists longer than this are cut short, with a count of the rest. */
const LIST_LIMIT = 100;
/** Primitives shown for one mesh. */
const PRIMITIVE_LIMIT = 64;
/** JSON longer than this is cut short. */
const JSON_LIMIT = 4000;

const MODES = [
  'POINTS',
  'LINES',
  'LINE_LOOP',
  'LINE_STRIP',
  'TRIANGLES',
  'TRIANGLE_STRIP',
  'TRIANGLE_FAN',
];
const COMPONENT_TYPES: Record<number, string> = {
  5120: 'BYTE',
  5121: 'UNSIGNED_BYTE',
  5122: 'SHORT',
  5123: 'UNSIGNED_SHORT',
  5125: 'UNSIGNED_INT',
  5126: 'FLOAT',
};
const FILTERS: Record<number, string> = {
  9728: 'NEAREST',
  9729: 'LINEAR',
  9984: 'NEAREST_MIPMAP_NEAREST',
  9985: 'LINEAR_MIPMAP_NEAREST',
  9986: 'NEAREST_MIPMAP_LINEAR',
  9987: 'LINEAR_MIPMAP_LINEAR',
};
const WRAPS: Record<number, string> = {
  33071: 'CLAMP_TO_EDGE',
  33648: 'MIRRORED_REPEAT',
  10497: 'REPEAT',
};

/** What the inspector shows for an entry; undefined when the model has no such thing. */
export function inspect(context: InspectContext, key: EntryKey): Inspection | undefined {
  if (key === 'model') return inspectModel(context);
  const parsed = parseKey(key);
  if (!parsed) return undefined;
  const inspector = INSPECTORS[parsed.kind];
  const collection = COLLECTIONS[parsed.kind];
  if (!inspector || !collection) return undefined;
  const size =
    collection === 'lights'
      ? context.model.lights().length
      : context.model.items(collection).length;
  if (parsed.index >= size) return undefined;
  return {
    title: nameOf(context, parsed.kind, parsed.index),
    kind: `${context.strings.kinds[parsed.kind]} ${parsed.index}`,
    sections: inspector(context, parsed.index).filter((section) => section.rows.length > 0),
    preview: parsed.kind === 'texture' ? parsed.index : undefined,
  };
}

const COLLECTIONS: Partial<Record<StructureKind, Collection | 'lights'>> = {
  scene: 'scenes',
  node: 'nodes',
  mesh: 'meshes',
  material: 'materials',
  texture: 'textures',
  animation: 'animations',
  skin: 'skins',
  camera: 'cameras',
  light: 'lights',
};

type Inspector = (context: InspectContext, index: number) => Section[];

const INSPECTORS: Partial<Record<StructureKind, Inspector>> = {
  scene: inspectScene,
  node: inspectNode,
  mesh: inspectMesh,
  material: inspectMaterial,
  texture: inspectTexture,
  animation: inspectAnimation,
  skin: inspectSkin,
  camera: inspectCamera,
  light: inspectLight,
};

function nameOf(context: InspectContext, kind: StructureKind, index: number): string {
  const collection = COLLECTIONS[kind];
  const name = collection ? context.model.displayName(collection, index) : undefined;
  return name ?? `${context.strings.kinds[kind]} ${index}`;
}

const link = (context: InspectContext, kind: StructureKind, index: number): Link => ({
  text: nameOf(context, kind, index),
  key: entryKey(kind, index),
});

/** Links to the first of `indices`, with a row saying how many more there are. */
function linkRows(
  context: InspectContext,
  label: string,
  kind: StructureKind,
  indices: readonly number[],
): Row[] {
  if (indices.length === 0) return [];
  const rows: Row[] = [
    { label, links: indices.slice(0, LIST_LIMIT).map((index) => link(context, kind, index)) },
  ];
  if (indices.length > LIST_LIMIT) rows.push(moreRow(context, indices.length - LIST_LIMIT));
  return rows;
}

const moreRow = (context: InspectContext, count: number): Row => ({
  label: '',
  text: fill(context.strings.labels.more, context.format.count(count)),
});

function inspectModel(context: InspectContext): Inspection {
  if (context.source) return inspectSource(context, context.source);
  const { model, strings, format, file } = context;
  const asset = isObject(model.root.asset) ? model.root.asset : {};
  const labels = strings.labels;
  const assetRows: Row[] = ['version', 'minVersion', 'generator', 'copyright'].flatMap((key) => {
    const value = text(asset[key]);
    return value === undefined ? [] : [{ label: key, text: value, mono: key.endsWith('ersion') }];
  });
  const defaultScene = model.ref('scenes', model.root.scene);
  if (defaultScene !== undefined) {
    assetRows.push({ label: 'scene', links: [link(context, 'scene', defaultScene)] });
  }

  const fileRows: Row[] = [
    { label: labels.container, text: file.container === 'glb' ? 'GLB' : 'glTF JSON' },
    { label: labels.fileSize, text: format.bytes(file.size), mono: true },
  ];
  if (file.chunks) {
    fileRows.push({ label: labels.jsonChunk, text: format.bytes(file.chunks.json), mono: true });
    if (file.chunks.bin !== undefined) {
      fileRows.push({ label: labels.binaryChunk, text: format.bytes(file.chunks.bin), mono: true });
    }
  }
  if (context.validation) fileRows.push({ label: labels.validation, text: context.validation });

  return {
    title: file.name,
    kind: strings.kinds.model,
    sections: [
      { title: strings.kinds.model, rows: assetRows },
      { title: strings.sections.file, rows: fileRows },
      contentsSection(context),
      {
        title: strings.sections.extensions,
        rows: used(model).map(({ name, required }) => ({
          label: '',
          wide: true,
          text: name,
          mono: true,
          note: required ? labels.required : undefined,
        })),
      },
      ...extrasSection(context, asset),
    ].filter((section) => section.rows.length > 0),
  };
}

/** The extensions a model uses, and whether it needs them to be drawn. */
function used(model: GltfModel): { name: string; required: boolean }[] {
  const required = new Set(
    Array.isArray(model.root.extensionsRequired) ? model.root.extensionsRequired : [],
  );
  return (Array.isArray(model.root.extensionsUsed) ? model.root.extensionsUsed : [])
    .filter((name): name is string => typeof name === 'string')
    .map((name) => ({ name, required: required.has(name) }));
}

/** How big the model is and how many of each thing it holds. */
function contentsSection(context: InspectContext): Section {
  const { model, strings, format } = context;
  const labels = strings.labels;
  const primitives = model
    .items('meshes')
    .reduce((sum, mesh) => sum + objects(mesh.primitives).length, 0);
  const counts: [string, number][] = [
    [strings.groups.nodes, model.items('nodes').length],
    [strings.groups.meshes, model.items('meshes').length],
    [labels.primitives, primitives],
    [strings.groups.materials, model.items('materials').length],
    [strings.groups.textures, model.items('textures').length],
    [strings.groups.animations, model.items('animations').length],
    [strings.groups.skins, model.items('skins').length],
    [strings.groups.cameras, model.items('cameras').length],
    [strings.groups.lights, model.lights().length],
  ];
  return {
    title: strings.sections.contents,
    rows: [
      ...dimensionRows(context, sceneNodes(model)),
      ...counts.flatMap(([label, count]) =>
        count > 0 ? [{ label, text: format.count(count), mono: true }] : [],
      ),
    ],
  };
}

const SOURCE_FORMATS: Record<SourceFacts['format'], string> = {
  obj: 'Wavefront OBJ',
  stl: 'STL',
  ply: 'PLY',
};

/** OBJ statements Nightmesh draws or reads; the others are listed as not drawn. */
const READ_STATEMENTS = ['v', 'vt', 'vn', 'f', 'l', 'p', 'o', 'g', 's', 'usemtl', 'mtllib'];

/** Comments and header lines shown, at most. */
const COMMENT_LIMIT = 20;

/**
 * An OBJ, STL or PLY model: what its file says about itself in place of glTF's asset and
 * extensions, which it doesn't have.
 */
function inspectSource(context: InspectContext, source: SourceFacts): Inspection {
  const { strings, format, file } = context;
  const words = strings.source;
  const fileRows: Row[] = [{ label: words.format, text: SOURCE_FORMATS[source.format] }];
  if (source.format !== 'obj') {
    fileRows.push({ label: words.encoding, text: words.encodings[source.encoding] });
  }
  if (source.format === 'ply' && source.version) {
    fileRows.push({ label: words.version, text: source.version, mono: true });
  }
  fileRows.push({ label: strings.labels.fileSize, text: format.bytes(file.size), mono: true });
  const sections: Section[] = [{ title: strings.sections.file, rows: fileRows }];
  const comments: string[] = [];

  if (source.format === 'stl') {
    if (source.header) fileRows.push({ label: words.header, text: source.header });
    const names = (source.solids ?? []).filter(Boolean);
    if (names.length > 0) fileRows.push({ label: words.solids, text: names.join(', ') });
    if (source.triangles > 0) {
      fileRows.push({ label: words.facets, text: format.count(source.triangles), mono: true });
    }
    if (source.colors) fileRows.push({ label: words.colors, text: words.materialise });
  } else if (source.format === 'ply') {
    comments.push(...source.comments, ...source.objInfo);
    sections.push({
      title: words.elements,
      rows: source.elements.flatMap(({ name, count, properties }): Row[] => [
        { label: name, text: format.count(count), mono: true },
        ...(properties.length > 0 ? [{ label: '', text: properties.join(' · '), mono: true }] : []),
      ]),
    });
  } else {
    comments.push(...source.comments);
    fileRows.push(
      ...source.mtllibs.map((name, index) => ({
        label: index === 0 ? words.libraries : '',
        text: name,
        mono: true,
      })),
    );
    const keywords = Object.keys(source.statements).sort((a, b) => {
      const order = (keyword: string) => {
        const at = READ_STATEMENTS.indexOf(keyword);
        return at < 0 ? READ_STATEMENTS.length : at;
      };
      return order(a) - order(b) || a.localeCompare(b);
    });
    sections.push({
      title: words.statements,
      rows: keywords.map((keyword) => ({
        label: keyword,
        text: format.count(source.statements[keyword]),
        mono: true,
        note: READ_STATEMENTS.includes(keyword) ? undefined : words.notDrawn,
      })),
    });
  }
  if (comments.length > 0) {
    sections.push({
      title: words.comments,
      rows: [
        ...comments
          .slice(0, COMMENT_LIMIT)
          .map((comment): Row => ({ label: '', wide: true, text: comment })),
        ...(comments.length > COMMENT_LIMIT
          ? [moreRow(context, comments.length - COMMENT_LIMIT)]
          : []),
      ],
    });
  }
  sections.splice(1, 0, contentsSection(context));
  if (context.check) sections.splice(2, 0, checkSection(context, context.check));
  return {
    title: file.name,
    kind: strings.kinds.model,
    sections: sections.filter((section) => section.rows.length > 0),
  };
}

/**
 * What a 3D printing check asks: the surface area, whether the surface is closed and the volume
 * it holds, and where it isn't closed. Lengths are the file's, in its unit.
 */
function checkSection(context: InspectContext, check: MeshCheck): Section {
  const { format } = context;
  const words = context.strings.source;
  const watertight = check.openEdges === 0 && check.nonManifoldEdges === 0;
  const rows: Row[] = [{ label: words.area, text: format.area(check.area), mono: true }];
  if (check.volume !== undefined) {
    rows.push({
      label: words.volume,
      text: format.volume(Math.abs(check.volume)),
      mono: true,
      note: check.volume < 0 ? words.insideOut : undefined,
    });
  }
  rows.push({ label: words.watertight, text: watertight ? words.yes : words.no });
  const counts: [string, number][] = [
    [words.openEdges, check.openEdges],
    [words.nonManifoldEdges, check.nonManifoldEdges],
    [words.flippedEdges, check.flippedEdges],
    [words.degenerate, check.degenerate],
  ];
  for (const [label, count] of counts) {
    if (count > 0) rows.push({ label, text: format.count(count), mono: true });
  }
  rows.push({ label: words.shells, text: format.count(check.shells), mono: true });
  return { title: words.check, rows };
}

/** The nodes of the scene shown: the default scene's, or the top nodes when there is none. */
function sceneNodes(model: GltfModel): number[] {
  const scene = model.ref('scenes', model.root.scene ?? 0);
  return scene !== undefined ? model.sceneRoots(scene) : model.unreachedRoots();
}

/**
 * Width, height and depth in metres, as glTF's units are metres: of a single node along its own
 * axes, of a scene or model along the world's.
 */
function dimensionRows(context: InspectContext, nodes: readonly number[], own = false): Row[] {
  const bounds = own ? undefined : nodesBounds(context.model, nodes);
  const measured = own ? nodeSize(context.model, nodes[0]) : bounds && sizeOf(bounds);
  if (!measured) return [];
  return [
    {
      label: context.strings.labels.dimensions,
      text: context.format.dimensions(measured),
      mono: true,
    },
  ];
}

function inspectScene(context: InspectContext, index: number): Section[] {
  const { model, strings, format } = context;
  const roots = model.sceneRoots(index);
  let total = 0;
  const stack = [...roots];
  while (stack.length > 0) {
    total++;
    stack.push(...model.children(stack.pop()!));
  }
  const rows: Row[] = [
    ...dimensionRows(context, roots),
    { label: strings.labels.nodes, text: format.count(total), mono: true },
    ...linkRows(context, 'nodes', 'node', roots),
  ];
  return [
    { title: strings.kinds.scene, rows },
    ...extensionSections(context, model.items('scenes')[index]),
    ...extrasSection(context, model.items('scenes')[index]),
  ];
}

function inspectNode(context: InspectContext, index: number): Section[] {
  const { model, strings, format } = context;
  const node = model.items('nodes')[index];
  const children = model.indexList(node.children, 'nodes');
  const rows: Row[] = [];
  if (children.length > 0) {
    rows.push({ label: strings.labels.children, text: format.count(children.length), mono: true });
    rows.push(...linkRows(context, 'children', 'node', children));
  }
  const parent = model.parent(index);
  if (parent !== undefined) rows.push({ label: 'parent', links: [link(context, 'node', parent)] });
  const mesh = model.ref('meshes', node.mesh);
  const refs: [string, StructureKind, number | undefined][] = [
    ['mesh', 'mesh', mesh],
    ['skin', 'skin', model.ref('skins', node.skin)],
    ['camera', 'camera', model.ref('cameras', node.camera)],
    ['light', 'light', model.nodeLight(index)],
  ];
  for (const [label, kind, ref] of refs) {
    if (ref !== undefined) rows.push({ label, links: [link(context, kind, ref)] });
  }
  const weights = numbers(node.weights);
  if (weights) rows.push({ label: 'weights', text: format.vector(weights), mono: true });
  rows.unshift(...dimensionRows(context, [index], true));

  const sections: Section[] = [
    { title: strings.kinds.node, rows },
    { title: strings.sections.transform, rows: transformRows(context, node) },
  ];
  if (mesh !== undefined) {
    const summary = meshSummary(context, mesh);
    sections.push({
      title: strings.kinds.mesh,
      rows: [{ label: 'mesh', links: [link(context, 'mesh', mesh)] }, ...summary],
    });
  }
  return [...sections, ...extensionSections(context, node), ...extrasSection(context, node)];
}

function transformRows(context: InspectContext, node: JsonObject): Row[] {
  const { format, strings } = context;
  const matrix = numbers(node.matrix, 16);
  if (matrix) {
    // glTF stores matrices by column; rows read the way they're written on paper.
    return [0, 1, 2, 3].map((row) => ({
      label: row === 0 ? 'matrix' : '',
      text: format.vector([0, 1, 2, 3].map((column) => matrix[column * 4 + row])),
      mono: true,
    }));
  }
  const translation = numbers(node.translation, 3) ?? [0, 0, 0];
  const rotation = numbers(node.rotation, 4) ?? [0, 0, 0, 1];
  const scale = numbers(node.scale, 3) ?? [1, 1, 1];
  return [
    { label: 'translation', text: format.vector(translation), mono: true },
    { label: 'rotation', text: format.vector(rotation), mono: true },
    {
      label: strings.labels.rotationDegrees,
      text: format.vector(eulerDegrees(rotation).map((value) => Number(value.toFixed(3)))),
      mono: true,
    },
    { label: 'scale', text: format.vector(scale), mono: true },
  ];
}

/** Euler angles in degrees, X then Y then Z, as three.js and most tools apply them. */
function eulerDegrees([x, y, z, w]: number[]): number[] {
  const length = Math.hypot(x, y, z, w) || 1;
  [x, y, z, w] = [x / length, y / length, z / length, w / length];
  const m11 = 1 - 2 * (y * y + z * z);
  const m12 = 2 * (x * y - z * w);
  const m13 = 2 * (x * z + y * w);
  const m22 = 1 - 2 * (x * x + z * z);
  const m23 = 2 * (y * z - x * w);
  const m32 = 2 * (y * z + x * w);
  const m33 = 1 - 2 * (x * x + y * y);
  const ey = Math.asin(Math.max(-1, Math.min(1, m13)));
  const [ex, ez] =
    Math.abs(m13) < 0.9999999
      ? [Math.atan2(-m23, m33), Math.atan2(-m12, m11)]
      : [Math.atan2(m32, m22), 0];
  return [ex, ey, ez].map((angle) => {
    const degrees = (angle * 180) / Math.PI;
    return Object.is(degrees, -0) ? 0 : degrees;
  });
}

/** Vertex and element totals for a mesh, as rows. */
function meshSummary(context: InspectContext, mesh: number): Row[] {
  const { model, strings, format } = context;
  const totals = meshCounts(model, mesh);
  const rows: Row[] = [
    { label: strings.labels.primitives, text: format.count(totals.primitives), mono: true },
    { label: strings.labels.vertices, text: format.count(totals.vertices), mono: true },
  ];
  for (const shape of ['triangles', 'lines', 'points'] as const) {
    if (totals[shape] > 0) {
      rows.push({ label: strings.labels[shape], text: format.count(totals[shape]), mono: true });
    }
  }
  rows.push(...linkRows(context, strings.groups.materials, 'material', totals.materials));
  return rows;
}

function inspectMesh(context: InspectContext, index: number): Section[] {
  const { model, strings, format } = context;
  const mesh = model.items('meshes')[index];
  const rows = meshSummary(context, index);
  const bounds = meshBounds(model, index);
  // In the mesh's own units: the nodes that use it can scale it.
  if (bounds)
    rows.unshift({ label: strings.labels.size, text: format.vector(sizeOf(bounds)), mono: true });
  const weights = numbers(mesh.weights);
  if (weights) rows.push({ label: 'weights', text: format.vector(weights), mono: true });
  const extras = isObject(mesh.extras) ? mesh.extras : {};
  const targetNames = Array.isArray(extras.targetNames)
    ? extras.targetNames.filter((name): name is string => typeof name === 'string')
    : [];
  if (targetNames.length > 0) rows.push({ label: 'targetNames', text: targetNames.join(', ') });

  const primitives = objects(mesh.primitives);
  const sections: Section[] = [{ title: strings.kinds.mesh, rows }];
  primitives.slice(0, PRIMITIVE_LIMIT).forEach((primitive, primitiveIndex) => {
    sections.push({
      title: `${strings.kinds.primitive} ${primitiveIndex}`,
      rows: primitiveRows(context, primitive),
    });
  });
  if (primitives.length > PRIMITIVE_LIMIT) {
    sections.push({
      title: '',
      rows: [moreRow(context, primitives.length - PRIMITIVE_LIMIT)],
    });
  }
  sections.push({
    title: strings.sections.usedBy,
    rows: linkRows(context, strings.groups.nodes, 'node', model.usersOf('mesh', index)),
  });
  return [...sections, ...extensionSections(context, mesh), ...extrasSection(context, mesh)];
}

function primitiveRows(context: InspectContext, primitive: JsonObject): Row[] {
  const { model, strings, format } = context;
  const counts = primitiveCounts(context.model, primitive);
  const mode = num(primitive.mode) ?? 4;
  const rows: Row[] = [{ label: 'mode', text: MODES[mode] ?? String(mode), mono: true }];
  const material = model.ref('materials', primitive.material);
  if (material !== undefined)
    rows.push({ label: 'material', links: [link(context, 'material', material)] });
  rows.push({ label: strings.labels.vertices, text: format.count(counts.vertices), mono: true });
  rows.push({
    label: strings.labels[counts.shape],
    text: format.count(counts.elements),
    mono: true,
  });
  const indices = model.item('accessors', model.ref('accessors', primitive.indices));
  if (indices) {
    rows.push({
      label: 'indices',
      text: `${COMPONENT_TYPES[num(indices.componentType) ?? 0] ?? '?'} × ${format.count(num(indices.count) ?? 0)}`,
      mono: true,
    });
  }
  const attributes = isObject(primitive.attributes) ? primitive.attributes : {};
  for (const [name, ref] of Object.entries(attributes)) {
    const accessor = model.item('accessors', model.ref('accessors', ref));
    if (!accessor) continue;
    const parts = [
      text(accessor.type) ?? '?',
      COMPONENT_TYPES[num(accessor.componentType) ?? 0] ?? '?',
    ];
    if (accessor.normalized === true) parts.push('normalized');
    rows.push({ label: name, text: parts.join(' · '), mono: true });
    if (name === 'POSITION') {
      const min = numbers(accessor.min, 3);
      const max = numbers(accessor.max, 3);
      const bounds = positionBounds(model, primitive);
      if (min && max && bounds) {
        rows.push({ label: 'min', text: format.vector(min), mono: true });
        rows.push({ label: 'max', text: format.vector(max), mono: true });
        // Quantized positions keep raw integers in min and max; the size is in mesh units.
        rows.push({
          label: strings.labels.size,
          text: format.vector(bounds.max.map((value, axis) => value - bounds.min[axis])),
          mono: true,
        });
      }
    }
  }
  const targets = objects(primitive.targets);
  if (targets.length > 0)
    rows.push({ label: 'targets', text: format.count(targets.length), mono: true });
  const extensions = isObject(primitive.extensions) ? Object.keys(primitive.extensions) : [];
  if (extensions.length > 0) rows.push({ label: 'extensions', text: extensions.join(', ') });
  return rows;
}

function inspectMaterial(context: InspectContext, index: number): Section[] {
  const { model, strings } = context;
  const material = model.items('materials')[index];
  const alphaMode = text(material.alphaMode) ?? 'OPAQUE';
  const rows: Row[] = [{ label: 'alphaMode', text: alphaMode, mono: true }];
  if (alphaMode === 'MASK') {
    rows.push({
      label: 'alphaCutoff',
      text: context.format.value(num(material.alphaCutoff) ?? 0.5),
      mono: true,
    });
  }
  rows.push({ label: 'doubleSided', text: String(material.doubleSided === true), mono: true });
  const rest = Object.fromEntries(
    Object.entries(material).filter(
      ([key]) =>
        ![
          'name',
          'alphaMode',
          'alphaCutoff',
          'doubleSided',
          'pbrMetallicRoughness',
          'extensions',
          'extras',
        ].includes(key),
    ),
  );
  rows.push(...propertyRows(context, rest));
  const pbr = isObject(material.pbrMetallicRoughness) ? material.pbrMetallicRoughness : {};
  // An OBJ material: what its library says, then the glTF material it is drawn as.
  const mtl = context.source?.format === 'obj' ? context.source.materials[index] : undefined;
  const library: Section[] = mtl
    ? [
        {
          title: mtl.library ? `MTL · ${mtl.library}` : 'MTL',
          rows:
            mtl.statements.length > 0
              ? mtl.statements.map(([keyword, value]): Row => ({
                  label: keyword,
                  text: value,
                  mono: true,
                }))
              : [{ label: '', wide: true, text: strings.source.notDefined }],
        },
      ]
    : [];
  return [
    ...library,
    { title: strings.kinds.material, rows },
    {
      title: 'pbrMetallicRoughness',
      rows: propertyRows(context, {
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: 1,
        roughnessFactor: 1,
        ...pbr,
      }),
    },
    ...extensionSections(context, material),
    {
      title: strings.sections.usedBy,
      rows: linkRows(context, strings.groups.meshes, 'mesh', model.meshesUsing(index)),
    },
    ...extrasSection(context, material),
  ];
}

function inspectTexture(context: InspectContext, index: number): Section[] {
  const { model, strings } = context;
  const texture = model.items('textures')[index];
  const rows: Row[] = [];
  const source = model.ref('images', texture.source);
  if (source !== undefined) rows.push({ label: 'source', text: imageText(context, source) });
  const extensions = isObject(texture.extensions) ? texture.extensions : {};
  for (const [name, extension] of Object.entries(extensions)) {
    const image = isObject(extension) ? model.ref('images', extension.source) : undefined;
    rows.push(
      image !== undefined
        ? { label: name, text: imageText(context, image) }
        : { label: name, json: json(extension) },
    );
  }
  const drawn = drawnImage(model, index);
  const info = drawn === undefined ? undefined : context.images?.[drawn];
  if (info) {
    rows.push({
      label: strings.labels.dimensions,
      text: `${info.width} × ${info.height} px`,
      mono: true,
    });
    if (info.levels !== undefined) {
      rows.push({ label: strings.labels.mipLevels, text: String(info.levels), mono: true });
    }
    const memory = textureMemory(model, context.images, index);
    if (memory !== undefined) {
      rows.push({
        label: strings.labels.gpuMemory,
        text: `≈ ${context.format.bytes(memory)}`,
        mono: true,
      });
    }
  }

  const sampler = model.item('samplers', model.ref('samplers', texture.sampler)) ?? {};
  const enumText = (names: Record<number, string>, value: unknown, fallback: string) => {
    const code = num(value);
    return code === undefined ? fallback : (names[code] ?? String(code));
  };
  const samplerRows: Row[] = [
    { label: 'magFilter', text: enumText(FILTERS, sampler.magFilter, '—'), mono: true },
    { label: 'minFilter', text: enumText(FILTERS, sampler.minFilter, '—'), mono: true },
    { label: 'wrapS', text: enumText(WRAPS, sampler.wrapS, 'REPEAT'), mono: true },
    { label: 'wrapT', text: enumText(WRAPS, sampler.wrapT, 'REPEAT'), mono: true },
  ];

  const uses = model.textureUses(index);
  const usedBy: Row[] = uses.slice(0, LIST_LIMIT).map((use) => ({
    label: '',
    wide: true,
    links: [link(context, 'material', use.material)],
    note: use.texCoord !== 0 ? `${use.slot} · texCoord ${use.texCoord}` : use.slot,
  }));
  if (uses.length > LIST_LIMIT) usedBy.push(moreRow(context, uses.length - LIST_LIMIT));

  return [
    { title: strings.kinds.texture, rows },
    { title: strings.kinds.sampler, rows: samplerRows },
    { title: strings.sections.usedBy, rows: usedBy },
    ...extrasSection(context, texture),
  ];
}

/** An image by name or file, its type and size: "wood.png · image/png · 1.2 MB". */
function imageText(context: InspectContext, index: number): string {
  const { model, format, strings } = context;
  const image = model.items('images')[index];
  const uri = text(image.uri);
  const name = model.name('images', index);
  const file = fileName(uri);
  const parts = [name ?? file ?? `${strings.kinds.image} ${index}`];
  // A separate file is known by its path; where it is matters as much as what it is called.
  if (name !== undefined && file !== undefined) parts.push(uri!);
  const mimeType =
    text(image.mimeType) ??
    (uri?.startsWith('data:') ? /^data:([^;,]+)/.exec(uri)?.[1] : undefined);
  if (mimeType) parts.push(mimeType);
  const view = model.item('bufferViews', model.ref('bufferViews', image.bufferView));
  const byteLength = num(view?.byteLength);
  if (byteLength !== undefined) parts.push(format.bytes(byteLength));
  else if (uri?.startsWith('data:')) {
    parts.push(format.bytes(Math.floor(((uri.length - uri.indexOf(',') - 1) * 3) / 4)));
  }
  return parts.join(' · ');
}

function inspectAnimation(context: InspectContext, index: number): Section[] {
  const { model, strings, format } = context;
  const animation = model.items('animations')[index];
  const samplers = objects(animation.samplers);
  const channels = objects(animation.channels);
  let start = Infinity;
  let end = -Infinity;
  const interpolations = new Set<string>();
  for (const sampler of samplers) {
    const input = model.item('accessors', model.ref('accessors', sampler.input));
    const min = numbers(input?.min, 1);
    const max = numbers(input?.max, 1);
    if (min) start = Math.min(start, min[0]);
    if (max) end = Math.max(end, max[0]);
    interpolations.add(text(sampler.interpolation) ?? 'LINEAR');
  }
  const rows: Row[] = [];
  if (end >= start)
    rows.push({ label: strings.labels.duration, text: format.seconds(end - start), mono: true });
  const motion = context.motion?.[index];
  if (motion) rows.push({ label: strings.labels.motion, text: strings.motion[motion] });
  rows.push({ label: 'channels', text: format.count(channels.length), mono: true });
  rows.push({ label: 'samplers', text: format.count(samplers.length), mono: true });
  if (interpolations.size > 0)
    rows.push({ label: 'interpolation', text: [...interpolations].join(', '), mono: true });

  const channelRows: Row[] = channels.slice(0, LIST_LIMIT).map((channel) => {
    const target = isObject(channel.target) ? channel.target : {};
    const node = model.ref('nodes', target.node);
    const path = text(target.path) ?? '?';
    return node !== undefined
      ? { label: path, links: [link(context, 'node', node)] }
      : {
          label: path,
          text: text(model.extension(target, 'KHR_animation_pointer')?.pointer) ?? '—',
          mono: true,
        };
  });
  if (channels.length > LIST_LIMIT)
    channelRows.push(moreRow(context, channels.length - LIST_LIMIT));
  return [
    { title: strings.kinds.animation, rows },
    { title: strings.sections.channels, rows: channelRows },
    ...extensionSections(context, animation),
    ...extrasSection(context, animation),
  ];
}

function inspectSkin(context: InspectContext, index: number): Section[] {
  const { model, strings, format } = context;
  const skin = model.items('skins')[index];
  const joints = model.indexList(skin.joints, 'nodes');
  const rows: Row[] = [{ label: 'joints', text: format.count(joints.length), mono: true }];
  const skeleton = model.ref('nodes', skin.skeleton);
  if (skeleton !== undefined)
    rows.push({ label: 'skeleton', links: [link(context, 'node', skeleton)] });
  const matrices = model.item('accessors', model.ref('accessors', skin.inverseBindMatrices));
  if (matrices) {
    rows.push({
      label: 'inverseBindMatrices',
      text: format.count(num(matrices.count) ?? 0),
      mono: true,
    });
  }
  return [
    { title: strings.kinds.skin, rows },
    { title: strings.sections.joints, rows: linkRows(context, '', 'node', joints) },
    {
      title: strings.sections.usedBy,
      rows: linkRows(context, strings.groups.nodes, 'node', model.usersOf('skin', index)),
    },
    ...extrasSection(context, skin),
  ];
}

function inspectCamera(context: InspectContext, index: number): Section[] {
  const { model, strings, format } = context;
  const camera = model.items('cameras')[index];
  const type = text(camera.type) ?? '?';
  const rows: Row[] = [{ label: 'type', text: type, mono: true }];
  const projection = isObject(camera[type]) ? (camera[type] as JsonObject) : {};
  rows.push(...propertyRows(context, projection));
  const yfov = num(projection.yfov);
  if (yfov !== undefined) rows.push({ label: 'yfov (°)', text: format.degrees(yfov), mono: true });
  return [
    { title: strings.kinds.camera, rows },
    {
      title: strings.sections.usedBy,
      rows: linkRows(context, strings.groups.nodes, 'node', model.usersOf('camera', index)),
    },
    ...extrasSection(context, camera),
  ];
}

function inspectLight(context: InspectContext, index: number): Section[] {
  const { model, strings, format } = context;
  const light = model.lights()[index];
  const rows = propertyRows(context, {
    type: light.type,
    color: [1, 1, 1],
    intensity: 1,
    ...Object.fromEntries(
      Object.entries(light).filter(([key]) => !['name', 'extras', 'extensions'].includes(key)),
    ),
  });
  const spot = isObject(light.spot) ? light.spot : undefined;
  if (spot) {
    for (const key of ['innerConeAngle', 'outerConeAngle']) {
      const angle = num(spot[key]);
      if (angle !== undefined)
        rows.push({ label: `${key} (°)`, text: format.degrees(angle), mono: true });
    }
  }
  return [
    { title: strings.kinds.light, rows },
    {
      title: strings.sections.usedBy,
      rows: linkRows(context, strings.groups.nodes, 'node', model.usersOf('light', index)),
    },
    ...extrasSection(context, light),
  ];
}

/** One section per extension on `owner`, listing its properties. */
function extensionSections(context: InspectContext, owner: JsonObject): Section[] {
  const extensions = isObject(owner.extensions) ? owner.extensions : {};
  return Object.entries(extensions).map(([name, value]) => ({
    title: name,
    rows: isObject(value) ? propertyRows(context, value) : [{ label: '', json: json(value) }],
  }));
}

function extrasSection(context: InspectContext, owner: JsonObject): Section[] {
  if (owner.extras === undefined) return [];
  return [
    { title: context.strings.sections.extras, rows: [{ label: '', json: json(owner.extras) }] },
  ];
}

/**
 * Rows for an object's properties, each in its simplest form: numbers, colors with a swatch,
 * texture references as links, and JSON for anything else.
 */
function propertyRows(context: InspectContext, value: JsonObject): Row[] {
  const { format, model } = context;
  return Object.entries(value).flatMap(([key, property]): Row[] => {
    if (property === undefined || key === 'extras' || key === 'name') return [];
    if (typeof property === 'number' || typeof property === 'boolean') {
      return [
        {
          label: key,
          text: typeof property === 'number' ? format.value(property) : String(property),
          mono: true,
        },
      ];
    }
    if (typeof property === 'string') return [{ label: key, text: property }];
    const vector = numbers(property);
    if (vector && vector.length <= 16) {
      const row: Row = { label: key, text: format.vector(vector), mono: true };
      if ((vector.length === 3 || vector.length === 4) && /color|Factor$/i.test(key)) {
        row.swatch = swatch(vector);
      }
      return [row];
    }
    if (isObject(property) && key.endsWith('Texture')) {
      const texture = model.ref('textures', property.index);
      const notes = Object.entries(property)
        .filter(([name]) => name !== 'index' && name !== 'extras')
        .map(([name, note]) =>
          name === 'extensions' && isObject(note)
            ? Object.keys(note).join(', ')
            : `${name} ${typeof note === 'number' ? format.value(note) : json(note)}`,
        );
      return [
        {
          label: key,
          links: texture !== undefined ? [link(context, 'texture', texture)] : undefined,
          text: notes.length > 0 ? notes.join(' · ') : undefined,
          mono: notes.length > 0,
        },
      ];
    }
    return [{ label: key, json: json(property) }];
  });
}

/** A swatch for a linear color factor, converted to sRGB as a screen shows it. */
function swatch([r, g, b, a = 1]: number[]): string {
  const channel = (value: number) => {
    const linear = Math.max(0, Math.min(1, value));
    const srgb = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
    return Math.round(srgb * 255);
  };
  return `rgb(${channel(r)} ${channel(g)} ${channel(b)} / ${Math.max(0, Math.min(1, a))})`;
}

function json(value: unknown): string {
  const textValue = JSON.stringify(value, null, 2) ?? String(value);
  return textValue.length > JSON_LIMIT ? `${textValue.slice(0, JSON_LIMIT)}…` : textValue;
}
