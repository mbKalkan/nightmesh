// Turns a model file into the messages that bring it to the webview. Free of VS Code APIs, so
// the browser tests can feed the webview exactly what the extension host would.
import { DRAWN_EXTENSIONS } from '../../shared/gltfExtensions';
import { isMeshFormat } from '../../shared/formats';
import type {
  HostToWebviewMessage,
  ImageInfo,
  MeshFormat,
  ModelFormat,
  TileFacts,
} from '../../shared/protocol';
import { MAX_JSON_BYTES, readGlbLayout, sniff, withoutByteOrderMark } from './container';
import { animationMotion } from './animationMotion';
import { instanceBounds } from './instances';
import { IMAGE_HEADER_BYTES, readImageInfo } from './imageInfo';
import { meshMaterials } from './mesh/materials';
import { MeshFormatError, type ParsedMesh } from './mesh/geometry';
import { HEAD_BYTES, headerFacts, looksLike, parseInThread, type MeshParser } from './mesh/parse';
import { toGltf } from './mesh/toGltf';
import { planRender, type Gltf, type Part, type RenderPlan, type ResourceData } from './plan';
import { linkedOpener, rebaseUri, resourceName } from './resources';
import { memorySource, type ByteSource } from './sources';
import { readCmpt } from './cmpt';
import { instancedGltf, readI3dm, rtcPlacement, translation, viewFrame } from './i3dm';
import { mergeGltfs, type MergePart } from './merge';
import { isObject, readB3dm, withBatchIds } from './tileFile';
import { readJsonObject } from './jsonResource';
import { tilesetMessage } from './tiles';

/** Why a resource the model refers to isn't there. */
export type ResourceProblem =
  'missing' | 'network' | 'absolute' | 'outside' | 'invalid' | 'unreadable';

/** Opens what a URI in the model points to (`data:` or relative), or says why it can't. */
export type ResourceOpener = (uri: string) => Promise<ByteSource | ResourceProblem>;

/** Sentences for the user, localized by the caller. */
export interface LoadTexts {
  empty: string;
  damaged: string;
  lfsPointer: string;
  version(version: string): string;
  extensions(names: string): string;
  nothingDrawn: string;
  resource(problem: ResourceProblem, name: string): string;
  truncated: string;
  dropped(kind: 'primitives' | 'textures' | 'animations', count: number): string;
  /** An OBJ, STL or PLY file that isn't one; `objectFile` for an `.obj` that is binary. */
  notMesh(format: MeshFormat, objectFile: boolean): string;
  /** An OBJ, STL or PLY file with nothing to draw in it. */
  noGeometry: string;
  /** A pnts tile whose points are compressed with Draco and couldn't be decoded, and why. */
  compressedPoints(reason: string): string;
  /** Faces, lines or points that couldn't be read or name vertices that aren't there. */
  badFaces(count: number): string;
  /** OBJ's free-form curves and surfaces, which aren't drawn. */
  freeForm(count: number): string;
  /** Materials an OBJ file uses that its libraries don't have. */
  missingMaterials(names: string): string;
  /** A texture in a format browsers can't show. */
  imageFormat(name: string): string;
  /** A .b3dm, .i3dm or .cmpt file that isn't one. */
  notTile(format: 'b3dm' | 'i3dm' | 'cmpt'): string;
  tileVersion(format: 'b3dm' | 'i3dm' | 'cmpt', version: string): string;
  /** Tiles in a composite that aren't drawn: their kinds and places, `pnts 2, i3dm 3/1`. */
  composite(tiles: string): string;
  /** An i3dm tile whose glTF is a file of its own, which couldn't be opened, and why. */
  linkedGltf(reason: string): string;
  /** A JSON file opened as a tileset that isn't one. */
  notTileset: string;
  tilesetVersion(version: string): string;
  /** A tile that is a Git LFS pointer, not yet downloaded. */
  tileLfs(name: string): string;
}

