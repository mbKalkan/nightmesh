import type { ImageInfo, SizeCategory, SuggestionKind, TileFacts } from '../../shared/protocol';
import { fileName, isObject, num, objects, text, type GltfModel, type JsonObject } from './gltf';
import { entryKey, type EntryKey } from './outline';
import { drawnImage, textureMemory } from './textures';
import type { ModelUsage, Role } from './usage';

export type { SizeCategory, SuggestionKind };

export interface Suggestion {
  kind: SuggestionKind;
  /** The bytes it is about: geometry, texture memory, unused data… */
  bytes: number;
  /** A command that writes an improved copy to a new file, with glTF Transform. */
  command: string;
}

/** Why an image may be a problem. */
export type ImageWarning = 'large' | 'notPowerOfTwo';

export interface ImageSize {
  image: number;
  /** The first texture that draws it, which its row links to. */
  texture?: number;
  name: string;
  bytes?: number;
  info?: ImageInfo;
  /** Estimated GPU memory, when a texture draws it and its size is known. */
  gpuMemory?: number;
  warnings: ImageWarning[];
}

export interface SizeAnalysis {
  /** Bytes in the model's file and the files it uses. */
  total: number;
  files: number;
  /** Largest first, without the empty ones. */
  categories: { category: SizeCategory; bytes: number }[];
  /** Structure entries by the bytes their data takes, largest first. */
  largest: { key: EntryKey; bytes: number }[];
  compression: {
    /** Draco-compressed primitives, of all primitives. */
    draco: number;
    primitives: number;
    /** meshopt-compressed bufferViews, of all of them. */
    meshopt: number;
    views: number;
    quantized: boolean;
    /** Images drawn as textures, by format. */
    textures: Record<string, number>;
  };
  gpuMemory: { geometry: number; textures: number };
  images: ImageSize[];
  suggestions: Suggestion[];
}

export interface SizeInputs {
  fileName: string;
  fileSize: number;
  /** A GLB's chunk sizes; undefined for a .gltf. */
  chunks?: { json: number; bin?: number };
  /** A b3dm tile's header and tables, before the GLB; `fileSize` is the tile's. */
  tile?: TileFacts;
  images?: readonly (ImageInfo | null)[];
  /** Each image's own bytes, from the host. */
  imageBytes?: readonly (number | null)[];
}

/** Entries listed among the largest. */
const LARGEST = 20;
/** Images larger than this on a side don't load on many mobile GPUs. */
const LARGE_IMAGE = 4096;
/** Below these, a suggestion isn't worth making. */
const GEOMETRY_WORTH = 1024 * 1024;
const TEXTURE_MEMORY_WORTH = 64 * 1024 * 1024;
const TEXTURE_DOWNLOAD_WORTH = 2 * 1024 * 1024;
const UNUSED_WORTH = 1024;

const COMPONENT_BYTES: Record<number, number> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
};
const COMPONENTS: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};
const MESHOPT = ['EXT_meshopt_compression', 'KHR_meshopt_compression'];
/** A GLB's own header, and each chunk's. */
const GLB_HEADER = 12;
const CHUNK_HEADER = 8;
/** Formats that stay compressed on the GPU. */
const GPU_COMPRESSED = new Set(['ktx2']);

/** A b3dm tile's bytes before its GLB. */
const tileBytes = ({ header, featureTable, batchTable }: TileFacts) =>
  header + featureTable.json + featureTable.binary + batchTable.json + batchTable.binary;

const CATEGORY_OF: Record<Role, SizeCategory> = {
  vertices: 'vertices',
  indices: 'indices',
  morphTargets: 'morphTargets',
  animation: 'animation',
  skins: 'skins',
  instancing: 'instancing',
};

/**
 * Where a model's bytes go, from its JSON and the image sizes the host read: by what they are
 * for, by the structure entries they belong to, and image by image. Compressed data counts as it
 * is stored; GPU memory is estimated as it is once decoded.
 */
