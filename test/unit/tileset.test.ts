import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { viewerStrings, type Translate } from '../../src/extension/texts';
import { Formatter } from '../../src/webview/structure/format';
import {
  TilesetModel,
  contentKind,
  inspectTileset,
  tileAncestors,
  tilesetOutline,
  type TilesetContext,
} from '../../src/webview/structure/tileset';
import { pathOf, tileAt, tileState, type RendererTile } from '../../src/webview/scene/tileTree';

const english: Translate = (message, ...args) =>
  message.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)]));
const strings = viewerStrings(english);
const district = readFileSync(resolve('test/fixtures/tiles/tileset.json'), 'utf8');

const context = (json: string, live?: TilesetContext['live']): TilesetContext => ({
  model: new TilesetModel(json),
  fileName: 'tileset.json',
  fileSize: json.length,
  strings: strings.tileset,
  fileSizeLabel: strings.structure.labels.fileSize,
  format: new Formatter('en'),
  live,
});

/** An inspection's rows as `label: text`, by section. */
const rows = (json: string, key: string, live?: TilesetContext['live']) =>
  Object.fromEntries(
    (inspectTileset(context(json, live), key)?.sections ?? []).map((section) => [
      section.title,
      section.rows.map(
        (row) => `${row.label}: ${row.text ?? row.json}${row.note ? ` (${row.note})` : ''}`,
      ),
    ]),
  );

describe('TilesetModel', () => {
  it('reads the tile tree, by paths from the root', () => {
    const model = new TilesetModel(district);
    expect([...model.tiles.keys()]).toEqual(['0', '0/0', '0/1', '0/2', '0/3']);
    expect(model.root?.children).toEqual(['0/0', '0/1', '0/2', '0/3']);
    expect(model.tiles.get('0/3')?.contents).toEqual([
      { uri: 'east/tileset.json', kind: 'tileset' },
    ]);
    expect(model.counts()).toEqual({ tiles: 5, withContent: 5, external: 1, implicit: 0 });
    expect(model.depth).toBe(1);
  });

  it('takes refinement from above when a tile says none', () => {
    const model = new TilesetModel(district);
    expect(model.tiles.get('0')).toMatchObject({ refine: 'REPLACE', inherited: false });
    expect(model.tiles.get('0/1')).toMatchObject({ refine: 'REPLACE', inherited: true });
  });

  it('reads multiple contents, implicit tiling and the old content url', () => {
    const model = new TilesetModel(
      JSON.stringify({
        asset: { version: '1.1' },
        root: {
          contents: [{ uri: 'a.glb' }, { uri: 'b.pnts' }],
          implicitTiling: {
            subdivisionScheme: 'QUADTREE',
            subtreeLevels: 3,
            availableLevels: 6,
            subtrees: { uri: 'subtrees/{level}/{x}/{y}.subtree' },
          },
          children: [{ content: { url: 'old.b3dm' } }],
        },
      }),
    );
    expect(model.root?.contents.map((content) => content.kind)).toEqual(['glb', 'pnts']);
    expect(model.root?.implicit).toEqual({
      scheme: 'QUADTREE',
      subtreeLevels: 3,
      availableLevels: 6,
      subtrees: 'subtrees/{level}/{x}/{y}.subtree',
    });
    expect(model.tiles.get('0/0')?.contents[0]).toEqual({ uri: 'old.b3dm', kind: 'b3dm' });
  });

  it('reads a deep tree without running out of stack, and anything else as empty', () => {
    // Written out: stringifying a tree this deep runs out of stack itself.
    const deep = `{"root":${'{"children":['.repeat(3000)}{}${']}'.repeat(3000)}}`;
    expect(new TilesetModel(deep).depth).toBe(3000);
    expect(new TilesetModel('not json').tiles.size).toBe(0);
    expect(new TilesetModel('{"root": [1]}').tiles.size).toBe(0);
  });

  it('tells content by its file', () => {
    expect(contentKind('a/b.B3DM?v=2')).toBe('b3dm');
    expect(contentKind('sub/tileset.json')).toBe('tileset');
    expect(contentKind('terrain.terrain')).toBe('other');
  });
});

