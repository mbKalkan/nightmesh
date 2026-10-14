import { describe, expect, it } from 'vitest';
import { planRender, type Gltf, type ResourceData } from '../../src/extension/model/plan';
import { memorySource } from '../../src/extension/model/sources';

const bytes = (length: number): ResourceData => ({
  source: memorySource(new Uint8Array(length)),
  offset: 0,
  available: length,
});

/** Two meshes on two buffers, a texture, an animation and a skin. */
const model = (): Gltf => ({
  asset: { version: '2.0' },
  buffers: [
    { uri: 'a.bin', byteLength: 64 },
    { uri: 'b.bin', byteLength: 64 },
  ],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: 36 },
    { buffer: 0, byteOffset: 36, byteLength: 6 },
    { buffer: 1, byteOffset: 0, byteLength: 36 },
    { buffer: 1, byteOffset: 36, byteLength: 12 },
  ],
  accessors: [{ bufferView: 0 }, { bufferView: 1 }, { bufferView: 2 }, { bufferView: 3 }],
  meshes: [
    { primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] },
    { primitives: [{ attributes: { POSITION: 2 }, material: 0 } as never] },
  ],
  nodes: [{ mesh: 0 }, { mesh: 1, skin: 0, weights: [0] }],
  images: [{ uri: 'paint.png' }],
  textures: [{ source: 0 }],
  materials: [
    {
      pbrMetallicRoughness: { baseColorTexture: { index: 0 }, baseColorFactor: [1, 1, 1, 1] },
      extensions: { KHR_materials_clearcoat: { clearcoatTexture: { index: 0 } } },
    },
  ],
  skins: [{ inverseBindMatrices: 3 }],
  animations: [{ channels: [{ sampler: 0 }], samplers: [{ input: 3, output: 3 }] }],
});

describe('planRender', () => {
  it('asks for every bufferView, and for images given by URI as new ones', () => {
    const plan = planRender(model(), [bytes(64), bytes(64)], [bytes(100)]);

    expect(plan.parts.map((part) => [part.key, part.offset, part.length])).toEqual([
      ['bufferView:0', 0, 36],
      ['bufferView:1', 36, 6],
      ['bufferView:2', 0, 36],
      ['bufferView:3', 36, 12],
      ['bufferView:4', 0, 100],
    ]);
    expect(plan.json.images).toEqual([{ bufferView: 4 }]);
    expect(plan.json.bufferViews?.[4]).toEqual({ buffer: 2, byteLength: 100 });
    expect(plan.bytes).toBe(190);
    expect(plan.drawable).toBe(true);
    expect(plan.dropped).toEqual({ primitives: 0, textures: 0, animations: 0 });
  });

  it('leaves out what a missing buffer holds and draws the rest', () => {
    const plan = planRender(model(), [bytes(64), undefined], [bytes(100)]);

    expect(plan.json.meshes?.[1].primitives).toEqual([]);
    expect(plan.json.nodes?.[1]).toEqual({});
    expect(plan.json.nodes?.[0]).toEqual({ mesh: 0 });
    expect(plan.json.skins?.[0]).toEqual({});
    // Emptied, not removed: animations keep their indices.
    expect(plan.json.animations).toEqual([{ channels: [], samplers: [{ input: 3, output: 3 }] }]);
    expect(plan.dropped).toEqual({ primitives: 1, textures: 0, animations: 1 });
    expect(plan.drawable).toBe(true);
  });

  it('says when no geometry at all can be had', () => {
    expect(planRender(model(), [undefined, undefined], [undefined]).drawable).toBe(false);
  });

  it('drops textures whose image is missing from every slot that uses them', () => {
    const plan = planRender(model(), [bytes(64), bytes(64)], [undefined]);

    expect(plan.json.materials?.[0]).toEqual({
      pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] },
      extensions: { KHR_materials_clearcoat: {} },
    });
    expect(plan.dropped.textures).toBe(1);
  });

  it('treats views past the end of a cut-off buffer as missing', () => {
    const cut: ResourceData = { ...bytes(64), available: 40 };
    const plan = planRender(model(), [bytes(64), cut], [bytes(100)]);

    expect(plan.parts.map((part) => part.key)).not.toContain('bufferView:3');
    expect(plan.dropped.animations).toBe(1);
    expect(plan.json.meshes?.[1].primitives).toHaveLength(1);
  });

  it('sends meshopt-compressed data as a buffer the decoder reads', () => {
    const json: Gltf = {
      asset: { version: '2.0' },
      buffers: [{ byteLength: 400 }, { uri: 'packed.bin', byteLength: 50 }],
      bufferViews: [
        {
          buffer: 0,
          byteLength: 400,
          extensions: { EXT_meshopt_compression: { buffer: 1, byteOffset: 10, byteLength: 40 } },
        },
      ],
    };
    const plan = planRender(json, [undefined, bytes(50)], []);

    expect(plan.parts.map((part) => [part.key, part.offset, part.length])).toEqual([
      ['buffer:2', 10, 40],
    ]);
    expect(plan.json.bufferViews?.[0].extensions?.EXT_meshopt_compression).toEqual({
      buffer: 2,
      byteOffset: 0,
      byteLength: 40,
    });
  });

  it('leaves the original JSON alone', () => {
    const original = model();
    const copy = structuredClone(original);
    planRender(original, [undefined, undefined], [undefined]);
    expect(original).toEqual(copy);
  });
});
