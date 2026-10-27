import { describe, expect, it } from 'vitest';
import { mergeGltfs } from '../../src/extension/model/merge';
import type { Gltf } from '../../src/extension/model/plan';

/** A model with one of everything that refers to something else. */
const model = (name: string) =>
  ({
    asset: { version: '2.0' },
    extensionsUsed: ['KHR_lights_punctual', 'KHR_draco_mesh_compression'],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: `${name} root`, children: [1], extensions: { KHR_lights_punctual: { light: 0 } } },
      { name: `${name} mesh`, mesh: 0, skin: 0 },
    ],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0 },
            indices: 1,
            material: 0,
            targets: [{ POSITION: 2 }],
            extensions: {
              KHR_draco_mesh_compression: { bufferView: 1, attributes: { POSITION: 0 } },
            },
          },
        ],
      },
    ],
    accessors: [
      { bufferView: 0 },
      { bufferView: 0 },
      { sparse: { indices: { bufferView: 1 }, values: { bufferView: 1 } } },
    ],
    bufferViews: [
      { buffer: 0, byteLength: 4 },
      { buffer: 0, byteLength: 4, extensions: { EXT_meshopt_compression: { buffer: 0 } } },
    ],
    buffers: [{ byteLength: 8 }],
    materials: [
      {
        pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
        extensions: { KHR_materials_clearcoat: { clearcoatTexture: { index: 0 } } },
      },
    ],
    textures: [{ source: 0, sampler: 0 }],
    images: [{ bufferView: 0, mimeType: 'image/png' }],
    samplers: [{}],
    skins: [{ joints: [1], skeleton: 0, inverseBindMatrices: 2 }],
    animations: [
      { channels: [{ sampler: 0, target: { node: 1 } }], samplers: [{ input: 0, output: 1 }] },
    ],
    extensions: { KHR_lights_punctual: { lights: [{ type: 'point' }] } },
  }) as unknown as Gltf;

describe('mergeGltfs', () => {
  it('moves every reference of each model past the ones before it', () => {
    const data = (n: number) => ({ source: { size: n } as never, offset: 0, available: n });
    const { json, buffers } = mergeGltfs([
      { name: 'first', json: model('a'), buffers: [data(1)] },
      { name: 'second', json: model('b'), buffers: [data(2)] },
    ]);
    const merged = json as unknown as Record<string, Record<string, unknown>[]> & {
      scenes: { nodes: number[] }[];
      extensions: { KHR_lights_punctual: { lights: unknown[] } };
    };
    expect(buffers.map((buffer) => buffer?.available)).toEqual([1, 2]);
    // The models' nodes, then a node for each holding its scene.
    expect(merged.nodes.map((node) => node.name)).toEqual([
      'a root',
      'a mesh',
      'b root',
      'b mesh',
      'first',
      'second',
    ]);
    expect(merged.scenes).toEqual([{ nodes: [4, 5] }]);
    expect(merged.nodes[4].children).toEqual([0]);
    expect(merged.nodes[5].children).toEqual([2]);

    expect(merged.nodes[2]).toMatchObject({
      children: [3],
      extensions: { KHR_lights_punctual: { light: 1 } },
    });
    expect(merged.nodes[3]).toMatchObject({ mesh: 1, skin: 1 });
    expect(merged.meshes[1]).toEqual({
      primitives: [
        {
          attributes: { POSITION: 3 },
          indices: 4,
          material: 1,
          targets: [{ POSITION: 5 }],
          // Draco's attributes are ids in its stream, not accessors.
          extensions: {
            KHR_draco_mesh_compression: { bufferView: 3, attributes: { POSITION: 0 } },
          },
        },
      ],
    });
    expect(merged.accessors.slice(3)).toEqual([
      { bufferView: 2 },
      { bufferView: 2 },
      { sparse: { indices: { bufferView: 3 }, values: { bufferView: 3 } } },
    ]);
    expect(merged.bufferViews[3]).toMatchObject({
      buffer: 1,
      extensions: { EXT_meshopt_compression: { buffer: 1 } },
    });
    expect(merged.materials[1]).toMatchObject({
      pbrMetallicRoughness: { baseColorTexture: { index: 1 } },
      extensions: { KHR_materials_clearcoat: { clearcoatTexture: { index: 1 } } },
    });
    expect(merged.textures[1]).toEqual({ source: 1, sampler: 1 });
    expect(merged.images[1]).toMatchObject({ bufferView: 2 });
    expect(merged.skins[1]).toEqual({ joints: [3], skeleton: 2, inverseBindMatrices: 5 });
    expect(merged.animations[1]).toEqual({
      channels: [{ sampler: 0, target: { node: 3 } }],
      samplers: [{ input: 3, output: 4 }],
    });
    expect(merged.extensions.KHR_lights_punctual.lights).toHaveLength(2);
    expect(json.extensionsUsed).toEqual(['KHR_lights_punctual', 'KHR_draco_mesh_compression']);
  });

  it('leaves the models it was given as they were', () => {
    const json = model('a');
    const before = JSON.stringify(json);
    mergeGltfs([
      { name: 'first', json: model('x'), buffers: [] },
      { name: 'second', json, buffers: [] },
    ]);
    expect(JSON.stringify(json)).toBe(before);
  });
});
