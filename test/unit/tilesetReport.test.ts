import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { viewerStrings, type Translate } from '../../src/extension/texts';
import { Formatter } from '../../src/webview/structure/format';
import { TilesetModel, type TilesetContext } from '../../src/webview/structure/tileset';
import {
  jsonPath,
  tilesetReference,
  tilesetReport,
} from '../../src/webview/structure/tilesetReport';

const english: Translate = (message, ...args) =>
  message.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)]));
const strings = viewerStrings(english);
const district = readFileSync(resolve('test/fixtures/tiles/tileset.json'), 'utf8');

const context = (model = new TilesetModel(district)): TilesetContext => ({
  model,
  fileName: 'tileset.json',
  fileSize: district.length,
  strings: strings.tileset,
  fileSizeLabel: strings.structure.labels.fileSize,
  format: new Formatter('en'),
});

describe('a reference to a tileset', () => {
  it('names a tile by its path and content, and where the JSON has it', () => {
    expect(tilesetReference(context(), 'tile:0/3', 'en', false)).toEqual({
      location: 'tile 0/3 "east/tileset.json" (root.children[3])',
      details: undefined,
    });
    expect(tilesetReference(context(), 'model', 'en', false)?.location).toBeUndefined();
    expect(tilesetReference(context(), 'tile:9', 'en', false)).toBeUndefined();
    expect(jsonPath('0')).toBe('root');
  });

  it("leaves out a found tile's place in the JSON, and gives details when asked", () => {
    const model = new TilesetModel(district);
    model.addFound('0/3', [{ content: { uri: 'tower.b3dm' }, geometricError: 0 }]);
    const reference = tilesetReference(context(model), 'tile:0/3/0', 'en', true);
    expect(reference?.location).toBe('tile 0/3/0 "tower.b3dm"');
    expect(reference?.details).toContain('Tile\n- Path: 0/3/0\n- Geometric error: 0');
  });
});

describe('a report on a tileset', () => {
  it('says what the tileset holds, then lists its tiles from the root down', () => {
    const model = new TilesetModel(district);
    model.addFound('0/3', [{ content: { uri: 'tower.b3dm' }, geometricError: 0 }]);
    const { markdown, json } = tilesetReport(context(model), strings);
    expect(markdown).toContain('# tileset.json\n\n_A report by Nightmesh._');
    expect(markdown).toContain('- Tiles in the file: 5');
    expect(markdown).toContain('- Tiles found while loading: 1');
    expect(markdown).toContain(
      [
        '| Path | Content | Geometric error | Refinement |',
        '| --- | --- | ---: | --- |',
        '| `0` | district.b3dm | 20 | REPLACE |',
        '| `0/0` | south-west.b3dm | 0 | REPLACE |',
      ].join('\n'),
    );
    expect(markdown).toContain('| `0/3` | east/tileset.json | 0 | REPLACE |\n| `0/3/0` |');
    const parsed = JSON.parse(json);
    expect(parsed.tiles).toEqual({
      tiles: 5,
      withContent: 5,
      external: 1,
      implicit: 0,
      found: 1,
      depth: 2,
    });
    expect(parsed.tileList.map((tile: { path: string }) => tile.path)).toEqual([
      '0',
      '0/0',
      '0/1',
      '0/2',
      '0/3',
      '0/3/0',
    ]);
    expect(parsed.tileList[5]).toMatchObject({ found: true, contents: [{ kind: 'b3dm' }] });
    expect(parsed.tilesLeftOut).toBe(0);
  });
});
