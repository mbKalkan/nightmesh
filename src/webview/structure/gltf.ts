// glTF JSON as a file has it. Nothing in it can be trusted to be there or to have the right type,
// so every read checks what it gets: a damaged model shows what it can and never throws.

export type JsonObject = Record<string, unknown>;

export const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

export const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** An array of `length` finite numbers, or undefined. */
export function numbers(value: unknown, length?: number): number[] | undefined {
  if (!Array.isArray(value) || (length !== undefined && value.length !== length)) return undefined;
  return value.every((item) => num(item) !== undefined) ? (value as number[]) : undefined;
}

/** The array kinds of top-level glTF objects this viewer reads. */
export type Collection =
  | 'scenes'
  | 'nodes'
  | 'meshes'
  | 'materials'
  | 'textures'
  | 'images'
  | 'samplers'
  | 'accessors'
  | 'bufferViews'
  | 'buffers'
  | 'animations'
  | 'skins'
  | 'cameras';

/** Marks a node that a scene lists, in `parents`. */
const ROOT = -2;
/** Marks a node not placed in the tree yet, in `parents`. */
const UNREACHED = -1;
/** Marks the top of a subtree that no scene reaches, in `parents`. */
const ORPHAN = -3;

/** One texture as a material uses it: where (`slot`), and which texture coordinates. */
export interface TextureUse {
  material: number;
  slot: string;
  texCoord: number;
}

/** Read access to a parsed glTF document, with the lookups the tree and inspector need. */
export class GltfModel {
  readonly root: JsonObject;
  private readonly lists = new Map<Collection, JsonObject[]>();
  private parentList: Int32Array | undefined;
  private sceneOfRoot: Int32Array | undefined;
  private users = new Map<string, number[][]>();
  private textureUseList: TextureUse[][] | undefined;

  constructor(json: unknown) {
    this.root = isObject(json) ? json : {};
  }

  /** A top-level array, with anything that isn't an object in it read as an empty object. */
  items(collection: Collection): JsonObject[] {
    let items = this.lists.get(collection);
    if (!items) {
      const value = this.root[collection];
      items = Array.isArray(value) ? value.map((item) => (isObject(item) ? item : {})) : [];
      this.lists.set(collection, items);
    }
    return items;
  }

  item(collection: Collection, index: number | undefined): JsonObject | undefined {
    return index === undefined ? undefined : this.items(collection)[index];
  }

  /** `value` if it is a valid index into `collection`. */
  ref(collection: Collection, value: unknown): number | undefined {
    return Number.isInteger(value) && (value as number) >= 0
      ? (value as number) < this.items(collection).length
        ? (value as number)
        : undefined
      : undefined;
  }

  name(collection: Collection | 'lights', index: number): string | undefined {
    const item = collection === 'lights' ? this.lights()[index] : this.items(collection)[index];
    const name = text(item?.name)?.trim();
    return name ? name : undefined;
  }

  /** The name to show: the object's own, or for a texture its image's name or file name. */
  displayName(collection: Collection | 'lights', index: number): string | undefined {
    const own = this.name(collection, index);
    if (own !== undefined || collection !== 'textures') return own;
    const texture = this.items('textures')[index];
    const extensions = isObject(texture?.extensions) ? Object.values(texture.extensions) : [];
    const sources = [
      texture?.source,
      ...extensions.map((item) => (isObject(item) ? item.source : undefined)),
    ];
    for (const source of sources) {
      const image = this.ref('images', source);
      if (image === undefined) continue;
      const name = this.name('images', image) ?? fileName(text(this.items('images')[image].uri));
      if (name) return name;
    }
    return undefined;
  }

  /** `KHR_lights_punctual` lights. */
  lights(): JsonObject[] {
    const extension = this.extension(this.root, 'KHR_lights_punctual');
    const lights = extension?.lights;
    return Array.isArray(lights) ? lights.map((light) => (isObject(light) ? light : {})) : [];
  }

  extension(owner: JsonObject | undefined, name: string): JsonObject | undefined {
    const extensions = owner?.extensions;
    if (!isObject(extensions)) return undefined;
    const extension = extensions[name];
    return isObject(extension) ? extension : undefined;
  }

  /** The light a node holds, through `KHR_lights_punctual`. */
  nodeLight(node: number): number | undefined {
    const light = this.extension(this.items('nodes')[node], 'KHR_lights_punctual')?.light;
    return Number.isInteger(light) &&
      (light as number) >= 0 &&
      (light as number) < this.lights().length
      ? (light as number)
      : undefined;
  }

  /** A node's children as the file lists them, keeping only the ones the tree shows there. */
  children(node: number): number[] {
    const parents = this.parents();
    const children = this.indexList(this.items('nodes')[node]?.children, 'nodes');
    return [...new Set(children)].filter((child) => parents[child] === node);
  }

  /** The nodes a scene lists, keeping only the ones the tree shows there. */
  sceneRoots(scene: number): number[] {
    this.parents();
    const sceneOf = this.sceneOfRoot!;
    return this.indexList(this.items('scenes')[scene]?.nodes, 'nodes').filter(
      (node) => sceneOf[node] === scene,
    );
  }

  /** Nodes that no scene reaches, top-most first: they get a group of their own. */
  unreachedRoots(): number[] {
    const parents = this.parents();
    return this.items('nodes').flatMap((_, node) => (parents[node] === ORPHAN ? [node] : []));
  }

  /** The node that shows `node` in the tree, or undefined for a root. */
  parent(node: number): number | undefined {
    const parent = this.parents()[node];
    return parent >= 0 ? parent : undefined;
  }