describe('the tree and the inspector', () => {
  it('lists the tileset, then its tiles by their content', () => {
    const [model, root] = tilesetOutline(
      new TilesetModel(district),
      'tileset.json',
      strings.tileset,
    );
    expect(model).toMatchObject({ key: 'model', label: 'tileset.json' });
    expect(root).toMatchObject({ key: 'tile:0', label: 'district.b3dm', description: '0' });
    expect(root.children?.().map((entry) => entry.label)).toEqual([
      'south-west.b3dm',
      'north-west.b3dm',
      'south-east.b3dm',
      'east/tileset.json',
    ]);
    const empty = tilesetOutline(new TilesetModel('{"root":{}}'), 'x.json', strings.tileset)[1];
    expect(empty).toMatchObject({ label: 'Tile 0', description: undefined });
  });

  it('opens the tiles above one', () => {
    const model = new TilesetModel(district);
    expect(tileAncestors(model, 'tile:0/3')).toEqual(['tile:0']);
    expect(tileAncestors(model, 'tile:0')).toEqual([]);
  });

  it('says what the tileset holds, and what the renderer has of it', () => {
    const live = {
      tile: () => undefined,
      stats: () => ({ loaded: 4, drawn: 3, downloading: 1, failed: 0, bytes: 2048 }),
    };
    const sections = rows(district, 'model', live);
    expect(sections.Tileset).toContain('3D Tiles version: 1.0');
    expect(sections.Tiles).toEqual([
      'Tiles in the file: 5',
      'Depth: 2',
      'With content: 5',
      'External tilesets: 1',
    ]);
    expect(sections['In the view']).toEqual([
      'Tiles loaded: 4',
      'Tiles drawn: 3',
      'Tiles on their way: 1',
      'Memory: 2 KB',
    ]);
  });

  it("says what a tile is, where it is, and how it's drawn", () => {
    const live = {
      tile: () => ({ state: 'loaded' as const, drawn: true, error: 12.5 }),
      stats: () => undefined,
    };
    const sections = rows(district, 'tile:0/1', live);
    expect(sections.Tile).toEqual([
      'Path: 0/1',
      'Geometric error: 0',
      'Refinement: REPLACE (from above)',
    ]);
    expect(sections.Content).toEqual([': north-west.b3dm', 'Type: Batched 3D Model (b3dm)']);
    expect(sections['Bounding volume']).toEqual([
      'Type: Box',
      'Center: [-25, 25, 15]',
      'Half sizes: [25, 25, 15] m',
    ]);
    expect(sections['In the view']).toEqual([
      'State: Loaded',
      'Drawn: Yes',
      'Screen-space error: 12.5 px',
    ]);
    expect(rows(district, 'tile:0').Tile).toContain('Children: 4');
    expect(inspectTileset(context(district), 'tile:9')).toBeUndefined();
  });

  it('gives a region in degrees and heights', () => {
    const json = JSON.stringify({
      root: { boundingVolume: { region: [0.5, 0.7, 0.51, 0.71, -10, 90] } },
    });
    expect(rows(json, 'tile:0')['Bounding volume']).toEqual([
      'Type: Region',
      'West: 28.648°',
      'South: 40.107°',
      'East: 29.221°',
      'North: 40.68°',
      'Lowest height: -10 m',
      'Highest height: 90 m',
    ]);
  });
});

describe('the renderer’s tiles', () => {
  const root: RendererTile = { children: [] };
  const child: RendererTile = { parent: root, children: [] };
  const grandchild: RendererTile = {
    parent: child,
    internal: { loadingState: 4 },
    traversal: { visible: true, inFrustum: true, error: 3 },
  };
  root.children!.push({ parent: root }, child);
  child.children!.push(grandchild);

  it('finds a tile by its path, and a path for a tile', () => {
    expect(tileAt(root, '0/1/0')).toBe(grandchild);
    expect(tileAt(root, '0/5')).toBeUndefined();
    expect(tileAt(root, '1')).toBeUndefined();
    expect(pathOf(grandchild)).toBe('0/1/0');
    expect(pathOf(root)).toBe('0');
  });

  it('says what the renderer has of a tile', () => {
    expect(tileState(grandchild)).toEqual({ state: 'loaded', drawn: true, error: 3 });
    expect(tileState(root)).toEqual({ state: 'unloaded', drawn: false, error: undefined });
    expect(tileState({ internal: { loadingState: -1 } }).state).toBe('failed');
  });
});