export interface LoadOptions {
  loadId: number;
  reload: boolean;
  texts: LoadTexts;
  /**
   * What the file is by its extension. OBJ, STL and PLY are read into glTF; anything else is
   * glTF, told apart from GLB by its content.
   */
  format?: ModelFormat;
  /** The file's name, which the top node of an OBJ, STL or PLY model takes. */
  fileName?: string;
  /** A model that sends more bytes than this asks first; the default is `LARGE_MODEL_BYTES`. */
  largeBytes?: number;
  /** Reads OBJ, STL and PLY files; by default in the calling thread. */
  parseMesh?: MeshParser;
  /** A tileset's path relative to the folder the viewer may read, with `/` between names. */
  tilesetPath?: string;
}

/**
 * Past this, drawing waits for the user: the webview holds the bytes until the GPU has them, and
 * a model of several gigabytes could run it out of memory.
 */
export const LARGE_MODEL_BYTES = 1024 ** 3;

/** Parts at least this big travel alone; smaller ones are packed together. */
const SMALL_PART = 1024 * 1024;
/** Packs and lone parts are sent in messages of about this size. */
const MESSAGE_BYTES = 16 * 1024 * 1024;

/**
 * Yields the messages for one load of `source`. Stop iterating to cancel: resources opened on
 * the way are closed either way. `source` itself stays open; it belongs to the caller.
 */
export async function* loadMessages(
  source: ByteSource,
  openResource: ResourceOpener,
  options: LoadOptions,
): AsyncGenerator<HostToWebviewMessage> {
  const resources = new Resources(openResource, options.texts);
  try {
    if (options.format === 'tileset') {
      yield await tilesetMessage(
        source,
        { ...options, path: options.tilesetPath ?? '' },
        resources,
      );
    } else if (options.format && isMeshFormat(options.format)) {
      yield* meshMessages(source, options.format, resources, options);
    } else if (options.format === 'b3dm' || options.format === 'i3dm') {
      yield* tileMessages(source, options.format, resources, options);
    } else if (options.format === 'cmpt') {
      yield* cmptMessages(source, resources, options);
    } else {
      yield* gltfMessages(source, resources, options);
    }
  } finally {
    await resources.close();
  }
}

const failure = (
  { loadId, reload }: LoadOptions,
  message: string,
  details: string[] = [],
): HostToWebviewMessage => ({ type: 'failed', loadId, reload, message, details });

/** A b3dm or i3dm tile: the GLB in it, with what the tile says around it. */
async function* tileMessages(
  source: ByteSource,
  format: 'b3dm' | 'i3dm',
  resources: Resources,
  options: LoadOptions,
): AsyncGenerator<HostToWebviewMessage> {
  const { texts } = options;
  const head = await source.read(0, Math.min(64, source.size));
  const kind = sniff(head);
  if (kind === 'empty') return yield failure(options, texts.empty);
  if (kind === 'lfsPointer') return yield failure(options, texts.lfsPointer);
  const tile = format === 'b3dm' ? await readB3dm(source) : await readI3dm(source);
  if ('failure' in tile) {
    return yield failure(
      options,
      tile.failure === 'version'
        ? texts.tileVersion(format, String(tile.version))
        : texts.notTile(format),
    );
  }
  // A b3dm model on the globe is placed there, as an instance, to stand upright in the view.
  const instances = instancesOf(tile) ?? rtcPlacement(tile.facts.rtcCenter);
  if ('glb' in tile) {
    return yield* gltfMessages(tile.glb, resources, options, {
      fileSize: source.size,
      tile: tile.facts,
      instances,
    });
  }
  // An i3dm tile can name its glTF, a file whose own resources are relative to its folder.
  const linked = await resources.open(tile.uri);
  if (typeof linked === 'string') {
    return yield failure(options, texts.linkedGltf(texts.resource(linked, resourceName(tile.uri))));
  }
  const own = new Resources(linkedOpener(resources.openResource, tile.uri), texts);
  try {
    yield* gltfMessages(linked, own, options, {
      fileSize: source.size,
      tile: { ...tile.facts, gltfBytes: linked.size },
      instances,
    });
  } finally {
    await own.close();
  }
}

