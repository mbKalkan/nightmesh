import type { StructureGroup, StructureKind, StructureStrings } from '../../shared/protocol';
import type { Collection, GltfModel } from './gltf';

/** `model`, `group:<group>` or `<kind>:<index>`, e.g. `node:12`. */
export type EntryKey = string;

export type EntryIcon = Extract<
  StructureKind,
  | 'model'
  | 'scene'
  | 'node'
  | 'mesh'
  | 'material'
  | 'texture'
  | 'animation'
  | 'skin'
  | 'camera'
  | 'light'
>;

/** One row of the structure tree. Children are built the first time they're asked for. */
export interface OutlineEntry {
  key: EntryKey;
  label: string;
  /** Dimmed text after the label, as VS Code's trees show it. */
  description?: string;
  icon: EntryIcon;
  /** Groups show how many things they hold. */
  count?: number;
  children?: () => OutlineEntry[];
}

/** The kinds of things listed in groups below the scenes, in order. */
const GROUPS: { group: StructureGroup; kind: EntryIcon; collection: Collection | 'lights' }[] = [
  { group: 'meshes', kind: 'mesh', collection: 'meshes' },
  { group: 'materials', kind: 'material', collection: 'materials' },
  { group: 'textures', kind: 'texture', collection: 'textures' },
  { group: 'animations', kind: 'animation', collection: 'animations' },
  { group: 'skins', kind: 'skin', collection: 'skins' },
  { group: 'cameras', kind: 'camera', collection: 'cameras' },
  { group: 'lights', kind: 'light', collection: 'lights' },
];

export const entryKey = (kind: StructureKind, index: number): EntryKey => `${kind}:${index}`;

/** The kind and index an entry key names; undefined for the model and groups. */
export function parseKey(key: EntryKey): { kind: StructureKind; index: number } | undefined {
  const match = /^([a-z]+):(\d+)$/.exec(key);
  return match ? { kind: match[1] as StructureKind, index: Number(match[2]) } : undefined;
}

/**
 * The tree for a model: the model itself, its scenes with their node hierarchies, nodes no scene
 * reaches, then a group per kind of thing it holds (meshes, materials and so on).
 */
export function outline(model: GltfModel, strings: StructureStrings): OutlineEntry[] {
  const label = (kind: StructureKind, collection: Collection | 'lights', index: number) =>
    model.displayName(collection, index) ?? `${strings.kinds[kind]} ${index}`;

  const node = (index: number): OutlineEntry => {
    const item = model.items('nodes')[index];
    const mesh = model.ref('meshes', item.mesh);
    const children = model.children(index);
    const name = model.name('nodes', index);
    return {
      key: entryKey('node', index),
      label: name ?? `${strings.kinds.node} ${index}`,
      // An unnamed node is often known by its mesh's name.
      description:
        name === undefined && mesh !== undefined ? model.name('meshes', mesh) : undefined,
      icon: nodeIcon(model, index, mesh),
      children: children.length > 0 ? () => children.map(node) : undefined,
    };
  };

  const entries: OutlineEntry[] = [{ key: 'model', label: strings.kinds.model, icon: 'model' }];
  model.items('scenes').forEach((_, index) => {
    const roots = model.sceneRoots(index);
    entries.push({
      key: entryKey('scene', index),
      label: label('scene', 'scenes', index),
      icon: 'scene',
      children: () => roots.map(node),
    });
  });
  const unreached = model.unreachedRoots();
  if (unreached.length > 0) {
    const group = model.items('scenes').length > 0 ? 'otherNodes' : 'nodes';
    entries.push({
      key: `group:${group}`,
      label: strings.groups[group],
      icon: 'node',
      count: unreached.length,
      children: () => unreached.map(node),
    });
  }
  for (const { group, kind, collection } of GROUPS) {
    const size = collection === 'lights' ? model.lights().length : model.items(collection).length;
    if (size === 0) continue;
    entries.push({
      key: `group:${group}`,
      label: strings.groups[group],
      icon: kind,
      count: size,
      children: () =>
        Array.from({ length: size }, (_, index) => ({
          key: entryKey(kind, index),
          label: label(kind, collection, index),
          icon: kind,
        })),
    });
  }
  return entries;
}

/**
 * The keys of the entries to expand for `key` to show, top first: its group, or its scene and the
 * nodes above it. Empty when it is at the top already or isn't in the tree.
 */
export function ancestors(model: GltfModel, key: EntryKey): EntryKey[] {
  const parsed = parseKey(key);
  if (!parsed) return [];
  if (parsed.kind !== 'node') {
    const group = GROUPS.find((candidate) => candidate.kind === parsed.kind);
    return group ? [`group:${group.group}`] : [];
  }
  const path: EntryKey[] = [];
  let top = parsed.index;
  for (let parent = model.parent(top); parent !== undefined; parent = model.parent(top)) {
    path.unshift(entryKey('node', parent));
    top = parent;
  }
  const scene = model.sceneOf(parsed.index);
  if (scene !== undefined) path.unshift(entryKey('scene', scene));
  else path.unshift(model.items('scenes').length > 0 ? 'group:otherNodes' : 'group:nodes');
  return path;
}

/**
 * What to open when a model is first shown: its scenes, and below each a run of nodes that have
 * one child each, as exporters often wrap a model in several, so the first real level shows.
 */
export function initiallyExpanded(model: GltfModel): EntryKey[] {
  const keys: EntryKey[] = [];
  model.items('scenes').forEach((_, scene) => {
    keys.push(entryKey('scene', scene));
    let level = model.sceneRoots(scene);
    for (let depth = 0; level.length === 1 && depth < 8; depth++) {
      const children = model.children(level[0]);
      if (children.length === 0) break;
      keys.push(entryKey('node', level[0]));
      level = children;
    }
  });
  return keys;
}

function nodeIcon(model: GltfModel, index: number, mesh: number | undefined): EntryIcon {
  const node = model.items('nodes')[index];
  if (mesh !== undefined) return 'mesh';
  if (model.ref('cameras', node.camera) !== undefined) return 'camera';
  if (model.nodeLight(index) !== undefined) return 'light';
  return 'node';
}
