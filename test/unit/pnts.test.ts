import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MeshFormatError, type MeshPart } from '../../src/extension/model/mesh/geometry';
import { decodePoints } from '../../src/extension/model/mesh/draco';
import { readPnts as readWithout } from '../../src/extension/model/mesh/pnts';
import { withMemory } from './memory';

const readPnts = (bytes: Uint8Array) => readWithout(bytes, decodePoints);
const fixture = (name: string) => new Uint8Array(readFileSync(`test/fixtures/${name}`));
/** Points in the dome fixtures: 24 rings of 48, and the top. */
const POINTS = 24 * 48 + 1;

/** A pnts tile with `featureTable` and its binary body, padded as writers do. */
function tile(featureTable: object, body: Uint8Array = new Uint8Array()): Uint8Array {
  let json = JSON.stringify(featureTable);
  json += ' '.repeat((8 - ((28 + json.length) % 8)) % 8);
  const bytes = new Uint8Array(28 + json.length + body.length);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('pnts'));
  view.setUint32(4, 1, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, json.length, true);
  view.setUint32(16, body.length, true);
  bytes.set(new TextEncoder().encode(json), 28);
  bytes.set(body, 28 + json.length);
  return bytes;
}

const part = async (bytes: Uint8Array): Promise<MeshPart> => {
  const mesh = await readPnts(bytes);
  expect(mesh.objects).toHaveLength(1);
  return mesh.objects[0].parts[0];
};