/** A composite tile: the models of the b3dm and i3dm tiles in it, as one, where each puts them. */
async function* cmptMessages(
  source: ByteSource,
  resources: Resources,
  options: LoadOptions,
): AsyncGenerator<HostToWebviewMessage> {
  const { loadId, reload, texts } = options;
  const head = await source.read(0, Math.min(64, source.size));
  const kind = sniff(head);
  if (kind === 'empty') return yield failure(options, texts.empty);
  if (kind === 'lfsPointer') return yield failure(options, texts.lfsPointer);
  const cmpt = await readCmpt(source);
  if ('failure' in cmpt) {
    return yield failure(
      options,
      cmpt.failure === 'version'
        ? texts.tileVersion('cmpt', String(cmpt.version))
        : texts.notTile('cmpt'),
    );
  }

  const read: { name: string; gltf: GltfRead; instances: Float64Array }[] = [];
  const skipped: string[] = [];
  for (const inner of cmpt.tiles) {
    const name = `${inner.format} ${inner.path}`;
    const tile =
      inner.format === 'b3dm'
        ? await readB3dm(inner.source)
        : inner.format === 'i3dm'
          ? await readI3dm(inner.source)
          : undefined;
    const gltf = !tile || 'failure' in tile ? undefined : await tileGltf(tile, resources, texts);
    if (!tile || 'failure' in tile || !gltf || 'failure' in gltf) {
      skipped.push(name);
      continue;
    }
    const instances = instancesOf(tile) ?? translation(tile.facts.rtcCenter ?? [0, 0, 0]);
    if (inner.format === 'b3dm') gltf.json = withBatchIds(gltf.json);
    read.push({ name, gltf, instances });
  }
  if (read.length === 0) return yield failure(options, texts.composite(skipped.join(', ')));

  // Every tile in the composite is shown in one frame: that of all their instances together.
  const all = new Float64Array(read.reduce((sum, part) => sum + part.instances.length, 0));
  read.reduce((at, part) => (all.set(part.instances, at), at + part.instances.length), 0);
  const frame = viewFrame(all);
  const parts: MergePart[] = [];
  for (const { name, gltf, instances } of read) {
    const buffers = await gltfBuffers(gltf, resources);
    const instanced = instancedGltf(gltf.json, instances, frame);
    if (instanced) buffers.push(memoryData(instanced.buffer));
    // The tiles' metadata is merged with its schema, which must be in the JSON for that.
    parts.push({ name, json: await withSchema(instanced?.json ?? gltf.json, resources), buffers });
  }
  const merged = mergeGltfs(parts);
  yield {
    type: 'structure',
    loadId,
    reload,
    json: JSON.stringify(merged.json),
    fileSize: source.size,
    tile: cmpt.facts,
  };
  const missing = (merged.json.extensionsRequired ?? []).filter(
    (name) => !DRAWN_EXTENSIONS.has(name),
  );
  if (missing.length > 0) return yield failure(options, texts.extensions(missing.join(', ')));
  const notices = read.some(({ gltf }) => gltf.truncated) ? [texts.truncated] : [];
  if (skipped.length > 0) notices.push(texts.composite(skipped.join(', ')));
  yield* drawMessages(merged.json, merged.buffers, resources, options, notices);
}

/**
 * A tile's glTF inside a composite: its GLB, or the file an i3dm tile names, its resources then
 * made relative to the composite, which they are drawn from.
 */
async function tileGltf(
  tile: { glb: ByteSource } | { uri: string },
  resources: Resources,
  texts: LoadTexts,
): Promise<GltfRead | { failure: string } | undefined> {
  if ('glb' in tile) return readGltf(tile.glb, texts);
  const linked = await resources.open(tile.uri);
  if (typeof linked === 'string') return undefined;
  const gltf = await readGltf(linked, texts);
  if ('failure' in gltf) return gltf;
  for (const item of [...(gltf.json.buffers ?? []), ...(gltf.json.images ?? [])]) {
    if (typeof item.uri === 'string') item.uri = rebaseUri(item.uri, tile.uri);
  }
  const metadata = (gltf.json as WithMetadata).extensions?.EXT_structural_metadata;
  if (typeof metadata?.schemaUri === 'string') {
    metadata.schemaUri = rebaseUri(metadata.schemaUri, tile.uri);
  }
  return gltf;
}

