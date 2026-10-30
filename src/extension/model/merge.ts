// Several glTF models as one, as a composite tile is shown: every index each model has is moved
// past those of the models before it, and each model's scene becomes a node of the one scene.
import type { Gltf, ResourceData } from './plan';

export interface MergePart {
  /** The name of the node that holds the model. */
  name: string;
  json: Gltf;
  /** Where each of its buffers' bytes are, by index. */
  buffers: (ResourceData | undefined)[];
}

type Json = Record<string, unknown>;

/** Arrays at the top of glTF JSON that others refer to by index, and the root extensions' arrays. */
const ARRAYS = [
  'accessors',
  'animations',
  'buffers',
  'bufferViews',
  'cameras',
  'images',
  'materials',
  'meshes',
  'nodes',
  'samplers',
  'skins',
  'textures',
] as const;

/** EXT_structural_metadata's arrays at the root, which primitives and feature ID sets refer to. */
const METADATA_ARRAYS = ['propertyTables', 'propertyTextures', 'propertyAttributes'] as const;
const METADATA = 'EXT_structural_metadata';

type Offsets = Record<
  (typeof ARRAYS)[number] | (typeof METADATA_ARRAYS)[number] | 'lights' | 'variants',
  number
>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const list = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(isObject) : []);
const extension = (owner: Json, name: string): Json | undefined =>
  isObject(owner.extensions) && isObject(owner.extensions[name])
    ? owner.extensions[name]
    : undefined;

/** Adds `by` to `owner[key]` when it is an index. */
function shift(owner: Json | undefined, key: string, by: number): void {
  if (owner && typeof owner[key] === 'number') owner[key] = (owner[key] as number) + by;
}

/** Adds `by` to every index in `owner[key]`, a list or a map of them. */
function shiftAll(owner: Json | undefined, key: string, by: number): void {
  const value = owner?.[key];
  if (Array.isArray(value))
    owner![key] = value.map((index) => (typeof index === 'number' ? index + by : index));
  else if (isObject(value)) for (const name of Object.keys(value)) shift(value, name, by);
}

/**
 * Texture references in a material, its extensions included: glTF names every one `…Texture`
 * with an `index`.
 */
function shiftTextures(value: unknown, by: number): void {
  if (Array.isArray(value)) value.forEach((item) => shiftTextures(item, by));
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (key.endsWith('Texture') && isObject(child)) shift(child, 'index', by);
    shiftTextures(child, by);
  }
}

