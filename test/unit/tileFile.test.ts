import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readGlbLayout } from '../../src/extension/model/container';
import { memorySource } from '../../src/extension/model/sources';
import { readB3dm } from '../../src/extension/model/tileFile';

const fixture = (name: string) => new Uint8Array(readFileSync(`test/fixtures/${name}`));

/** A GLB to put in a tile: the smallest fixture. */
const glb = fixture('triangle.glb');

/** A tile with a header of `words` after the magic, then `body`, then the GLB. */
function tile(words: number[], body = ''): Uint8Array {
  const text = new TextEncoder().encode(body);
  const bytes = new Uint8Array(4 + 4 * words.length + text.length + glb.length);
  bytes.set(new TextEncoder().encode('b3dm'));
  const view = new DataView(bytes.buffer);
  words.forEach((word, index) => view.setUint32(4 + 4 * index, word, true));
  bytes.set(text, 4 + 4 * words.length);
  bytes.set(glb, bytes.length - glb.length);
  return bytes;
}

async function read(bytes: Uint8Array) {
  const result = await readB3dm(memorySource(bytes));
  if ('failure' in result) throw new Error(`b3dm not read: ${result.failure}`);
  return result;
}

describe('readB3dm', () => {
  it("reads a tile's tables and finds the GLB after them", async () => {
    const { facts, glb: content } = await read(fixture('tiles/batched.b3dm'));
    expect(facts).toMatchObject({
      format: 'b3dm',
      version: 1,
      header: 28,
      batchLength: 3,
      properties: [
        { name: 'name', type: 'JSON' },
        { name: 'year', type: 'JSON' },
        { name: 'height', type: 'FLOAT SCALAR' },
      ],
      extensions: [],
    });
    // Istanbul, in Earth-centered coordinates.
    expect(facts.rtcCenter?.map(Math.round)).toEqual([4216542, 2335190, 4163110]);
    expect(facts.batchTable.binary).toBe(16);
    expect(await readGlbLayout(content)).toMatchObject({ version: 2, truncated: false });
  });

  it('reads RTC_CENTER from the binary body too', async () => {
    const json = JSON.stringify({ BATCH_LENGTH: 0, RTC_CENTER: { byteOffset: 0 } });
    const center = new Float32Array([1000, -2000, 3000.5]);
    const bytes = tile([1, 0, json.length, 12, 0, 0], json + ' '.repeat(12));
    bytes.set(new Uint8Array(center.buffer), 28 + json.length);
    expect((await read(bytes)).facts.rtcCenter).toEqual([1000, -2000, 3000.5]);
  });

  it('reads the headers of tiles from before 3D Tiles 1.0', async () => {
    const batch = '{"id":[1,2]}';
    // Magic, version, byte length, batch length, batch table length.
    const first = await read(tile([1, 0, 2, batch.length], batch));
    expect(first.facts).toMatchObject({ header: 20, batchLength: 2, batchTable: { json: 12 } });
    expect(first.facts.properties).toEqual([{ name: 'id', type: 'JSON' }]);
    expect(await readGlbLayout(first.glb)).toMatchObject({ version: 2 });

    // Magic, version, byte length, batch table JSON and binary lengths, batch length.
    const second = await read(tile([1, 0, batch.length, 0, 2], batch));
    expect(second.facts).toMatchObject({ header: 24, batchLength: 2, batchTable: { json: 12 } });
    expect(await readGlbLayout(second.glb)).toMatchObject({ version: 2 });
  });

  it('tells what it cannot read', async () => {
    expect(await readB3dm(memorySource(fixture('triangle.glb')))).toEqual({ failure: 'notTile' });
    expect(await readB3dm(memorySource(fixture('tiles/damaged.b3dm')))).toEqual({
      failure: 'damaged',
    });
    expect(await readB3dm(memorySource(tile([2, 0, 0, 0, 0, 0])))).toEqual({
      failure: 'version',
      version: 2,
    });
    // Tables longer than the file.
    expect(await readB3dm(memorySource(tile([1, 0, 1e6, 0, 0, 0])))).toEqual({
      failure: 'damaged',
    });
  });

  it('keeps going past tables it cannot parse', async () => {
    const { facts } = await read(tile([1, 0, 8, 0, 0, 0], 'not json'));
    expect(facts).toMatchObject({ batchLength: 0, properties: [] });
  });
});