describe('readPnts', () => {
  it('reads positions, colors and what the tile says about itself', async () => {
    const mesh = await readPnts(fixture('tiles/points.pnts'));
    expect(mesh.facts).toMatchObject({
      format: 'pnts',
      version: 1,
      header: 28,
      points: POINTS,
      batchLength: 0,
      semantics: ['POINTS_LENGTH', 'RTC_CENTER', 'POSITION', 'RGB'],
      properties: [{ name: 'intensity', type: 'JSON' }],
      extensions: [],
    });
    expect(mesh.offset).toBeUndefined();
    const points = mesh.objects[0].parts[0];
    expect(points.mode).toBe('points');
    expect(points.positions).toHaveLength(POINTS * 3);
    // The top of the dome, 10 m up: Z is up in a tile's frame.
    expect([...points.positions.slice(-3)].map((value) => Number(value.toFixed(3)))).toEqual([
      0, 0, 10,
    ]);
    expect(points.colors).toHaveLength(POINTS * 4);
    expect(points.alpha).toBeUndefined();
    expect(points.normals).toBeUndefined();
  });

  it('reads quantized positions, see-through colors and packed normals', async () => {
    const plain = await part(fixture('tiles/points.pnts'));
    const compact = await part(fixture('tiles/quantized.pnts'));
    // Within the quantization step: 20 m over 65535.
    compact.positions.forEach((value, i) => expect(value).toBeCloseTo(plain.positions[i], 3));
    expect(compact.alpha).toBe(true);
    // Opaque near the top, half see-through below.
    expect(compact.colors?.[POINTS * 4 - 1]).toBe(65535);
    expect(compact.colors?.[3]).toBe(128 * 257);
    // Each normal points out of the dome, as its position does, within two bytes' precision.
    const normals = compact.normals!;
    for (let i = 0; i < POINTS; i++) {
      const [x, y, z] = [0, 1, 2].map((axis) => plain.positions[i * 3 + axis] / 10);
      const dot = normals[i * 3] * x + normals[i * 3 + 1] * y + normals[i * 3 + 2] * z;
      expect(dot).toBeGreaterThan(0.99);
    }
  });

  it('reads RGB565 and a color for the whole tile', async () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0]);
    const body = new Uint8Array(28);
    body.set(new Uint8Array(positions.buffer));
    new DataView(body.buffer).setUint16(24, 0xf800, true);
    new DataView(body.buffer).setUint16(26, 0x001f, true);
    const rgb565 = await part(
      tile({ POINTS_LENGTH: 2, POSITION: { byteOffset: 0 }, RGB565: { byteOffset: 24 } }, body),
    );
    expect([...rgb565.colors!]).toEqual([65535, 0, 0, 65535, 0, 0, 65535, 65535]);

    const constant = await part(
      tile({ POINTS_LENGTH: 2, POSITION: { byteOffset: 0 }, CONSTANT_RGBA: [255, 0, 0, 51] }, body),
    );
    expect([...constant.colors!.slice(0, 4)]).toEqual([65535, 0, 0, 51 * 257]);
    expect(constant.alpha).toBe(true);
  });

  it('moves coordinates far from the origin near it', async () => {
    const positions = new Float32Array([4216542, 2335190, 4163110, 4216552, 2335190, 4163110]);
    const mesh = await readPnts(
      tile({ POINTS_LENGTH: 2, POSITION: { byteOffset: 0 } }, new Uint8Array(positions.buffer)),
    );
    expect(mesh.offset).toEqual([4216542, 2335190, 4163110]);
    expect([...mesh.objects[0].parts[0].positions]).toEqual([0, 0, 0, 10, 0, 0]);
  });

  it('decodes positions and colors compressed with Draco, beside plain normals', async () => {
    const mesh = await readPnts(fixture('tiles/draco.pnts'));
    expect(mesh.problems).toEqual([]);
    expect(mesh.facts).toMatchObject({ extensions: ['3DTILES_draco_point_compression'] });
    const draco = mesh.objects[0].parts[0];
    const exact = await part(fixture('tiles/points.pnts'));
    // Within 14 bits over the dome's 20 m, in the order the normals in the body follow.
    draco.positions.forEach((value, i) => expect(value).toBeCloseTo(exact.positions[i], 2));
    expect([...draco.colors!]).toEqual([...exact.colors!]);
    expect(draco.alpha).toBeUndefined();
    for (let i = 0; i < POINTS; i++) {
      const [x, y, z] = [0, 1, 2].map((axis) => draco.positions[i * 3 + axis] / 10);
      const n = draco.normals!;
      expect(n[i * 3] * x + n[i * 3 + 1] * y + n[i * 3 + 2] * z).toBeGreaterThan(0.99);
    }
  });

  it('says what it cannot draw, and draws nothing out of bounds', async () => {
    const draco = (extension: object, points = 5) =>
      readPnts(
        tile(
          {
            POINTS_LENGTH: points,
            POSITION: { byteOffset: 0 },
            extensions: { '3DTILES_draco_point_compression': extension },
          },
          new Uint8Array(16).fill(7),
        ),
      );
    const outside = await draco({ properties: { POSITION: 0 }, byteOffset: 8, byteLength: 16 });
    expect(outside.objects).toEqual([]);
    expect(outside.problems).toEqual([
      { kind: 'compressed', reason: 'its data is outside the feature table' },
    ]);
    expect(outside.facts).toMatchObject({ extensions: ['3DTILES_draco_point_compression'] });
    const damaged = await draco({ properties: { POSITION: 0 }, byteOffset: 0, byteLength: 16 });
    expect(damaged.problems).toEqual([{ kind: 'compressed', reason: expect.any(String) }]);

    // The real thing, with a count or an attribute the data doesn't have.
    const bytes = fixture('tiles/draco.pnts');
    const json = new DataView(bytes.buffer).getUint32(12, true);
    const table = JSON.parse(new TextDecoder().decode(bytes.subarray(28, 28 + json)));
    const body = bytes.subarray(28 + json);
    const extension = table.extensions['3DTILES_draco_point_compression'];
    const wrong = async (change: object, points = table.POINTS_LENGTH) =>
      (
        await readPnts(
          tile(
            {
              POINTS_LENGTH: points,
              extensions: { '3DTILES_draco_point_compression': { ...extension, ...change } },
            },
            body,
          ),
        )
      ).problems;
    expect(await wrong({}, 5)).toEqual([
      { kind: 'compressed', reason: `${table.POINTS_LENGTH} points, the tile says 5` },
    ]);
    expect(await wrong({ properties: { POSITION: 0, NORMAL: 9 } })).toEqual([
      { kind: 'compressed', reason: 'no NORMAL with id 9' },
    ]);

    // Without the decoder, as in the extension host's own thread.
    expect((await readWithout(fixture('tiles/draco.pnts'))).problems).toEqual([
      { kind: 'compressed', reason: 'no decoder here' },
    ]);

    // POSITION past the end of the body.
    expect(
      (await readPnts(tile({ POINTS_LENGTH: 5, POSITION: { byteOffset: 0 } }))).objects,
    ).toEqual([]);
    await expect(readPnts(fixture('tiles/batched.b3dm'))).rejects.toThrow(MeshFormatError);
    await expect(readPnts(tile({}).fill(0, 4, 8))).rejects.toThrow(MeshFormatError);
  });

  it('makes no room for points a damaged count says are there, but are not', async () => {
    const points = 100_000_000;
    const body = new Uint8Array(16);
    for (const table of [
      { POINTS_LENGTH: points },
      { POINTS_LENGTH: points, POSITION: { byteOffset: 0 } },
      { POINTS_LENGTH: points, POSITION_QUANTIZED: { byteOffset: 0 } },
    ]) {
      const mesh = await withMemory(64 * 1024 * 1024, () => readPnts(tile(table, body)));
      expect(mesh.facts).toMatchObject({ points });
      expect(mesh.objects).toEqual([]);
    }
  });
});
