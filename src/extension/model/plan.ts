import type { ByteSource } from './sources';

/** The parts of glTF JSON the plan reads and rewrites; everything else passes through. */
export interface Gltf {
  asset?: { version?: string };
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  buffers?: { uri?: string; byteLength: number }[];
  bufferViews?: {
    buffer: number;
    byteOffset?: number;
    byteLength: number;
    extensions?: Record<string, MeshoptView | undefined>;
  }[];
  accessors?: {
    bufferView?: number;
    sparse?: { indices?: { bufferView?: number }; values?: { bufferView?: number } };
  }[];
  images?: { uri?: string; bufferView?: number; mimeType?: string }[];
  textures?: { source?: number; extensions?: Record<string, { source?: number } | undefined> }[];
  materials?: Record<string, unknown>[];
  meshes?: { primitives: Primitive[] }[];
  nodes?: { mesh?: number; skin?: number; weights?: number[] }[];
  skins?: { inverseBindMatrices?: number }[];
  animations?: { channels: { sampler: number }[]; samplers: { input: number; output: number }[] }[];
}

interface MeshoptView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
}

interface Primitive {
  attributes?: Record<string, number>;
  indices?: number;
  targets?: Record<string, number>[];
  extensions?: { KHR_draco_mesh_compression?: { bufferView?: number } };
}

/** Where the bytes of a buffer or an image are; `available` stops early if the file is cut off. */
export interface ResourceData {
  source: ByteSource;
  offset: number;
  available: number;
}

/** Bytes the webview needs, under the key glTF's loader caches them by. */
export interface Part {
  key: string;
  source: ByteSource;
  offset: number;
  length: number;
}

export interface RenderPlan {
  /** The JSON to draw: no URIs left, and nothing that refers to bytes that can't be loaded. */
  json: Gltf;
  parts: Part[];
  bytes: number;
  dropped: { primitives: number; textures: number; animations: number };
  /** False when the model had geometry and none of it can be loaded. */
  drawable: boolean;
}

const MESHOPT = ['EXT_meshopt_compression', 'KHR_meshopt_compression'];

/**
 * Decides which bytes the webview gets for a model and rewrites its JSON to match. `buffers`
 * and `images` say where each one's bytes are, by index; undefined where they can't be had.
 * Images given by URI become bufferViews, so the webview never resolves a URI itself.
 */
