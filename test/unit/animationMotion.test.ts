import { describe, expect, it } from 'vitest';
import { animationMotion } from '../../src/extension/model/animationMotion';
import type { Gltf, Part } from '../../src/extension/model/plan';
import { memorySource } from '../../src/extension/model/sources';

/**
 * A node at rest at x = 1, and animations of its translation built from `keys`: each is a list of
 * keyframe values, all in one buffer, one bufferView per accessor.
 */
function model(
  animations: { keys: number[][]; interpolation?: string }[],
  node = { translation: [1, 0, 0] },
) {
  const floats: number[] = [];
  const views: { buffer: number; byteOffset: number; byteLength: number }[] = [];
  const accessors: object[] = [];
  const add = (values: number[], type: string, count: number) => {
    views.push({ buffer: 0, byteOffset: floats.length * 4, byteLength: values.length * 4 });
    floats.push(...values);
    accessors.push({ bufferView: views.length - 1, componentType: 5126, count, type });
    return accessors.length - 1;
  };
  const json = {
    asset: { version: '2.0' },
    nodes: [node],
    accessors,
    bufferViews: views,
    animations: animations.map(({ keys, interpolation }) => {
      // A cubic spline's output holds an in-tangent, a value and an out-tangent per key.
      const count = interpolation === 'CUBICSPLINE' ? keys.length / 3 : keys.length;
      const input = add(
        Array.from({ length: count }, (_, i) => i),
        'SCALAR',
        count,
      );
      const output = add(keys.flat(), 'VEC3', keys.length);
      return {
        channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }],
        samplers: [{ input, output, interpolation }],
      };
    }),
  };
  const bytes = new Uint8Array(new Float32Array(floats).buffer);
  const source = memorySource(bytes);
  const parts: Part[] = views.map((view, index) => ({
    key: `bufferView:${index}`,
    source,
    offset: view.byteOffset,
    length: view.byteLength,
  }));
  return { json: json as unknown as Gltf, parts };
}

describe('animationMotion', () => {
  it('tells clips that move from ones that hold a pose or move nothing', async () => {
    const plan = model([
      {
        keys: [
          [1, 0, 0],
          [2, 0, 0],
        ],
      },
      {
        keys: [
          [3, 0, 0],
          [3, 0, 0],
        ],
      },
      {
        keys: [
          [1, 0, 0],
          [1, 0, 0],
        ],
      },
    ]);
    expect(await animationMotion(plan)).toEqual(['moves', 'holds', 'none']);
  });

  it('counts a node with no translation as resting at the origin', async () => {
    const plan = model(
      [
        {
          keys: [
            [0, 0, 0],
            [0, 0, 0],
          ],
        },
      ],
      {} as { translation: number[] },
    );
    expect(await animationMotion(plan)).toEqual(['none']);
  });

  it('sees motion in cubic spline tangents even when the keys agree', async () => {
    const tangent = [0, 0.5, 0];
    const still = [0, 0, 0];
    const plan = model([
      {
        keys: [still, [1, 0, 0], tangent, tangent, [1, 0, 0], still],
        interpolation: 'CUBICSPLINE',
      },
      { keys: [still, [1, 0, 0], still, still, [1, 0, 0], still], interpolation: 'CUBICSPLINE' },
    ]);
    expect(await animationMotion(plan)).toEqual(['moves', 'none']);
  });

  it("says nothing when it can't read the keys, or the plan emptied the clip", async () => {
    const plan = model([
      {
        keys: [
          [1, 0, 0],
          [1, 0, 0],
        ],
      },
      {
        keys: [
          [1, 0, 0],
          [1, 0, 0],
        ],
      },
    ]);
    const unreadable = { ...plan, parts: plan.parts.slice(0, 2) };
    expect(await animationMotion(unreadable)).toEqual(['none', null]);
    plan.json.animations![0].channels = [];
    expect(await animationMotion(plan)).toEqual([null, 'none']);
  });
});