/** Moves every reference in one model's JSON past the models before it. */
function shiftModel(json: Json, o: Offsets): void {
  for (const node of list(json.nodes)) {
    shiftAll(node, 'children', o.nodes);
    shift(node, 'mesh', o.meshes);
    shift(node, 'skin', o.skins);
    shift(node, 'camera', o.cameras);
    shift(extension(node, 'KHR_lights_punctual'), 'light', o.lights);
    shiftAll(extension(node, 'EXT_mesh_gpu_instancing'), 'attributes', o.accessors);
    for (const set of list(extension(node, 'EXT_instance_features')?.featureIds)) {
      shift(set, 'propertyTable', o.propertyTables);
    }
  }
  for (const mesh of list(json.meshes)) {
    for (const primitive of list(mesh.primitives)) {
      shiftAll(primitive, 'attributes', o.accessors);
      shift(primitive, 'indices', o.accessors);
      shift(primitive, 'material', o.materials);
      for (const target of list(primitive.targets)) {
        for (const name of Object.keys(target)) shift(target, name, o.accessors);
      }
      shift(extension(primitive, 'KHR_draco_mesh_compression'), 'bufferView', o.bufferViews);
      for (const mapping of list(extension(primitive, 'KHR_materials_variants')?.mappings)) {
        shift(mapping, 'material', o.materials);
        shiftAll(mapping, 'variants', o.variants);
      }
      for (const set of list(extension(primitive, 'EXT_mesh_features')?.featureIds)) {
        if (isObject(set.texture)) shift(set.texture, 'index', o.textures);
        shift(set, 'propertyTable', o.propertyTables);
      }
      const metadata = extension(primitive, METADATA);
      shiftAll(metadata, 'propertyTextures', o.propertyTextures);
      shiftAll(metadata, 'propertyAttributes', o.propertyAttributes);
    }
  }
  const root = extension(json, METADATA);
  for (const table of list(root?.propertyTables)) {
    for (const property of Object.values(isObject(table.properties) ? table.properties : {})) {
      if (!isObject(property)) continue;
      for (const key of ['values', 'arrayOffsets', 'stringOffsets']) {
        shift(property, key, o.bufferViews);
      }
    }
  }
  for (const texture of list(root?.propertyTextures)) {
    for (const property of Object.values(isObject(texture.properties) ? texture.properties : {})) {
      if (isObject(property)) shift(property, 'index', o.textures);
    }
  }
  for (const accessor of list(json.accessors)) {
    shift(accessor, 'bufferView', o.bufferViews);
    if (isObject(accessor.sparse)) {
      shift(accessor.sparse.indices as Json, 'bufferView', o.bufferViews);
      shift(accessor.sparse.values as Json, 'bufferView', o.bufferViews);
    }
  }
  for (const view of list(json.bufferViews)) {
    shift(view, 'buffer', o.buffers);
    for (const name of ['EXT_meshopt_compression', 'KHR_meshopt_compression']) {
      shift(extension(view, name), 'buffer', o.buffers);
    }
  }
  for (const image of list(json.images)) shift(image, 'bufferView', o.bufferViews);
  for (const texture of list(json.textures)) {
    shift(texture, 'source', o.images);
    shift(texture, 'sampler', o.samplers);
    for (const name of ['KHR_texture_basisu', 'EXT_texture_webp', 'EXT_texture_avif']) {
      shift(extension(texture, name), 'source', o.images);
    }
  }
  for (const material of list(json.materials)) shiftTextures(material, o.textures);
  for (const skin of list(json.skins)) {
    shiftAll(skin, 'joints', o.nodes);
    shift(skin, 'skeleton', o.nodes);
    shift(skin, 'inverseBindMatrices', o.accessors);
  }
  for (const animation of list(json.animations)) {
    for (const channel of list(animation.channels)) shift(channel.target as Json, 'node', o.nodes);
    for (const sampler of list(animation.samplers)) {
      shift(sampler, 'input', o.accessors);
      shift(sampler, 'output', o.accessors);
    }
  }
}

/** The one metadata schema of the merged models: the classes and enums of each, by name. */
class Schema {
  private id: unknown;
  // Without a prototype, so that a name such as `__proto__` is a name like any other.
  private readonly classes: Json = Object.create(null) as Json;
  private readonly enums: Json = Object.create(null) as Json;
  private added = false;

  /** Adds a model's schema; false when there is none, or a name in it is taken by another. */
  add(schema: unknown): boolean {
    if (!isObject(schema)) return false;
    const kinds = [
      [this.classes, isObject(schema.classes) ? schema.classes : {}],
      [this.enums, isObject(schema.enums) ? schema.enums : {}],
    ] as const;
    const taken = kinds.some(([into, items]) =>
      Object.entries(items).some(
        ([name, item]) =>
          Object.hasOwn(into, name) && JSON.stringify(into[name]) !== JSON.stringify(item),
      ),
    );
    if (taken) return false;
    for (const [into, items] of kinds) Object.assign(into, items);
    this.id ??= schema.id;
    this.added = true;
    return true;
  }

  /** The schema, when a model had one. */
  get json(): Json | undefined {
    if (!this.added) return undefined;
    const json: Json = { id: typeof this.id === 'string' ? this.id : 'schema' };
    if (Object.keys(this.classes).length > 0) json.classes = { ...this.classes };
    if (Object.keys(this.enums).length > 0) json.enums = { ...this.enums };
    return json;
  }
}