export function planRender(
  original: Gltf,
  buffers: readonly (ResourceData | undefined)[],
  images: readonly (ResourceData | undefined)[],
): RenderPlan {
  const json = structuredClone(original);
  const parts: Part[] = [];
  const bufferList = (json.buffers ??= []);
  const views = json.bufferViews ?? [];
  const brokenViews = new Set<number>();

  const range = (data: ResourceData | undefined, offset = 0, length = 0) =>
    data && offset >= 0 && length >= 0 && offset + length <= data.available
      ? { source: data.source, offset: data.offset + offset, length }
      : undefined;

  views.forEach((view, index) => {
    const meshopt = MESHOPT.map((name) => view.extensions?.[name]).find(Boolean);
    if (meshopt) {
      // The loader decodes these itself from the compressed bytes, which it reads as a buffer.
      const bytes = range(buffers[meshopt.buffer], meshopt.byteOffset, meshopt.byteLength);
      if (!bytes) return brokenViews.add(index);
      meshopt.buffer = bufferList.push({ byteLength: meshopt.byteLength }) - 1;
      meshopt.byteOffset = 0;
      parts.push({ key: `buffer:${meshopt.buffer}`, ...bytes });
      return;
    }
    const bytes = range(buffers[view.buffer], view.byteOffset, view.byteLength);
    if (!bytes) return brokenViews.add(index);
    parts.push({ key: `bufferView:${index}`, ...bytes });
  });

  const brokenImages = new Set<number>();
  (json.images ?? []).forEach((image, index) => {
    if (image.uri === undefined) {
      if (image.bufferView !== undefined && brokenViews.has(image.bufferView)) {
        brokenImages.add(index);
      }
      return;
    }
    const data = images[index];
    const bytes = range(data, 0, data?.available);
    if (!bytes) return brokenImages.add(index);
    const buffer = bufferList.push({ byteLength: bytes.length }) - 1;
    image.bufferView = views.push({ buffer, byteLength: bytes.length }) - 1;
    delete image.uri;
    parts.push({ key: `bufferView:${image.bufferView}`, ...bytes });
  });
  if (views.length > 0) json.bufferViews = views;
  // The webview gets every byte it needs as a part; it has no reason to see where they came from.
  for (const buffer of bufferList) delete buffer.uri;

  const brokenAccessors = new Set<number>();
  (json.accessors ?? []).forEach((accessor, index) => {
    const used = [
      accessor.bufferView,
      accessor.sparse?.indices?.bufferView,
      accessor.sparse?.values?.bufferView,
    ];
    if (used.some((view) => view !== undefined && brokenViews.has(view))) {
      brokenAccessors.add(index);
    }
  });

  const dropped = { primitives: 0, textures: 0, animations: 0 };
  let primitives = 0;
  const brokenPrimitive = (primitive: Primitive) => {
    const accessors = [
      ...Object.values(primitive.attributes ?? {}),
      primitive.indices,
      ...(primitive.targets ?? []).flatMap((target) => Object.values(target)),
    ];
    const draco = primitive.extensions?.KHR_draco_mesh_compression?.bufferView;
    return (
      accessors.some((accessor) => accessor !== undefined && brokenAccessors.has(accessor)) ||
      (draco !== undefined && brokenViews.has(draco))
    );
  };
  const emptyMeshes = new Set<number>();
  (json.meshes ?? []).forEach((mesh, index) => {
    primitives += mesh.primitives.length;
    const kept = mesh.primitives.filter((primitive) => !brokenPrimitive(primitive));
    dropped.primitives += mesh.primitives.length - kept.length;
    mesh.primitives = kept;
    if (kept.length === 0) emptyMeshes.add(index);
  });
  for (const node of json.nodes ?? []) {
    if (node.mesh !== undefined && emptyMeshes.has(node.mesh)) {
      delete node.mesh;
      delete node.skin;
      delete node.weights;
    }
  }

  const brokenTextures = new Set<number>();
  (json.textures ?? []).forEach((texture, index) => {
    const sources = [
      texture.source,
      ...Object.values(texture.extensions ?? {}).map((extension) => extension?.source),
    ];
    if (sources.some((source) => source !== undefined && brokenImages.has(source))) {
      brokenTextures.add(index);
    }
  });
  dropped.textures = brokenTextures.size;
  for (const material of json.materials ?? []) removeTextures(material, brokenTextures);

  for (const skin of json.skins ?? []) {
    if (skin.inverseBindMatrices !== undefined && brokenAccessors.has(skin.inverseBindMatrices)) {
      delete skin.inverseBindMatrices;
    }
  }

  // An animation left with no channels stays, empty, so every animation keeps its index: the
  // viewer matches the loader's clips to the structure by it.
  for (const animation of json.animations ?? []) {
    const before = animation.channels.length;
    animation.channels = animation.channels.filter((channel) => {
      const sampler = animation.samplers[channel.sampler];
      return sampler && !brokenAccessors.has(sampler.input) && !brokenAccessors.has(sampler.output);
    });
    if (before > 0 && animation.channels.length === 0) dropped.animations++;
  }

  const kept = primitives - dropped.primitives;
  return {
    json,
    parts,
    bytes: parts.reduce((sum, part) => sum + part.length, 0),
    dropped,
    drawable: primitives === 0 || kept > 0,
  };
}

/** Removes every texture slot (`baseColorTexture`, `clearcoatTexture`, …) that uses `broken`. */
function removeTextures(value: Record<string, unknown>, broken: ReadonlySet<number>): void {
  for (const [key, child] of Object.entries(value)) {
    if (!child || typeof child !== 'object') continue;
    const index = (child as { index?: unknown }).index;
    if (key.endsWith('Texture') && typeof index === 'number') {
      if (broken.has(index)) delete value[key];
    } else {
      removeTextures(child as Record<string, unknown>, broken);
    }
  }
}
