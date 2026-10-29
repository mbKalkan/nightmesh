import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readGlbLayout } from '../../src/extension/model/container';
import { instancedGltf, readI3dm } from '../../src/extension/model/i3dm';
import type { Gltf } from '../../src/extension/model/plan';
import { memorySource } from '../../src/extension/model/sources';

const fixture = (name: string) => new Uint8Array(readFileSync(`test/fixtures/${name}`));

async function read(name: string) {
  const tile = await readI3dm(memorySource(fixture(name)));
  if (!('glb' in tile)) throw new Error(`${name} not read: ${JSON.stringify(tile)}`);
  return tile;
}

/** The glTF JSON of a tile's GLB. */
async function gltfOf(tile: Awaited<ReturnType<typeof read>>): Promise<Gltf> {
  const layout = await readGlbLayout(tile.glb);
  if ('failure' in layout) throw new Error('no GLB');
  const text = await tile.glb.read(layout.json.offset, layout.json.length);
  return JSON.parse(new TextDecoder().decode(text)) as Gltf;
}

/** Each instance's translation, rotation and scale as the drawn glTF has them. */
function placed(json: Gltf, buffer: Uint8Array, node = 0) {
  const floats = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
  const { attributes } = (json.nodes![node] as { extensions: Record<string, never> }).extensions
    .EXT_mesh_gpu_instancing as { attributes: Record<string, number> };
  const read = (name: string, size: number) => {
    const accessor = json.accessors![attributes[name]] as { bufferView: number; count: number };
    const view = json.bufferViews![accessor.bufferView];
    const start = (view.byteOffset ?? 0) / 4;
    return Array.from({ length: accessor.count }, (_, i) =>
      [...floats.subarray(start + i * size, start + i * size + size)].map(
        (value) => Math.round(value * 1000) / 1000 + 0,
      ),
    );
  };
  return { t: read('TRANSLATION', 3), r: read('ROTATION', 4), s: read('SCALE', 3) };
}

describe('readI3dm', () => {
  it("reads a tile's tables, places its instances and finds its GLB", async () => {
    const tile = await read('tiles/instanced.i3dm');
    expect(tile.facts).toMatchObject({
      format: 'i3dm',
      version: 1,
      header: 32,
      instances: 9,
      semantics: ['INSTANCES_LENGTH', 'RTC_CENTER', 'EAST_NORTH_UP', 'POSITION', 'SCALE'],
      properties: [{ name: 'name', type: 'JSON' }],
    });
    expect(tile.instances).toHaveLength(9 * 16);
    expect(await readGlbLayout(tile.glb)).toMatchObject({ version: 2, truncated: false });
  });

  it('names a glTF it does not hold, and tells what it cannot read', async () => {
    const external = await readI3dm(memorySource(fixture('tiles/external.i3dm')));
    expect(external).toMatchObject({
      uri: '../textured.gltf',
      facts: { gltfUri: '../textured.gltf', instances: 3 },
    });
    // Its instances are placed as an embedded glTF's are.
    expect('instances' in external && external.instances).toHaveLength(3 * 16);
    expect(await readI3dm(memorySource(fixture('tiles/batched.b3dm')))).toEqual({
      failure: 'notTile',
    });
    const damaged = fixture('tiles/instanced.i3dm').slice(0, 40);
    expect(await readI3dm(memorySource(damaged))).toEqual({ failure: 'damaged' });
  });
});

describe('instancedGltf', () => {
  it('stands instances on the globe upright, around their middle', async () => {
    const tile = await read('tiles/instanced.i3dm');
    const drawn = instancedGltf(await gltfOf(tile), tile.instances)!;
    expect(drawn.json.extensionsUsed).toContain('EXT_mesh_gpu_instancing');
    const { t, r, s } = placed(drawn.json, drawn.buffer);
    // A 3 × 3 grid 10 m apart: east is +X, north is -Z in glTF, and the ground is level.
    expect(t).toEqual([-10, 0, 10].flatMap((x) => [-10, 0, 10].map((north) => [x, 0, -north + 0])));
    for (const rotation of r) expect(rotation).toEqual([0, 0, 0, 1]);
    expect(s.map(([x]) => x)).toEqual([1, 1.5, 2, 1, 1.5, 2, 1, 1.5, 2]);
  });

  it('turns and sizes instances in a tile of their own frame', async () => {
    const tile = await read('tiles/oriented.i3dm');
    const drawn = instancedGltf(await gltfOf(tile), tile.instances)!;
    const { t, r, s } = placed(drawn.json, drawn.buffer);
    // The middle of the four corners is the origin.
    expect(t).toEqual([
      [-10, 0, 10],
      [10, 0, 10],
      [10, 0, -10],
      [-10, 0, -10],
    ]);
    // A quarter turn more about up for each, within 16-bit precision.
    r.forEach((rotation, i) => {
      const [x, y, z, w] = [0, Math.sin((i * Math.PI) / 4), 0, Math.cos((i * Math.PI) / 4)];
      const dot = Math.abs(x * rotation[0] + y * rotation[1] + z * rotation[2] + w * rotation[3]);
      expect(dot).toBeCloseTo(1, 3);
    });
    for (const scale of s) expect(scale).toEqual([2, 1, 1]);
  });

  it('draws nothing more when there are no instances or nothing to instance', () => {
    expect(instancedGltf({ nodes: [{}] } as Gltf, new Float64Array(16))).toBeUndefined();
    expect(
      instancedGltf({ scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }] } as Gltf, new Float64Array()),
    ).toBeUndefined();
  });
});
