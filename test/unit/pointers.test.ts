import { describe, expect, it } from 'vitest';
import { GltfModel } from '../../src/webview/structure/gltf';
import { entryAt, pointerTokens } from '../../src/webview/structure/pointers';
import { ModelUsage } from '../../src/webview/structure/usage';

const model = new GltfModel({
  asset: { version: '2.0' },
  scenes: [{ nodes: [0] }],
  nodes: [
    { mesh: 0 },
    { extensions: { EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: 6 } } } },
  ],
  meshes: [
    {
      primitives: [
        { attributes: { POSITION: 0 }, indices: 1, targets: [{ POSITION: 2 }] },
        { attributes: {}, extensions: { KHR_draco_mesh_compression: { bufferView: 3 } } },
      ],
    },
  ],
  animations: [{ samplers: [{ input: 3, output: 4 }], channels: [] }],
  skins: [{ inverseBindMatrices: 5, joints: [0] }],
  accessors: [
    { bufferView: 0 },
    { bufferView: 1 },
    { bufferView: 0 },
    {},
    { bufferView: 2 },
    { sparse: { indices: { bufferView: 5 }, values: { bufferView: 5 } } },
    {},
    { bufferView: 0 },
  ],
  bufferViews: [{}, {}, {}, {}, {}, {}, {}],
  images: [{ bufferView: 4 }, { uri: 'a.png' }],
  samplers: [{}, {}],
  textures: [{ source: 1, sampler: 1, extensions: { KHR_texture_basisu: { source: 0 } } }],
  extensions: { KHR_lights_punctual: { lights: [{ type: 'point' }] } },
});
const usage = new ModelUsage(model);
const at = (pointer: string) => entryAt(model, usage, pointer);

describe('pointerTokens', () => {
  it('splits a pointer and unescapes its tokens', () => {
    expect(pointerTokens('')).toEqual([]);
    expect(pointerTokens('/meshes/0/name')).toEqual(['meshes', '0', 'name']);
    expect(pointerTokens('/extras/a~1b~0c')).toEqual(['extras', 'a/b~c']);
    expect(pointerTokens('meshes/0')).toBeUndefined();
  });
});

describe('entryAt', () => {
  it('finds the entry a pointer is in', () => {
    expect(at('/nodes/1/extensions')).toBe('node:1');
    expect(at('/meshes/0/primitives/0/attributes/POSITION')).toBe('mesh:0');
    expect(at('/animations/0/channels')).toBe('animation:0');
    expect(at('/extensions/KHR_lights_punctual/lights/0/type')).toBe('light:0');
  });

  it('follows data to what uses it', () => {
    expect(at('/accessors/1')).toBe('mesh:0');
    expect(at('/accessors/4/min')).toBe('animation:0');
    expect(at('/accessors/5')).toBe('skin:0');
    expect(at('/accessors/6')).toBe('node:1');
    expect(at('/bufferViews/2')).toBe('animation:0');
    expect(at('/bufferViews/3')).toBe('mesh:0');
    expect(at('/bufferViews/5')).toBe('skin:0');
    expect(at('/images/0')).toBe('texture:0');
    expect(at('/images/1/uri')).toBe('texture:0');
    expect(at('/samplers/1')).toBe('texture:0');
  });

  it('takes the model for the rest, and nothing for what nothing uses', () => {
    expect(at('')).toBe('model');
    expect(at('/asset/version')).toBe('model');
    expect(at('/extensionsUsed/0')).toBe('model');
    expect(at('/nodes/9')).toBe('model');
    expect(at('/accessors/7')).toBeUndefined();
    expect(at('/bufferViews/6')).toBeUndefined();
    expect(at('/samplers/0')).toBeUndefined();
    expect(at('nodes')).toBeUndefined();
  });

  it('knows what each accessor is for', () => {
    expect(usage.accessors.map((uses) => uses.map((use) => use.role))).toEqual([
      ['vertices'],
      ['indices'],
      ['morphTargets'],
      ['animation'],
      ['animation'],
      ['skins'],
      ['instancing'],
      [],
    ]);
    expect(usage.views[0].accessors).toEqual([0, 2, 7]);
    expect(usage.views[3].draco).toEqual([0]);
    expect(usage.views[4].images).toEqual([0]);
  });
});
