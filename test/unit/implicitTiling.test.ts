import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ContentsSubtreeLoader,
  binarySubtree,
  type ImplicitTile,
} from '../../src/webview/scene/implicitTiling';

/** An implicit root of a quadtree two levels deep, in one subtree. */
function implicitRoot(): ImplicitTile {
  const root: Record<string, unknown> = {
    boundingVolume: { box: [0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 1] },
    geometricError: 10,
    refine: 'REPLACE',
    content: { uri: 'content/{level}/{x}/{y}.glb' },
    implicitTiling: {
      subdivisionScheme: 'QUADTREE',
      subtreeLevels: 2,
      availableLevels: 2,
      subtrees: { uri: 'subtrees/{level}/{x}/{y}.subtree' },
    },
    children: [],
  };
  // The renderer's implicit root is its own root.
  root.implicitTilingData = { root, level: 0, x: 0, y: 0, z: 0 };
  return root as unknown as ImplicitTile;
}

afterEach(() => vi.unstubAllGlobals());

describe("an implicit tileset's subtree", () => {
  it('gives its tiles when a buffer only its property tables need is missing', async () => {
    const fetched: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      fetched.push(url);
      return { ok: false, status: 404 };
    });
    const tile = implicitRoot();
    const loader = new ContentsSubtreeLoader(tile);
    loader.workingPath = 'https://tiles.invalid/set';
    await loader.parse(
      binarySubtree({
        buffers: [{ uri: 'tables.bin', byteLength: 8 }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 8 }],
        propertyTables: [{ class: 'tile', count: 5, properties: { height: { values: 0 } } }],
        tileMetadata: 0,
        tileAvailability: { constant: 1 },
        contentAvailability: [{ constant: 1 }],
        childSubtreeAvailability: { constant: 0 },
      }),
    );
    expect(fetched).toEqual(['https://tiles.invalid/set/subtrees/0/0/tables.bin']);
    // The root, with its four children.
    const [first] = (tile as unknown as { children: { children: object[] }[] }).children;
    expect(first.children).toHaveLength(4);
  });
});
