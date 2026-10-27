// The renderer's tiles by the paths the tree gives them (`0/2/1`: the root's third child's
// second child), and what each has at the moment. Tiles are the tileset's JSON objects, which
// 3DTilesRendererJS fills in as it walks them; nothing of the library is imported here.
import { Box3, Matrix4, type Object3D } from 'three';
import type { TileState } from '../../shared/protocol';

export interface RendererTile {
  parent?: RendererTile | null;
  children?: RendererTile[];
  internal?: { loadingState?: number };
  traversal?: { visible?: boolean; inFrustum?: boolean; error?: number };
  engineData?: {
    scene?: Object3D | null;
    boundingVolume?: { getOBB(box: Box3, matrix: Matrix4): void } | null;
  };
}

const STATES: Readonly<Record<number, TileState>> = {
  [-1]: 'failed',
  0: 'unloaded',
  1: 'queued',
  2: 'loading',
  3: 'parsing',
  4: 'loaded',
};

/** The tile at `path` under `root`, once the renderer has walked that far. */
export function tileAt(
  root: RendererTile | null | undefined,
  path: string,
): RendererTile | undefined {
  const [first, ...rest] = path.split('/');
  if (!root || first !== '0') return undefined;
  let tile: RendererTile | undefined = root;
  for (const index of rest) tile = tile?.children?.[Number(index)];
  return tile;
}

/** A tile's path: its index in each parent's children, up to the root. */
export function pathOf(tile: RendererTile): string {
  const indices: number[] = [];
  for (let at = tile; at.parent; at = at.parent)
    indices.unshift(at.parent.children?.indexOf(at) ?? 0);
  return ['0', ...indices].join('/');
}

export function tileState(tile: RendererTile): {
  state: TileState;
  drawn: boolean;
  error?: number;
} {
  return {
    state: STATES[tile.internal?.loadingState ?? 0] ?? 'unloaded',
    drawn: tile.traversal?.visible === true,
    error: tile.traversal?.inFrustum ? tile.traversal.error : undefined,
  };
}

/**
 * A tile's bounding volume as a box along its own axes and the matrix that places it in the
 * scene, under `group`; undefined until the renderer has read the tile.
 */
export function tileBox(
  tile: RendererTile,
  group: Object3D,
): { box: Box3; matrix: Matrix4 } | undefined {
  const volume = tile.engineData?.boundingVolume;
  if (!volume) return undefined;
  const box = new Box3();
  const matrix = new Matrix4();
  volume.getOBB(box, matrix);
  if (box.isEmpty()) return undefined;
  group.updateMatrixWorld();
  return { box, matrix: matrix.premultiply(group.matrixWorld) };
}