/** A glTF model's JSON, as text and read, and where its binary chunk is when it is a GLB. */
interface GltfRead {
  text: string;
  json: Gltf;
  chunks?: { json: number; bin?: number };
  bin?: ResourceData;
  truncated: boolean;
}

/** Reads a glTF or GLB file's JSON, or says why it can't be shown, in a sentence for the user. */
async function readGltf(
  source: ByteSource,
  texts: LoadTexts,
): Promise<GltfRead | { failure: string }> {
  const head = await source.read(0, Math.min(64, source.size));
  const kind = sniff(head);
  if (kind === 'empty') return { failure: texts.empty };
  if (kind === 'lfsPointer') return { failure: texts.lfsPointer };
  if (kind === 'unknown') return { failure: texts.damaged };

  const read: Omit<GltfRead, 'json'> = { text: '', truncated: false };
  if (kind === 'glb') {
    const layout = await readGlbLayout(source);
    if ('failure' in layout) {
      return {
        failure:
          layout.failure === 'version' ? texts.version(String(layout.version)) : texts.damaged,
      };
    }
    read.text = new TextDecoder().decode(await source.read(layout.json.offset, layout.json.length));
    read.chunks = { json: layout.json.length, bin: layout.bin?.length };
    if (layout.bin) {
      read.bin = { source, offset: layout.bin.offset, available: layout.bin.available };
    }
    read.truncated = layout.truncated;
  } else {
    if (source.size > MAX_JSON_BYTES) return { failure: texts.damaged };
    read.text = new TextDecoder().decode(await source.read(0, source.size));
  }

  read.text = withoutByteOrderMark(read.text);
  let json: Gltf;
  try {
    json = JSON.parse(read.text) as Gltf;
  } catch {
    return { failure: texts.damaged };
  }
  if (!json || typeof json !== 'object' || typeof json.asset?.version !== 'string') {
    return { failure: texts.damaged };
  }
  if (!json.asset.version.startsWith('2.')) return { failure: texts.version(json.asset.version) };
  return { ...read, json };
}

/** Where each of a model's buffers' bytes are: its binary chunk, or the files it names. */
function gltfBuffers(gltf: GltfRead, resources: Resources): Promise<(ResourceData | undefined)[]> {
  return Promise.all(
    (gltf.json.buffers ?? []).map((buffer, index) =>
      buffer.uri !== undefined
        ? resources.data(buffer.uri)
        : index === 0 && gltf.bin
          ? gltf.bin
          : undefined,
    ),
  );
}

async function* gltfMessages(
  source: ByteSource,
  resources: Resources,
  options: LoadOptions,
  /**
   * The file the glTF is in, when it is in more than the glTF: a b3dm or i3dm tile, and the
   * instances its model is drawn at, each a 4×4 matrix.
   */
  { instances, ...file }: { fileSize: number; tile?: TileFacts; instances?: Float64Array } = {
    fileSize: source.size,
  },
): AsyncGenerator<HostToWebviewMessage> {
  const { loadId, reload, texts } = options;
  const gltf = await readGltf(source, texts);
  if ('failure' in gltf) return yield failure(options, gltf.failure);
  // The structure shows right away, and stays when the model can't be drawn.
  yield { type: 'structure', loadId, reload, json: gltf.text, chunks: gltf.chunks, ...file };
  const missing = (gltf.json.extensionsRequired ?? []).filter(
    (name) => !DRAWN_EXTENSIONS.has(name),
  );
  if (missing.length > 0) return yield failure(options, texts.extensions(missing.join(', ')));

  const buffers = await gltfBuffers(gltf, resources);
  // A tile's glTF is drawn once for each of its instances; the panels keep the file's.
  const drawn = file.tile?.format === 'b3dm' ? withBatchIds(gltf.json) : gltf.json;
  const instanced = instances && instancedGltf(drawn, instances);
  if (instanced) buffers.push(memoryData(instanced.buffer));
  const notices = gltf.truncated ? [texts.truncated] : [];
  yield* drawMessages(instanced?.json ?? drawn, buffers, resources, options, notices);
}