export function sizeAnalysis(
  model: GltfModel,
  usage: ModelUsage,
  inputs: SizeInputs,
): SizeAnalysis {
  const glb = inputs.chunks !== undefined;
  const categories = new Map<SizeCategory, number>();
  const entries = new Map<EntryKey, number>();
  const add = (category: SizeCategory, bytes: number, key?: EntryKey) => {
    if (!(bytes > 0)) return;
    categories.set(category, (categories.get(category) ?? 0) + bytes);
    if (key) entries.set(key, (entries.get(key) ?? 0) + bytes);
  };

  const buffers = model.items('buffers');
  const hasData = (buffer: number | undefined) =>
    buffer !== undefined && (text(buffers[buffer].uri) !== undefined || (glb && buffer === 0));
  const tile = inputs.tile ? tileBytes(inputs.tile) : 0;
  // A GLB cut short holds less of its binary chunk than its JSON says: count what is there.
  const binary = inputs.chunks
    ? Math.max(0, inputs.fileSize - tile - (GLB_HEADER + 2 * CHUNK_HEADER + inputs.chunks.json))
    : Infinity;
  const storedIn = (buffer: number | undefined, offset: unknown, length: unknown) => {
    if (!hasData(buffer)) return 0;
    const start = num(offset) ?? 0;
    const end = start + (num(length) ?? 0);
    const available = glb && buffer === 0 && text(buffers[0].uri) === undefined ? binary : Infinity;
    return Math.max(0, Math.min(end, available) - start);
  };
  const accessors = model.items('accessors');
  let meshopt = 0;

  model.items('bufferViews').forEach((view, index) => {
    const compressed = MESHOPT.map((name) => model.extension(view, name)).find(Boolean);
    if (compressed) meshopt++;
    const stored = compressed
      ? storedIn(
          model.ref('buffers', compressed.buffer),
          compressed.byteOffset,
          compressed.byteLength,
        )
      : storedIn(model.ref('buffers', view.buffer), view.byteOffset, view.byteLength);
    if (stored === 0) return;
    const contents = usage.views[index];
    if (contents.images.length > 0) {
      for (const image of contents.images) {
        const texture = usage.images[image][0];
        add(
          texture === undefined ? 'unused' : 'textures',
          stored / contents.images.length,
          texture === undefined ? undefined : entryKey('texture', texture),
        );
      }
    } else if (contents.draco.length > 0) {
      for (const mesh of contents.draco) {
        add('vertices', stored / contents.draco.length, entryKey('mesh', mesh));
      }
    } else if (contents.accessors.length > 0) {
      const footprints = contents.accessors.map((accessor) =>
        footprintIn(accessors[accessor], index),
      );
      const sum = footprints.reduce((a, b) => a + b, 0);
      contents.accessors.forEach((accessor, i) => {
        const share = sum > 0 ? (stored * footprints[i]) / sum : stored / footprints.length;
        const use = usage.accessors[accessor][0];
        add(use ? CATEGORY_OF[use.role] : 'unused', share, use?.key);
      });
    } else {
      add('unused', stored);
    }
  });

  // Images given by URI are files of their own, or text in the JSON for `data:` URIs.
  const images = model.items('images');
  let external = 0;
  let embedded = 0;
  const files = new Set<string>();
  images.forEach((image, index) => {
    const uri = text(image.uri);
    if (uri === undefined) return;
    const bytes = inputs.imageBytes?.[index] ?? 0;
    const texture = usage.images[index][0];
    add(
      texture === undefined ? 'unused' : 'textures',
      bytes,
      texture === undefined ? undefined : entryKey('texture', texture),
    );
    if (uri.startsWith('data:')) embedded += uri.length;
    else if (!files.has(uri)) {
      files.add(uri);
      external += bytes;
    }
  });
  buffers.forEach((buffer) => {
    const uri = text(buffer.uri);
    if (uri === undefined) return;
    if (uri.startsWith('data:')) embedded += uri.length;
    else if (!files.has(uri)) {
      files.add(uri);
      external += num(buffer.byteLength) ?? 0;
    }
  });

  const total = inputs.fileSize + external;
  add('json', inputs.chunks ? inputs.chunks.json : Math.max(0, inputs.fileSize - embedded));
  add('tile', tile);
  const counted = [...categories.values()].reduce((a, b) => a + b, 0);
  add('other', total - counted);

  const imageSizes = images.map((image, index) => imageSize(model, usage, inputs, image, index));
  const gpuMemory = {
    geometry: geometryMemory(model, usage),
    textures: textureUploads(model, inputs.images),
  };
  const compression = compressionOf(model, imageSizes, meshopt);
  const sorted = [...categories]
    .map(([category, bytes]) => ({ category, bytes: Math.round(bytes) }))
    .filter((entry) => entry.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);
  const result: SizeAnalysis = {
    total,
    files: 1 + files.size,
    categories: sorted,
    largest: [...entries]
      .map(([key, bytes]) => ({ key, bytes: Math.round(bytes) }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, LARGEST),
    compression,
    gpuMemory,
    images: imageSizes,
    suggestions: [],
  };
  result.suggestions = suggestions(result, inputs.fileName);
  return result;
}

/** The bytes an accessor's data takes in a bufferView, as packed as it can be. */
function footprintIn(accessor: JsonObject, view: number): number {
  const element =
    (COMPONENTS[text(accessor.type) ?? ''] ?? 0) *
    (COMPONENT_BYTES[num(accessor.componentType) ?? 0] ?? 0);
  let bytes = accessor.bufferView === view ? (num(accessor.count) ?? 0) * element : 0;
  const sparse = isObject(accessor.sparse) ? accessor.sparse : undefined;
  if (sparse) {
    const count = num(sparse.count) ?? 0;
    const indices = isObject(sparse.indices) ? sparse.indices : {};
    const values = isObject(sparse.values) ? sparse.values : {};
    if (indices.bufferView === view) {
      bytes += count * (COMPONENT_BYTES[num(indices.componentType) ?? 0] ?? 0);
    }
    if (values.bufferView === view) bytes += count * element;
  }
  return bytes;
}

/** Vertex, index and instance data as the GPU holds it, decoded, each accessor once. */
function geometryMemory(model: GltfModel, usage: ModelUsage): number {
  let bytes = 0;
  model.items('accessors').forEach((accessor, index) => {
    const drawn = usage.accessors[index].some(
      (use) => use.role !== 'animation' && use.role !== 'skins',
    );
    if (!drawn) return;
    const element =
      (COMPONENTS[text(accessor.type) ?? ''] ?? 0) *
      (COMPONENT_BYTES[num(accessor.componentType) ?? 0] ?? 0);
    bytes += (num(accessor.count) ?? 0) * element;
  });
  return bytes;
}

/** Every texture's GPU memory, a texture that shares an image and sampler counted once. */
function textureUploads(model: GltfModel, images: SizeInputs['images']): number {
  const uploads = new Map<string, number>();
  model.items('textures').forEach((texture, index) => {
    const memory = textureMemory(model, images, index);
    if (memory !== undefined) {
      uploads.set(`${drawnImage(model, index)}:${String(texture.sampler)}`, memory);
    }
  });
  return [...uploads.values()].reduce((a, b) => a + b, 0);
}

function imageSize(
  model: GltfModel,
  usage: ModelUsage,
  inputs: SizeInputs,
  image: JsonObject,
  index: number,
): ImageSize {
  const texture = usage.images[index][0];
  const info = inputs.images?.[index] ?? undefined;
  const view = model.item('bufferViews', model.ref('bufferViews', image.bufferView));
  const bytes = inputs.imageBytes?.[index] ?? num(view?.byteLength);
  const warnings: ImageWarning[] = [];
  if (info && Math.max(info.width, info.height) > LARGE_IMAGE) warnings.push('large');
  if (info && !(powerOfTwo(info.width) && powerOfTwo(info.height))) warnings.push('notPowerOfTwo');
  return {
    image: index,
    texture,
    name:
      model.name('images', index) ??
      fileName(text(image.uri)) ??
      (texture !== undefined ? model.displayName('textures', texture) : undefined) ??
      '',
    bytes: bytes ?? undefined,
    info,
    gpuMemory: texture === undefined ? undefined : textureMemory(model, inputs.images, texture),
    warnings,
  };
}

const powerOfTwo = (value: number) => value > 0 && (value & (value - 1)) === 0;

function compressionOf(
  model: GltfModel,
  images: ImageSize[],
  meshopt: number,
): SizeAnalysis['compression'] {
  let primitives = 0;
  let draco = 0;
  for (const mesh of model.items('meshes')) {
    for (const primitive of objects(mesh.primitives)) {
      primitives++;
      if (model.extension(primitive, 'KHR_draco_mesh_compression')) draco++;
    }
  }
  const used = Array.isArray(model.root.extensionsUsed) ? model.root.extensionsUsed : [];
  const textures: Record<string, number> = {};
  for (const image of images) {
    if (image.texture === undefined) continue;
    const format = image.info?.format ?? formatOf(model.items('images')[image.image]);
    textures[format] = (textures[format] ?? 0) + 1;
  }
  return {
    draco,
    primitives,
    meshopt,
    views: model.items('bufferViews').length,
    quantized: used.includes('KHR_mesh_quantization'),
    textures,
  };
}

/** An image's format from its MIME type or file name, when its header couldn't be read. */
function formatOf(image: JsonObject): string {
  const mime = text(image.mimeType)?.replace(/^image\//, '');
  if (mime) return mime === 'jpg' ? 'jpeg' : mime;
  const extension = /\.([a-z0-9]+)$/i.exec(fileName(text(image.uri)) ?? '')?.[1]?.toLowerCase();
  return extension === 'jpg' ? 'jpeg' : (extension ?? '?');
}

/** What could make the model smaller or lighter, each with the command that would. */
function suggestions(analysis: SizeAnalysis, file: string): Suggestion[] {
  const dot = file.lastIndexOf('.');
  const [base, extension] = dot > 0 ? [file.slice(0, dot), file.slice(dot)] : [file, ''];
  const command = (name: string, options = '') =>
    `npx @gltf-transform/cli ${name} "${file}" "${base}-${name}${extension}"${options}`;
  const bytesOf = (...wanted: SizeCategory[]) =>
    analysis.categories
      .filter((entry) => wanted.includes(entry.category))
      .reduce((sum, entry) => sum + entry.bytes, 0);
  const result: Suggestion[] = [];

  const { compression } = analysis;
  const geometry = bytesOf('vertices', 'indices', 'morphTargets');
  if (compression.draco === 0 && compression.meshopt === 0 && geometry >= GEOMETRY_WORTH) {
    result.push({ kind: 'geometry', bytes: geometry, command: command('meshopt') });
  }
  const uncompressed = analysis.images.filter(
    (image) => image.texture !== undefined && !GPU_COMPRESSED.has(image.info?.format ?? ''),
  );
  const memory = uncompressed.reduce((sum, image) => sum + (image.gpuMemory ?? 0), 0);
  if (memory >= TEXTURE_MEMORY_WORTH) {
    result.push({ kind: 'textureMemory', bytes: memory, command: command('etc1s') });
  }
  const download = uncompressed
    .filter((image) => image.info?.format === 'png' || image.info?.format === 'jpeg')
    .reduce((sum, image) => sum + (image.bytes ?? 0), 0);
  if (download >= TEXTURE_DOWNLOAD_WORTH) {
    result.push({ kind: 'textureDownload', bytes: download, command: command('webp') });
  }
  const large = analysis.images.filter((image) => image.warnings.includes('large'));
  if (large.length > 0) {
    result.push({
      kind: 'textureSize',
      bytes: large.reduce((sum, image) => sum + (image.gpuMemory ?? 0), 0),
      command: command('resize', ` --width ${LARGE_IMAGE} --height ${LARGE_IMAGE}`),
    });
  }
  const unused = bytesOf('unused');
  if (unused >= UNUSED_WORTH) {
    result.push({ kind: 'unused', bytes: unused, command: command('prune') });
  }
  return result;
}
