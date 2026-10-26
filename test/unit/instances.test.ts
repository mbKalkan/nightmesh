import { describe, expect, it } from 'vitest';
import { instanceBounds } from '../../src/extension/model/instances';
import type { Gltf, Part } from '../../src/extension/model/plan';
import { memorySource } from '../../src/extension/model/sources';

type Values = { type: string; values: number[]; componentType?: number; sparse?: boolean };

/**
 * A metre cube, and one node drawing it with GPU instances whose transforms are `attributes`:
 * each a list of float values, or of 16-bit normalized ones, one bufferView per accessor.
 */
function model(attributes: Record<string, Values>) {
  const chunks: Uint8Array[] = [];
  const views: { buffer: number; byteOffset: number; byteLength: number }[] = [];
  let length = 0;
  const accessors: object[] = [
    { componentType: 5126, count: 8, type: 'VEC3', min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
  ];
  const refs: Record<string, number> = {};
  for (const [name, { type, values, componentType = 5126, sparse }] of Object.entries(attributes)) {
    const bytes = new Uint8Array(
      componentType === 5122
        ? new Int16Array(values.map((value) => Math.round(value * 32767))).buffer
        : new Float32Array(values).buffer,
    );
    views.push({ buffer: 0, byteOffset: length, byteLength: bytes.length });
    chunks.push(bytes);
    length += bytes.length;
    const components = { VEC3: 3, VEC4: 4 }[type]!;
    accessors.push({
      bufferView: views.length - 1,
      componentType,
      normalized: componentType !== 5126,
      count: values.length / components,
      type,
      ...(sparse ? { sparse: { count: 0 } } : {}),
    });
    refs[name] = accessors.length - 1;
  }
  const all = new Uint8Array(length);
  chunks.reduce((at, chunk) => (all.set(chunk, at), at + chunk.length), 0);
  const json = {
    asset: { version: '2.0' },
    extensionsUsed: ['EXT_mesh_gpu_instancing'],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0, extensions: { EXT_mesh_gpu_instancing: { attributes: refs } } }],
    accessors,
    bufferViews: views,
  };
  const source = memorySource(all);
  const parts: Part[] = views.map((view, index) => ({
    key: `bufferView:${index}`,
    source,
    offset: view.byteOffset,
    length: view.byteLength,
  }));
  return { json: json as unknown as Gltf, parts };
}

/** A turn of `degrees` about Z, as a quaternion. */
const aboutZ = (degrees: number) => {
  const half = (degrees * Math.PI) / 360;
  return [0, 0, Math.sin(half), Math.cos(half)];
};

const rounded = (nodes: { node: number; min: number[]; max: number[] }[]) =>
  nodes.map(({ node, min, max }) => ({
    node,
    min: min.map((value) => Number(value.toFixed(4)) + 0),
    max: max.map((value) => Number(value.toFixed(4)) + 0),
  }));

describe('instanceBounds', () => {
  it('places the mesh at each translation', async () => {
    const plan = model({
      TRANSLATION: { type: 'VEC3', values: [-2, 0.5, 0, 0, 0.5, 0, 2, 0.5, 0] },
    });
    expect(await instanceBounds(plan)).toEqual([
      { node: 0, min: [-2.5, 0, -0.5], max: [2.5, 1, 0.5] },
    ]);
  });

  it('scales, then turns, then moves each instance', async () => {
    // Stretched to 2 m along X, then turned a quarter about Z: 2 m tall instead.
    const plan = model({
      TRANSLATION: { type: 'VEC3', values: [0, 0, 0, 10, 0, 0] },
      ROTATION: { type: 'VEC4', values: [...aboutZ(90), ...aboutZ(0)] },
      SCALE: { type: 'VEC3', values: [2, 1, 1, 1, 1, 1] },
    });
    expect(rounded(await instanceBounds(plan))).toEqual([
      { node: 0, min: [-0.5, -1, -0.5], max: [10.5, 1, 0.5] },
    ]);
  });

  it('reads rotations stored as normalized integers', async () => {
    const plan = model({ ROTATION: { type: 'VEC4', values: aboutZ(45), componentType: 5122 } });
    const [{ min, max }] = await instanceBounds(plan);
    // A metre cube turned an eighth: as wide as its diagonal.
    expect(max[0] - min[0]).toBeCloseTo(Math.SQRT2, 3);
    expect(max[2] - min[2]).toBeCloseTo(1, 5);
  });

  it('leaves out nodes whose transforms it cannot read', async () => {
    const sparse = model({ TRANSLATION: { type: 'VEC3', values: [1, 2, 3], sparse: true } });
    expect(await instanceBounds(sparse)).toEqual([]);
    const uneven = model({
      TRANSLATION: { type: 'VEC3', values: [1, 2, 3, 4, 5, 6] },
      SCALE: { type: 'VEC3', values: [1, 1, 1] },
    });
    expect(await instanceBounds(uneven)).toEqual([]);
  });
});