/** An i3dm tile's instances; a b3dm tile has none. */
const instancesOf = (tile: object): Float64Array | undefined =>
  (tile as { instances?: Float64Array }).instances;

/** Bytes made on the way, as a buffer's data. */
const memoryData = (bytes: Uint8Array): ResourceData => ({
  source: arraySource(bytes),
  offset: 0,
  available: bytes.length,
});

/**
 * OBJ, STL and PLY: read into geometry (in a worker thread in the extension), made into glTF,
 * and from there sent as a glTF model is.
 */
async function* meshMessages(
  source: ByteSource,
  format: MeshFormat,
  resources: Resources,
  options: LoadOptions,
): AsyncGenerator<HostToWebviewMessage> {
  const { loadId, reload, texts, largeBytes = LARGE_MODEL_BYTES } = options;
  const fileName = options.fileName ?? '';
  const head = await source.read(0, Math.min(HEAD_BYTES, source.size));
  const kind = sniff(head);
  if (kind === 'empty') return yield failure(options, texts.empty);
  if (kind === 'lfsPointer') return yield failure(options, texts.lfsPointer);
  const looks = looksLike(format, head, source.size);
  if (looks !== 'yes') return yield failure(options, texts.notMesh(format, looks === 'objectFile'));

  // A large file is read only once the user says so: reading takes memory in proportion. Its
  // header shows in the meantime.
  let waited = false;
  if (source.size > largeBytes) {
    yield {
      type: 'structure',
      loadId,
      reload,
      json: JSON.stringify(emptyGltf(fileName)),
      fileSize: source.size,
      source: headerFacts(format, head, source.size),
    };
    yield { type: 'large', loadId, bytes: source.size };
    waited = true;
  }

  const events = (options.parseMesh ?? parseInThread)(format, source)[Symbol.asyncIterator]();
  try {
    let mesh: ParsedMesh | undefined;
    try {
      for (let next = await events.next(); !next.done; next = await events.next()) {
        const event = next.value;
        if (event.type === 'progress') {
          yield { type: 'progress', loadId, done: event.done, total: source.size };
        } else if (event.type === 'done') {
          mesh = event.mesh;
          break;
        }
      }
    } catch (error) {
      if (error instanceof MeshFormatError)
        return yield failure(options, texts.notMesh(format, false));
      throw error;
    }
    if (!mesh) return;
    const drawn = yield* meshModelMessages(mesh, source, resources, options, waited);
    if (!drawn) return;
    // The check of the triangles comes last, so it never holds up the model.
    try {
      for (let next = await events.next(); !next.done; next = await events.next()) {
        if (next.value.type !== 'check') continue;
        if (next.value.check) yield { type: 'meshCheck', loadId, check: next.value.check };
        break;
      }
    } catch {
      // The model is shown; it only goes without its check.
    }
  } finally {
    await events.return?.();
  }
}

/** The structure, then the model, of a mesh read from a file; false if it has nothing to draw. */
async function* meshModelMessages(
  mesh: ParsedMesh,
  source: ByteSource,
  resources: Resources,
  options: LoadOptions,
  waited: boolean,
): AsyncGenerator<HostToWebviewMessage, boolean> {
  const { loadId, reload, texts } = options;
  const fileName = options.fileName ?? '';

  const materials = await meshMaterials(mesh, resources, texts);
  const { json, buffers } = toGltf(mesh, fileName, materials.specs, materials.images);
  if (!json.meshes?.length) {
    const compressed = mesh.problems.find((problem) => problem.kind === 'compressed');
    if (!compressed) {
      yield failure(options, texts.noGeometry);
      return false;
    }
    // What the tile says about itself shows all the same.
    yield {
      type: 'structure',
      loadId,
      reload,
      json: JSON.stringify(json),
      fileSize: source.size,
      source: materials.facts,
    };
    yield failure(options, texts.compressedPoints(compressed.reason));
    return false;
  }
  yield {
    type: 'structure',
    loadId,
    // Once the user has waited, the panels keep what they show, as for a file that changed.
    reload: reload || waited,
    json: JSON.stringify(json),
    fileSize: source.size,
    source: materials.facts,
  };
  const notices = [...materials.notices];
  for (const problem of mesh.problems) {
    if (problem.kind === 'truncated') notices.push(texts.truncated);
    else if (problem.kind === 'faces') notices.push(texts.badFaces(problem.count));
    else if (problem.kind === 'freeForm') notices.push(texts.freeForm(problem.count));
  }
  const data = buffers.map((bytes): ResourceData => ({
    source: arraySource(bytes),
    offset: 0,
    available: bytes.length,
  }));
  // The user was asked already, before reading.
  yield* drawMessages(json, data, resources, { ...options, largeBytes: Infinity }, notices);
  return true;
}

