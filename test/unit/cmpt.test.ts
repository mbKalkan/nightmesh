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

  it("names a composite it doesn't read among the tiles, which then say it isn't drawn", async () => {
    const composite = (...tiles: Uint8Array[]) => {
      const length = 16 + tiles.reduce((sum, tile) => sum + tile.length, 0);
      const bytes = new Uint8Array(length);
      const view = new DataView(bytes.buffer);
      bytes.set(new TextEncoder().encode('cmpt'));
      view.setUint32(4, 1, true);
      view.setUint32(8, length, true);
      view.setUint32(12, tiles.length, true);
      tiles.reduce((at, tile) => (bytes.set(tile, at), at + tile.length), 16);
      return bytes;
    };
    // Ten inside one another, in one more: eight inside are read, the ninth isn't.
    let deep = fixture('tiles/batched.b3dm');
    for (let i = 0; i < 10; i++) deep = composite(deep);
    // Too short to hold even a composite's header.
    const short = composite().subarray(0, 12);
    new DataView(short.buffer).setUint32(8, 12, true);

    const result = await readCmpt(memorySource(composite(deep, short)));
    if (!('tiles' in result)) throw new Error(JSON.stringify(result));
    expect(result.tiles.map(({ path, format }) => `${path} ${format}`)).toEqual([
      `${'1/'.repeat(8)}1 cmpt`,
      '2 cmpt',
    ]);
  });
});
