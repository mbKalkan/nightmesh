import { describe, expect, it } from 'vitest';
import {
  IDENTITY,
  animatedPaths,
  eulerDegrees,
  isTrs,
  modelRoots,
  modelTarget,
  nodeTrs,
  quaternionFromDegrees,
  withPath,
  type Trs,
} from '../../src/shared/transforms';

const close = (actual: readonly number[], expected: readonly number[]) =>
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 9));

describe('nodeTrs', () => {
  const json = {
    nodes: [
      { name: 'plain' },
      { translation: [1, 2, 3], rotation: [0, 0.7071068, 0, 0.7071068], scale: [2, 2, 2] },
      // 90° about Y, scaled by 2, 3 and 4, at (5, 6, 7), column by column.
      { matrix: [0, 0, -2, 0, 0, 3, 0, 0, 4, 0, 0, 0, 5, 6, 7, 1] },
    ],
  };

  it('gives glTF defaults for what a node leaves out', () => {
    expect(nodeTrs(json, 0)).toEqual(IDENTITY);
  });

  it('reads translation, rotation and scale as the node has them', () => {
    expect(nodeTrs(json, 1)).toEqual(json.nodes[1]);
  });

  it('takes a matrix apart into translation, rotation and scale', () => {
    const trs = nodeTrs(json, 2);
    close(trs.translation, [5, 6, 7]);
    close(trs.rotation, [0, Math.SQRT1_2, 0, Math.SQRT1_2]);
    close(trs.scale, [2, 3, 4]);
  });

  it("is in place for a node the file doesn't have: the one saving adds", () => {
    expect(nodeTrs(json, 3)).toEqual(IDENTITY);
    expect(nodeTrs(undefined, 0)).toEqual(IDENTITY);
  });

  it('gives a copy, which changing leaves the defaults alone', () => {
    nodeTrs(json, 0).translation[0] = 9;
    expect(IDENTITY.translation).toEqual([0, 0, 0]);
  });
});

describe('animatedPaths', () => {
  it('lists what the animations set on a node, not its morph weights', () => {
    const json = {
      animations: [
        { channels: [{ target: { node: 1, path: 'rotation' } }] },
        {
          channels: [
            { target: { node: 1, path: 'translation' } },
            { target: { node: 1, path: 'weights' } },
            { target: { node: 2, path: 'scale' } },
          ],
        },
      ],
    };
    expect([...animatedPaths(json, 1)].sort()).toEqual(['rotation', 'translation']);
    expect([...animatedPaths(json, 0)]).toEqual([]);
  });
});

describe('modelTarget', () => {
  it("is the shown scene's one top node", () => {
    expect(modelTarget({ scenes: [{ nodes: [1] }], nodes: [{}, {}] })).toBe(1);
  });

  it('is a node to add above several top nodes: the next index', () => {
    const json = { scenes: [{ nodes: [0, 1] }], nodes: [{}, {}] };
    expect(modelTarget(json)).toBe(2);
    expect(modelRoots(json)).toEqual({ scene: 0, roots: [0, 1] });
  });

  it('is a node to add above a top node an animation moves', () => {
    const json = {
      scenes: [{ nodes: [0] }],
      nodes: [{}],
      animations: [{ channels: [{ target: { node: 0, path: 'translation' } }] }],
    };
    expect(modelTarget(json)).toBe(1);
  });

  it('follows the default scene', () => {
    const json = { scene: 1, scenes: [{ nodes: [0] }, { nodes: [1] }], nodes: [{}, {}] };
    expect(modelTarget(json)).toBe(1);
  });

  it('is none for a model without nodes to show', () => {
    expect(modelTarget({ nodes: [{}] })).toBeUndefined();
    expect(modelTarget({ scenes: [{ nodes: [] }], nodes: [] })).toBeUndefined();
    expect(modelTarget({ scenes: [{ nodes: [7] }], nodes: [{}] })).toBeUndefined();
  });
});

describe('rotation angles', () => {
  it('turns degrees into a quaternion and back, X then Y then Z', () => {
    const degrees = [30, -45, 120];
    close(eulerDegrees(quaternionFromDegrees(degrees)), degrees);
  });

  it('turns 90° about Y as glTF writes it', () => {
    close(quaternionFromDegrees([0, 90, 0]), [0, Math.SQRT1_2, 0, Math.SQRT1_2]);
  });
});

describe('withPath', () => {
  const start: Trs = {
    translation: [0.1 + 0.2, 0, 0],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
  };

  it('cleans the values it sets: nine digits, and a hair from zero is zero', () => {
    const trs = withPath(start, 'rotation', [1e-17, Math.SQRT1_2, -0, Math.SQRT1_2]);
    expect(trs.rotation).toEqual([0, 0.707106781, 0, 0.707106781]);
  });

  it('leaves the other parts exactly as they were', () => {
    const trs = withPath(start, 'scale', [2, 2, 2]);
    expect(trs.translation).toEqual([0.30000000000000004, 0, 0]);
    expect(trs.translation).not.toBe(start.translation);
  });
});

describe('isTrs', () => {
  it('takes three lists of finite numbers of the right lengths only', () => {
    expect(isTrs(IDENTITY)).toBe(true);
    expect(isTrs({ ...IDENTITY, scale: [1, 1] })).toBe(false);
    expect(isTrs({ ...IDENTITY, translation: [0, Number.NaN, 0] })).toBe(false);
    expect(isTrs({ ...IDENTITY, rotation: [0, 0, 0, '1'] })).toBe(false);
    expect(isTrs(null)).toBe(false);
  });
});