  /** The scene whose tree holds `node`, or undefined when no scene reaches it. */
  sceneOf(node: number): number | undefined {
    this.parents();
    let top = node;
    for (let parent = this.parent(top); parent !== undefined; parent = this.parent(top)) {
      top = parent;
    }
    const scene = this.sceneOfRoot![top];
    return scene >= 0 ? scene : undefined;
  }

  /** Nodes using a mesh, skin or camera, or a light. */
  usersOf(kind: 'mesh' | 'skin' | 'camera' | 'light', index: number): number[] {
    let table = this.users.get(kind);
    if (!table) {
      const size =
        kind === 'light'
          ? this.lights().length
          : this.items(kind === 'mesh' ? 'meshes' : kind === 'skin' ? 'skins' : 'cameras').length;
      table = Array.from({ length: size }, () => []);
      this.items('nodes').forEach((node, nodeIndex) => {
        const used =
          kind === 'light'
            ? this.nodeLight(nodeIndex)
            : this.ref(
                kind === 'mesh' ? 'meshes' : kind === 'skin' ? 'skins' : 'cameras',
                node[kind],
              );
        if (used !== undefined) table![used].push(nodeIndex);
      });
      this.users.set(kind, table);
    }
    return table[index] ?? [];
  }

  /** Meshes with a primitive that uses `material`. */
  meshesUsing(material: number): number[] {
    let table = this.users.get('material');
    if (!table) {
      table = this.items('materials').map(() => []);
      this.items('meshes').forEach((mesh, meshIndex) => {
        for (const primitive of objects(mesh.primitives)) {
          const used = this.ref('materials', primitive.material);
          if (used !== undefined && !table![used].includes(meshIndex)) table![used].push(meshIndex);
        }
      });
      this.users.set('material', table);
    }
    return table[material] ?? [];
  }

  /** Where materials use `texture`. */
  textureUses(texture: number): TextureUse[] {
    if (!this.textureUseList) {
      const uses: TextureUse[][] = this.items('textures').map(() => []);
      this.items('materials').forEach((material, materialIndex) => {
        for (const slot of textureSlots(material)) {
          const used = this.ref('textures', slot.info.index);
          if (used === undefined) continue;
          uses[used].push({
            material: materialIndex,
            slot: slot.path,
            texCoord: num(slot.info.texCoord) ?? 0,
          });
        }
      });
      this.textureUseList = uses;
    }
    return this.textureUseList[texture] ?? [];
  }

  /** Indices into `collection` from an array in the file, skipping any that point nowhere. */
  indexList(value: unknown, collection: Collection): number[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      const index = this.ref(collection, item);
      return index === undefined ? [] : [index];
    });
  }

  /**
   * Which node shows each node in the tree: the first parent found going down from the scenes,
   * so a node listed twice, or a loop in a broken file, still gives every node one place.
   */
  private parents(): Int32Array {
    if (this.parentList) return this.parentList;
    const nodes = this.items('nodes');
    const parents = new Int32Array(nodes.length).fill(UNREACHED);
    const sceneOf = new Int32Array(nodes.length).fill(-1);
    const queue: number[] = [];
    const descend = () => {
      while (queue.length > 0) {
        const node = queue.pop()!;
        for (const child of this.indexList(nodes[node].children, 'nodes')) {
          if (parents[child] !== UNREACHED) continue;
          parents[child] = node;
          queue.push(child);
        }
      }
    };
    this.items('scenes').forEach((scene, sceneIndex) => {
      for (const node of this.indexList(scene.nodes, 'nodes')) {
        if (parents[node] !== UNREACHED) continue;
        parents[node] = ROOT;
        sceneOf[node] = sceneIndex;
        queue.push(node);
      }
      descend();
    });
    // What no scene reaches: start from nodes nothing lists as a child, then whatever is left
    // (nodes in a loop), so each still shows once.
    const listed = new Uint8Array(nodes.length);
    nodes.forEach((node) => {
      for (const child of this.indexList(node.children, 'nodes')) listed[child] = 1;
    });
    for (const pass of [0, 1]) {
      nodes.forEach((_, node) => {
        if (parents[node] !== UNREACHED || (pass === 0 && listed[node])) return;
        parents[node] = ORPHAN;
        queue.push(node);
        descend();
      });
    }
    this.sceneOfRoot = sceneOf;
    this.parentList = parents;
    return parents;
  }
}

/** The file name at the end of a relative URI, decoded; undefined for `data:` URIs. */
export function fileName(uri: string | undefined): string | undefined {
  if (!uri || uri.startsWith('data:')) return undefined;
  const last = uri.slice(uri.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(last) || undefined;
  } catch {
    return last || undefined;
  }
}

/** The objects in an array from the file, skipping anything else. */
export function objects(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

/**
 * Every texture slot in a material, wherever it is: `pbrMetallicRoughness.baseColorTexture`,
 * `normalTexture`, `extensions.KHR_materials_clearcoat.clearcoatTexture` and so on.
 */
export function textureSlots(material: JsonObject): { path: string; info: JsonObject }[] {
  const slots: { path: string; info: JsonObject }[] = [];
  const visit = (value: JsonObject, path: string, depth: number) => {
    if (depth > 4) return;
    for (const [key, child] of Object.entries(value)) {
      if (!isObject(child) || key === 'extras') continue;
      const childPath = path ? `${path}.${key}` : key;
      if (key.endsWith('Texture') && 'index' in child) slots.push({ path: childPath, info: child });
      else visit(child, childPath, depth + 1);
    }
  };
  visit(material, '', 0);
  return slots;
}
