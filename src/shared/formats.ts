import type { MeshFormat, ModelFormat } from './protocol';

const FORMATS: Readonly<Record<string, ModelFormat>> = {
  '.glb': 'glb',
  '.gltf': 'gltf',
  '.obj': 'obj',
  '.stl': 'stl',
  '.ply': 'ply',
  '.b3dm': 'b3dm',
  '.pnts': 'pnts',
  // Only the tileset editor takes JSON files, and only when the user opens one with it.
  '.json': 'tileset',
};

/** File extensions the viewer opens, with the leading dot. */
export const SUPPORTED_EXTENSIONS: readonly string[] = Object.keys(FORMATS);

export function formatForPath(path: string): ModelFormat | undefined {
  const dot = path.lastIndexOf('.');
  if (dot < 0 || dot < path.lastIndexOf('/') || dot < path.lastIndexOf('\\')) {
    return undefined;
  }
  return FORMATS[path.slice(dot).toLowerCase()];
}

/** OBJ, STL, PLY and pnts: read into glTF on the way in, with no glTF JSON of their own to show. */
export function isMeshFormat(format: ModelFormat): format is MeshFormat {
  return format === 'obj' || format === 'stl' || format === 'ply' || format === 'pnts';
}

/** glTF, GLB and b3dm (a GLB inside), which have glTF JSON of their own to show and validate. */
export function isGltfFormat(format: ModelFormat): boolean {
  return format === 'glb' || format === 'gltf' || format === 'b3dm';
}

/** What the formats are called where a sentence names them. */
export const FORMAT_NAMES: Readonly<Record<ModelFormat, string>> = {
  glb: 'GLB',
  gltf: 'glTF',
  obj: 'OBJ',
  stl: 'STL',
  ply: 'PLY',
  b3dm: 'b3dm',
  pnts: 'pnts',
  tileset: '3D Tiles',
};