/** A model with nothing in it but the file's node, while a large file waits to be read. */
function emptyGltf(fileName: string): Gltf & Record<string, unknown> {
  return {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: fileName } as never],
  };
}

/**
 * Images, then the model and its parts: the part of a load glTF and the formats read into it
 * share. `notices` go after what couldn't be opened.
 */
async function* drawMessages(
  json: Gltf,
  buffers: readonly (ResourceData | undefined)[],
  resources: Resources,
  { loadId, reload, texts, largeBytes = LARGE_MODEL_BYTES }: LoadOptions,
  notices: readonly string[],
): AsyncGenerator<HostToWebviewMessage> {
  json = await withSchema(json, resources);
  const images = await Promise.all(
    (json.images ?? []).map((image) =>
      image.uri !== undefined ? resources.data(image.uri) : undefined,
    ),
  );
  const plan = planRender(json, buffers, images);
  const infos = await imageInfos(plan);
  // The loader can't read an image from a bufferView without its type, which glTF doesn't
  // require of images given by URI, and which some exporters leave out of the others too.
  plan.json.images?.forEach((image, index) => {
    const format = infos[index]?.format;
    if (!image.mimeType && format) image.mimeType = `image/${format}`;
  });
  const imageParts = new Map(plan.parts.map((part) => [part.key, part.length]));
  const imageBytes = (plan.json.images ?? []).map(
    (image) => imageParts.get(`bufferView:${image.bufferView}`) ?? null,
  );
  yield { type: 'images', loadId, images: infos, bytes: imageBytes };
  if (plan.json.animations?.length) {
    yield { type: 'animations', loadId, motion: await animationMotion(plan) };
  }
  if (plan.json.extensionsUsed?.includes('EXT_mesh_gpu_instancing')) {
    const nodes = await instanceBounds(plan);
    if (nodes.length > 0) yield { type: 'instances', loadId, nodes };
  }

  const said = [...resources.problems.values(), ...notices];
  if (!plan.drawable) {
    return yield { type: 'failed', loadId, reload, message: texts.nothingDrawn, details: said };
  }
  for (const kind of ['primitives', 'textures', 'animations'] as const) {
    if (plan.dropped[kind] > 0) said.push(texts.dropped(kind, plan.dropped[kind]));
  }

  // The caller waits for the user's word before it asks for the next message.
  if (plan.bytes > largeBytes) yield { type: 'large', loadId, bytes: plan.bytes };
  yield {
    type: 'model',
    loadId,
    reload,
    json: JSON.stringify(plan.json),
    extensions: json.extensionsUsed ?? [],
    parts: plan.parts.length,
    bytes: plan.bytes,
    notices: said,
  };
  yield* partMessages(plan.parts, loadId);
}

type WithMetadata = Gltf & {
  extensions?: { EXT_structural_metadata?: { schema?: unknown; schemaUri?: unknown } };
};

/**
 * The JSON to draw with EXT_structural_metadata's schema in it, when the file gives it as a file
 * of its own: the webview resolves no URIs. A schema that can't be read leaves the metadata out
 * (the model is drawn all the same), and the user is told. Metadata without any schema is left
 * out too: the webview's loader would fail the whole model on it.
 */
