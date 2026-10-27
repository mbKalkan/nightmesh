import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MeshFormatError, type MeshPart } from '../../src/extension/model/mesh/geometry';
import { readPnts } from '../../src/extension/model/mesh/pnts';

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

const part = (bytes: Uint8Array): MeshPart => {
  const mesh = readPnts(bytes);
  expect(mesh.objects).toHaveLength(1);
  return mesh.objects[0].parts[0];
};

describe('readPnts', () => {
  it('reads positions, colors and what the tile says about itself', () => {
    const mesh = readPnts(fixture('tiles/points.pnts'));
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

  it('reads quantized positions, see-through colors and packed normals', () => {
    const plain = part(fixture('tiles/points.pnts'));
    const compact = part(fixture('tiles/quantized.pnts'));
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

  it('reads RGB565 and a color for the whole tile', () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0]);
    const body = new Uint8Array(28);
    body.set(new Uint8Array(positions.buffer));
    new DataView(body.buffer).setUint16(24, 0xf800, true);
    new DataView(body.buffer).setUint16(26, 0x001f, true);
    const rgb565 = part(
      tile({ POINTS_LENGTH: 2, POSITION: { byteOffset: 0 }, RGB565: { byteOffset: 24 } }, body),
    );
    expect([...rgb565.colors!]).toEqual([65535, 0, 0, 65535, 0, 0, 65535, 65535]);

    const constant = part(
      tile({ POINTS_LENGTH: 2, POSITION: { byteOffset: 0 }, CONSTANT_RGBA: [255, 0, 0, 51] }, body),
    );
    expect([...constant.colors!.slice(0, 4)]).toEqual([65535, 0, 0, 51 * 257]);
    expect(constant.alpha).toBe(true);
  });

  it('moves coordinates far from the origin near it', () => {
    const positions = new Float32Array([4216542, 2335190, 4163110, 4216552, 2335190, 4163110]);
    const mesh = readPnts(
      tile({ POINTS_LENGTH: 2, POSITION: { byteOffset: 0 } }, new Uint8Array(positions.buffer)),
    );
    expect(mesh.offset).toEqual([4216542, 2335190, 4163110]);
    expect([...mesh.objects[0].parts[0].positions]).toEqual([0, 0, 0, 10, 0, 0]);
  });

  it('says what it cannot draw, and draws nothing out of bounds', () => {
    const draco = readPnts(
      tile({
        POINTS_LENGTH: 5,
        POSITION: { byteOffset: 0 },
        extensions: {
          '3DTILES_draco_point_compression': {
            properties: { POSITION: 0 },
            byteOffset: 0,
            byteLength: 0,
          },
        },
      }),
    );
    expect(draco.objects).toEqual([]);
    expect(draco.problems).toEqual([{ kind: 'compressed' }]);
    expect(draco.facts).toMatchObject({ extensions: ['3DTILES_draco_point_compression'] });

    // POSITION past the end of the body.
    expect(readPnts(tile({ POINTS_LENGTH: 5, POSITION: { byteOffset: 0 } })).objects).toEqual([]);
    expect(() => readPnts(fixture('tiles/batched.b3dm'))).toThrow(MeshFormatError);
    expect(() => readPnts(tile({}).fill(0, 4, 8))).toThrow(MeshFormatError);
  });
});
