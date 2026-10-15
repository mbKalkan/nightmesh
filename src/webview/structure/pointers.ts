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
