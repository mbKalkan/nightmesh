import { describe, expect, it } from 'vitest';
import { checkMesh, measure } from '../../src/extension/model/mesh/check';

/** A unit cube's corners, and its faces wound outward. */
const CORNERS = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];
const FACES = [
  [0, 2, 1, 0, 3, 2],
  [4, 5, 6, 4, 6, 7],
  [0, 1, 5, 0, 5, 4],
  [3, 7, 6, 3, 6, 2],
  [0, 4, 7, 0, 7, 3],
  [1, 2, 6, 1, 6, 5],
];

const cube = (faces = FACES) =>
  measure(new Float64Array(CORNERS.flat()), CORNERS.length, new Uint32Array(faces.flat()));

describe('checking a mesh as 3D printing does', () => {
  it('measures a closed cube: area, volume, one shell, no open edges', () => {
    expect(cube()).toEqual({
      triangles: 12,
      area: 6,
      volume: 1,
      shells: 1,
      degenerate: 0,
      openEdges: 0,
      nonManifoldEdges: 0,
      flippedEdges: 0,
    });
  });

  it('finds the rim of a missing face, and gives no volume for an open surface', () => {
    const check = cube(FACES.slice(1));
    expect(check).toMatchObject({ triangles: 10, area: 5, openEdges: 4 });
    expect(check.volume).toBeUndefined();
  });

  it('finds a face wound against its neighbours, and a cube turned inside out', () => {
    const flipped = FACES.map((face, index) => (index === 1 ? [4, 6, 5, 4, 7, 6] : face));
    expect(cube(flipped)).toMatchObject({ flippedEdges: 4, openEdges: 0 });
    expect(cube(flipped).volume).toBeUndefined();
    const inward = FACES.map(([a, b, c, d, e, f]) => [a, c, b, d, f, e]);
    expect(cube(inward)).toMatchObject({ volume: -1, flippedEdges: 0 });
  });

  it('counts edges of more than two faces, shells, and faces without area', () => {
    // A second cube against the first along the edge from (1, 1, 0) to (1, 1, 1).
    const corners = [...CORNERS, ...CORNERS.map(([x, y, z]) => [x + 1, y + 1, z])];
    const faces = [...FACES.flat(), ...FACES.flat().map((corner) => corner + 8)];
    const check = measure(new Float64Array(corners.flat()), 16, new Uint32Array(faces));
    // Apart: two shells, each closed.
    expect(check).toMatchObject({ shells: 2, nonManifoldEdges: 0, volume: 2 });
    const welded = checkMesh([
      { positions: new Float32Array(corners.flat()), indices: new Uint32Array(faces) },
    ]);
    // Their shared corners welded: one shell, its shared edge on four faces.
    expect(welded).toMatchObject({ shells: 1, nonManifoldEdges: 1, openEdges: 0 });
    expect(cube([...FACES, [0, 0, 1]])).toMatchObject({ degenerate: 1, triangles: 13 });
  });

  it('welds corners at the same place across parts, as texture seams split them', () => {
    // Each face a part of its own, with corners of its own.
    const parts = FACES.map((face) => ({
      positions: new Float32Array(face.flatMap((corner) => CORNERS[corner])),
    }));
    expect(checkMesh(parts)).toMatchObject({ volume: 1, openEdges: 0, shells: 1 });
    expect(checkMesh([])).toBeUndefined();
  });
});
