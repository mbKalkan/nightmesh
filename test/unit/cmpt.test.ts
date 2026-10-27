import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readCmpt } from '../../src/extension/model/cmpt';
import { memorySource } from '../../src/extension/model/sources';

const fixture = (name: string) => new Uint8Array(readFileSync(`test/fixtures/${name}`));

describe('readCmpt', () => {
  it('finds the tiles in a composite, and those in the composites inside it', async () => {
    const result = await readCmpt(memorySource(fixture('tiles/composite.cmpt')));
    if (!('tiles' in result)) throw new Error(JSON.stringify(result));
    expect(result.facts).toMatchObject({ format: 'cmpt', version: 1, header: 16 });
    expect(result.facts.tiles.map(({ path, format }) => `${path} ${format}`)).toEqual([
      '1 b3dm',
      '2 i3dm',
      '3 cmpt',
      '3/1 pnts',
    ]);
    // Each tile's bytes are its own, starting with its magic.
    const [b3dm] = result.tiles;
    expect(new TextDecoder().decode(await b3dm.source.read(0, 4))).toBe('b3dm');
    expect(b3dm.source.size).toBe(result.facts.tiles[0].bytes);
  });

  it('tells what it cannot read, and stops at a tile that runs past the end', async () => {
    expect(await readCmpt(memorySource(fixture('tiles/batched.b3dm')))).toEqual({
      failure: 'notTile',
    });
    const bytes = fixture('tiles/composite.cmpt');
    const version = bytes.slice();
    new DataView(version.buffer).setUint32(4, 2, true);
    expect(await readCmpt(memorySource(version))).toEqual({ failure: 'version', version: 2 });

    // Cut inside the second tile: the first is still read.
    const cut = await readCmpt(memorySource(bytes.slice(0, 16 + 5648 + 100)));
    if (!('tiles' in cut)) throw new Error(JSON.stringify(cut));
    expect(cut.tiles.map((tile) => tile.format)).toEqual(['b3dm']);
  });
});
