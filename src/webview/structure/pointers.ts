import type { StructureKind } from '../../shared/protocol';
import type { GltfModel } from './gltf';
import { entryKey, type EntryKey } from './outline';
import type { ModelUsage } from './usage';

/** Top-level arrays whose items are entries of the structure tree. */
const ENTRIES: Record<string, StructureKind> = {
  scenes: 'scene',
  nodes: 'node',
  meshes: 'mesh',
  materials: 'material',
  textures: 'texture',
  animations: 'animation',
  skins: 'skin',
  cameras: 'camera',
};

/** The tokens of a JSON pointer: `/meshes/0/name` is `meshes`, `0`, `name`. */
export function pointerTokens(pointer: string): string[] | undefined {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) return undefined;
  return pointer
    .slice(1)
    .split('/')
    .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/**
 * The structure entry a JSON pointer is about, or the nearest one that has it: an accessor, a
 * bufferView, an image or a sampler leads to what uses it. Undefined when nothing does, or the
 * pointer doesn't lead into the model.
 */
export function entryAt(
  model: GltfModel,
  usage: ModelUsage,
  pointer: string,
): EntryKey | undefined {
  const tokens = pointerTokens(pointer);
  if (!tokens) return undefined;
  const [collection, position] = tokens;
  const index = position !== undefined && /^\d+$/.test(position) ? Number(position) : undefined;
  if (collection === undefined || index === undefined) {
    if (collection === 'extensions' && tokens[1] === 'KHR_lights_punctual') {
      const light = tokens[2] === 'lights' ? Number(tokens[3]) : NaN;
      if (Number.isInteger(light) && light < model.lights().length) {
        return entryKey('light', light);
      }
    }
    return 'model';
  }

  const kind = ENTRIES[collection];
  if (kind) {
    return index < model.items(collection as Parameters<GltfModel['items']>[0]).length
      ? entryKey(kind, index)
      : 'model';
  }
  switch (collection) {
    case 'accessors':
      return usage.accessorOwner(index);
    case 'bufferViews':
      return usage.viewOwner(index);
    case 'images': {
      const texture = usage.images[index]?.[0];
      return texture === undefined ? undefined : entryKey('texture', texture);
    }
    case 'samplers': {
      const texture = usage.samplers[index]?.[0];
      return texture === undefined ? undefined : entryKey('texture', texture);
    }
    default:
      return 'model';
  }
}

/** Collections in the JSON, by the kind of entry in them and the group that lists them. */
const COLLECTIONS: Record<string, string> = {
  scene: '/scenes',
  node: '/nodes',
  mesh: '/meshes',
  material: '/materials',
  texture: '/textures',
  animation: '/animations',
  skin: '/skins',
  camera: '/cameras',
  light: '/extensions/KHR_lights_punctual/lights',
  nodes: '/nodes',
  otherNodes: '/nodes',
  meshes: '/meshes',
  materials: '/materials',
  textures: '/textures',
  animations: '/animations',
  skins: '/skins',
  cameras: '/cameras',
  lights: '/extensions/KHR_lights_punctual/lights',
};

/** The JSON pointer of a structure entry: `node:3` is `/nodes/3`, the model the whole JSON. */
export function entryPointer(key: EntryKey): string {
  const group = /^group:(\w+)$/.exec(key);
  if (group) return COLLECTIONS[group[1]] ?? '';
  const entry = /^([a-z]+):(\d+)$/.exec(key);
  if (!entry || !COLLECTIONS[entry[1]]) return '';
  return `${COLLECTIONS[entry[1]]}/${entry[2]}`;
}