async function withSchema(json: WithMetadata, resources: Resources): Promise<WithMetadata> {
  if (!json.extensionsUsed?.includes('EXT_structural_metadata')) return json;
  const metadata = json.extensions?.EXT_structural_metadata;
  if (isObject(metadata) && isObject(metadata.schema)) return json;
  const uri = isObject(metadata) ? metadata.schemaUri : undefined;
  const schema = typeof uri === 'string' ? await readJsonObject(uri, resources) : undefined;
  const extensions = { ...json.extensions };
  if (metadata && schema) {
    const { schemaUri: _, ...rest } = metadata;
    extensions.EXT_structural_metadata = { ...rest, schema };
    return { ...json, extensions };
  }
  delete extensions.EXT_structural_metadata;
  return {
    ...json,
    extensions,
    extensionsUsed: json.extensionsUsed.filter((name) => name !== 'EXT_structural_metadata'),
  };
}

/**
 * Resources a model refers to, each opened once and closed when the load ends; what couldn't
 * be opened is kept, as sentences for the user, by URI.
 */
export class Resources {
  private readonly opened = new Map<string, Promise<ByteSource | ResourceProblem>>();
  readonly problems = new Map<string, string>();

  constructor(
    readonly openResource: ResourceOpener,
    private readonly texts: LoadTexts,
  ) {}

  /** Opens a resource, or says why it can't: nothing is said to the user. */
  open(uri: string): Promise<ByteSource | ResourceProblem> {
    if (!this.opened.has(uri)) this.opened.set(uri, this.openResource(uri));
    return this.opened.get(uri)!;
  }

  /** Where a resource's bytes are; undefined, said to the user, when it can't be opened. */
  async data(uri: string, name = resourceName(uri)): Promise<ResourceData | undefined> {
    const result = await this.open(uri);
    if (typeof result === 'string') {
      this.problem(uri, result, name);
      return undefined;
    }
    return { source: result, offset: 0, available: result.size };
  }

  /** Says why a resource couldn't be opened, once for each. */
  problem(uri: string, problem: ResourceProblem, name: string): void {
    this.problems.set(uri, this.texts.resource(problem, name));
  }

  async close(): Promise<void> {
    for (const result of this.opened.values()) {
      const value = await result.catch(() => 'unreadable' as const);
      if (typeof value !== 'string') await value.close();
    }
  }
}

/** Sizes of the images the plan sends, read from the start of each one's bytes. */
async function imageInfos(plan: RenderPlan): Promise<(ImageInfo | null)[]> {
  const parts = new Map(plan.parts.map((part) => [part.key, part]));
  return Promise.all(
    (plan.json.images ?? []).map(async (image) => {
      const part = parts.get(`bufferView:${image.bufferView}`);
      if (image.bufferView === undefined || !part) return null;
      const head = await part.source.read(part.offset, Math.min(part.length, IMAGE_HEADER_BYTES));
      return readImageInfo(head) ?? null;
    }),
  );
}

/**
 * A block of memory to send as it is: a read of all of it hands out the array itself when the
 * array is all of its buffer, so a large one isn't copied on the way to the webview.
 */
function arraySource(bytes: Uint8Array): ByteSource {
  const whole = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength;
  const copy = memorySource(bytes);
  return {
    size: bytes.length,
    read: (offset, length) =>
      whole && offset === 0 && length === bytes.length
        ? Promise.resolve(bytes)
        : copy.read(offset, length),
    close: async () => {},
  };
}

async function* partMessages(parts: Part[], loadId: number): AsyncGenerator<HostToWebviewMessage> {
  let keys: string[] = [];
  let pieces: Uint8Array[] = [];
  let packed = 0;
  const pack = (): HostToWebviewMessage => {
    const data = new Uint8Array(packed);
    const offsets: number[] = [];
    let offset = 0;
    for (const piece of pieces) {
      offsets.push(offset);
      data.set(piece, offset);
      offset += piece.length;
    }
    const message: HostToWebviewMessage = { type: 'parts', loadId, keys, offsets, data };
    keys = [];
    pieces = [];
    packed = 0;
    return message;
  };

  for (const part of parts) {
    const data = await part.source.read(part.offset, part.length);
    if (part.length >= SMALL_PART) {
      yield { type: 'part', loadId, key: part.key, data };
      continue;
    }
    keys.push(part.key);
    pieces.push(data);
    packed += part.length;
    if (packed >= MESSAGE_BYTES) yield pack();
  }
  if (keys.length > 0) yield pack();
}
