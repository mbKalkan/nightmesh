import { describe, expect, it } from 'vitest';
import { triangulate } from '../../src/extension/model/mesh/polygon';

/** The triangles of a polygon given by its corners. */
function triangles(corners: number[][]): number[][] {
  const result: number[][] = [];
  triangulate(corners.flat(), corners.length, (a, b, c) => result.push([a, b, c]));
  return result;
}

/** Twice the area of a triangle in the x-y plane, positive when anticlockwise. */
const area = (corners: number[][], [a, b, c]: number[]) =>
  (corners[b][0] - corners[a][0]) * (corners[c][1] - corners[a][1]) -
  (corners[b][1] - corners[a][1]) * (corners[c][0] - corners[a][0]);

describe('triangulate', () => {
  it('fans a convex polygon from its first corner', () => {
    const square = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ];
    expect(triangles(square)).toEqual([
      [0, 1, 2],
      [0, 2, 3],
    ]);
  });

  it('cuts a concave polygon into triangles inside its outline, wound as it is', () => {
    // An L from the end of its foot: a fan from there would cover the notch above the foot.
    const l = [
      [2, 1, 0],
      [1, 1, 0],
      [1, 2, 0],
      [0, 2, 0],
      [0, 0, 0],
      [2, 0, 0],
    ];
    const cut = triangles(l);
    expect(cut).toHaveLength(4);
    for (const triangle of cut) expect(area(l, triangle)).toBeGreaterThan(0);
    // Together they cover the L's area, 3, and no more.
    expect(cut.reduce((sum, triangle) => sum + area(l, triangle), 0)).toBeCloseTo(6);
  });

  it('cuts a ring written as one polygon, its hole joined to the outside by a cut', () => {
    // A 4 by 4 square around a 2 by 2 hole; the cut runs from (0, 0) to (1, 1) and back.
    const ring = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
      [0, 0],
      [1, 1],
      [1, 3],
      [3, 3],
      [3, 1],
      [1, 1],
    ].map(([x, y]) => [x, y, 0]);
    const cut = triangles(ring);
    for (const triangle of cut) expect(area(ring, triangle)).toBeGreaterThan(0);
    expect(cut.reduce((sum, triangle) => sum + area(ring, triangle), 0)).toBeCloseTo(24);
  });

  it('works in whichever plane the polygon lies, facing either way', () => {
    // An arrowhead standing up in the x-z plane, facing -y; its notch is at corner 3.
    const dart = [
      [0, 0, 0],
      [2, 0, 1],
      [0, 0, 2],
      [0.5, 0, 1],
    ];
    const cut = triangles(dart);
    expect(cut).toHaveLength(2);
    // The cut runs from the notch to the tip, not across the notch from 0 to 2.
    for (const triangle of cut) expect(triangle).toEqual(expect.arrayContaining([1, 3]));
  });

  it('draws a polygon that crosses itself, or has no area, as a fan', () => {
    const bowtie = [
      [0, 0, 0],
      [1, 1, 0],
      [1, 0, 0],
      [0, 1, 0],
    ];
    expect(triangles(bowtie)).toHaveLength(2);
    const line = [
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
    ];
    expect(triangles(line)).toEqual([
      [0, 1, 2],
      [0, 2, 3],
    ]);
  });
});