/** Leaves a model's metadata out: its tables and what refers to them. */
function withoutMetadata(json: Json): void {
  if (isObject(json.extensions)) delete json.extensions[METADATA];
  for (const mesh of list(json.meshes)) {
    for (const primitive of list(mesh.primitives)) {
      if (isObject(primitive.extensions)) delete primitive.extensions[METADATA];
      for (const set of list(extension(primitive, 'EXT_mesh_features')?.featureIds)) {
        delete set.propertyTable;
      }
    }
  }
  for (const node of list(json.nodes)) {
    for (const set of list(extension(node, 'EXT_instance_features')?.featureIds)) {
      delete set.propertyTable;
    }
  }
}

/**
 * One glTF holding every part: a scene with a node for each part, named for it, over the part's
 * default scene. Root extensions other than lights, material variants and metadata are left
 * out. Metadata needs its schema in the JSON (load.ts `withSchema`); a model whose schema names a
 * class or enum another model's already has as something else is drawn without its metadata.
 */
export function mergeGltfs(parts: readonly MergePart[]): {
  json: Gltf;
  buffers: (ResourceData | undefined)[];
} {
  const merged: Json = { asset: { version: '2.0' } };
  const buffers: (ResourceData | undefined)[] = [];
  const used = new Set<string>();
  const required = new Set<string>();
  const lights: Json[] = [];
  const variants: Json[] = [];
  const holders: Json[] = [];
  const schema = new Schema();
  const metadata = Object.fromEntries(METADATA_ARRAYS.map((name) => [name, [] as Json[]]));

  for (const part of parts) {
    const json = structuredClone(part.json) as Json;
    if (!schema.add(extension(json, METADATA)?.schema)) withoutMetadata(json);
    const offsets = Object.fromEntries([
      ...ARRAYS.map((name) => [name, ((merged[name] as unknown[]) ?? []).length]),
      ...METADATA_ARRAYS.map((name) => [name, metadata[name].length]),
    ]) as Offsets;
    offsets.lights = lights.length;
    offsets.variants = variants.length;
    shiftModel(json, offsets);
    for (const name of METADATA_ARRAYS) {
      metadata[name].push(...list(extension(json, METADATA)?.[name]));
    }
    for (const name of ARRAYS) {
      const items = Array.isArray(json[name]) ? (json[name] as unknown[]) : [];
      merged[name] = [...((merged[name] as unknown[]) ?? []), ...items];
    }
    buffers.push(
      ...part.buffers,
      ...Array(Math.max(0, list(json.buffers).length - part.buffers.length)),
    );
    lights.push(...list(extension(json, 'KHR_lights_punctual')?.lights));
    variants.push(...list(extension(json, 'KHR_materials_variants')?.variants));
    for (const name of Array.isArray(json.extensionsUsed) ? json.extensionsUsed : [])
      used.add(name);
    for (const name of Array.isArray(json.extensionsRequired) ? json.extensionsRequired : [])
      required.add(name);

    const scenes = list(json.scenes);
    const scene = scenes[typeof json.scene === 'number' ? json.scene : 0];
    const roots = Array.isArray(scene?.nodes) ? (scene.nodes as number[]) : [];
    holders.push({ name: part.name, children: roots.map((root) => root + offsets.nodes) });
  }

  const nodes = merged.nodes as Json[];
  const first = nodes.length;
  nodes.push(...holders);
  merged.scenes = [{ nodes: holders.map((_, index) => first + index) }];
  merged.scene = 0;
  const extensions: Json = {};
  if (lights.length > 0) extensions.KHR_lights_punctual = { lights };
  if (variants.length > 0) extensions.KHR_materials_variants = { variants };
  if (schema.json) {
    extensions[METADATA] = {
      schema: schema.json,
      ...Object.fromEntries(
        METADATA_ARRAYS.filter((name) => metadata[name].length > 0).map((name) => [
          name,
          metadata[name],
        ]),
      ),
    };
  } else {
    used.delete(METADATA);
    required.delete(METADATA);
  }
  if (Object.keys(extensions).length > 0) merged.extensions = extensions;
  if (used.size > 0) merged.extensionsUsed = [...used];
  if (required.size > 0) merged.extensionsRequired = [...required];
  for (const name of ARRAYS) if ((merged[name] as unknown[]).length === 0) delete merged[name];
  return { json: merged as Gltf, buffers };
}
