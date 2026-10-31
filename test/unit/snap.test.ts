import { BufferAttribute, BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { edgeGeometry } from '../../src/webview/scene/picking';
import { anyFace, nearestWritten, onEdgeOfShape } from '../../src/webview/scene/snap';

const SIZE = 5;

/** A patch of `SIZE` × `SIZE` pixels of four floats, each from `at(row, column)`, or zeros. */
function patch(at: (row: number, column: number) => readonly number[] | undefined): Float32Array {
  const pixels = new Float32Array(SIZE * SIZE * 4);
  for (let row = 0; row < SIZE; row++) {
    for (let column = 0; column < SIZE; column++) {
      const value = at(row, column);
      if (value) pixels.set(value, (row * SIZE + column) * 4);
    }
  }
  return pixels;
}

/** The plane through `point` facing `normal`, as the picker writes it: the normal and n · p. */
function plane(normal: readonly number[], point: readonly number[]): number[] {
  const length = Math.hypot(...normal);
  const n = normal.map((value) => value / length);
  return [...n, n[0] * point[0] + n[1] * point[1] + n[2] * point[2]];
}

/** A point 10 m in front of the camera, on an edge drawn down the middle column. */
const POINT = [0, 0, -10] as const;

describe('nearestWritten', () => {
  it('finds the written pixel nearest the middle, within the radius', () => {
    const pixels = patch((row, column) =>
      (row === 0 && column === 2) || (row === 2 && column === 4) ? [1, 2, 3, 1] : undefined,
    );
    // Both are 2 pixels away; the first one met wins.
    expect(nearestWritten(pixels, SIZE, 2)).toBe((0 * SIZE + 2) * 4);
    expect(nearestWritten(pixels, SIZE, 1)).toBeUndefined();
  });

  it('passes over pixels turned down', () => {
    const pixels = patch((row, column) => (row === 2 && column <= 3 ? [0, 0, 0, 1] : undefined));
    const offset = nearestWritten(pixels, SIZE, 2, (_, __, column) => column !== 2);
    expect([(2 * SIZE + 1) * 4, (2 * SIZE + 3) * 4]).toContain(offset);
  });
});

describe('onEdgeOfShape', () => {
  it('is not an edge where both sides are one flat face: a diagonal', () => {
    const planes = patch(() => plane([0, 0, 1], POINT));
    expect(onEdgeOfShape(planes, SIZE, 2, 2, POINT)).toBe(false);
  });

  it('is not an edge where the faces are one plane, turned either way', () => {
    const planes = patch((_, column) => plane([0, 0, column < 2 ? 1 : -1], POINT));
    expect(onEdgeOfShape(planes, SIZE, 2, 2, POINT)).toBe(false);
  });

  it('is an edge where the faces meet at an angle', () => {
    // A ridge: the two sides 2 degrees apart.
    const tilt = Math.tan((1 * Math.PI) / 180);
    const planes = patch((_, column) => plane([column < 2 ? -tilt : tilt, 0, 1], POINT));
    expect(onEdgeOfShape(planes, SIZE, 2, 2, POINT)).toBe(true);
  });

  it('is not an edge for float noise in the normals', () => {
    const planes = patch((_, column) => plane([column < 2 ? -1e-5 : 1e-5, 0, 1], POINT));
    expect(onEdgeOfShape(planes, SIZE, 2, 2, POINT)).toBe(false);
  });

  it('is an edge where the surface ends', () => {
    const planes = patch((_, column) => (column <= 2 ? plane([0, 0, 1], POINT) : undefined));
    expect(onEdgeOfShape(planes, SIZE, 2, 2, POINT)).toBe(true);
  });

  it('is an edge where a surface beside it is another one, behind', () => {
    // A step seen from above: the face beside it is parallel, 0.5 m lower.
    const planes = patch((_, column) =>
      plane([0, 0, 1], column <= 2 ? POINT : [POINT[0], POINT[1], POINT[2] - 0.5]),
    );
    expect(onEdgeOfShape(planes, SIZE, 2, 2, POINT)).toBe(true);
  });

  it('looks only at the pixels around the edge', () => {
    // Something else two columns away doesn't count.
    const planes = patch((_, column) => (column < 4 ? plane([0, 0, 1], POINT) : undefined));
    expect(onEdgeOfShape(planes, SIZE, 2, 2, POINT)).toBe(false);
    expect(onEdgeOfShape(planes, SIZE, 2, 3, POINT)).toBe(true);
  });
});

describe('anyFace', () => {
  it('tells a patch with a face in it from an empty one', () => {
    expect(anyFace(patch(() => undefined))).toBe(false);
    expect(
      anyFace(
        patch((row, column) => (row === 4 && column === 0 ? plane([0, 1, 0], POINT) : undefined)),
      ),
    ).toBe(true);
  });
});

describe('edgeGeometry', () => {
  it("makes each triangle's three edges from its indices, over the mesh's own buffers", () => {
    const geometry = new BufferGeometry();
    const position = new BufferAttribute(new Float32Array(12), 3);
    geometry.setAttribute('position', position);
    geometry.setIndex([0, 1, 2, 2, 1, 3]);
    const edges = edgeGeometry(geometry)!;
    expect(Array.from(edges.index!.array)).toEqual([0, 1, 1, 2, 2, 0, 2, 1, 1, 3, 3, 2]);
    expect(edges.index!.array).toBeInstanceOf(Uint16Array);
    expect(edges.getAttribute('position')).toBe(position);
  });

  it('makes them from the vertex count alone when the mesh has no indices', () => {
    const geometry = new BufferGeometry();
    // Released once on the GPU, as plain meshes are: only the count is left.
    const position = new BufferAttribute(new Float32Array(18), 3);
    geometry.setAttribute('position', position);
    (position as { array: unknown }).array = null;
    const edges = edgeGeometry(geometry)!;
    expect(Array.from(edges.index!.array)).toEqual([0, 1, 1, 2, 2, 0, 3, 4, 4, 5, 5, 3]);
  });

  it('takes 32-bit indices past 65,535 vertices, and none without triangles', () => {
    const many = new BufferGeometry();
    many.setAttribute('position', new BufferAttribute(new Float32Array(70_000 * 3), 3));
    expect(edgeGeometry(many)!.index!.array).toBeInstanceOf(Uint32Array);
    const none = new BufferGeometry();
    none.setAttribute('position', new BufferAttribute(new Float32Array(6), 3));
    expect(edgeGeometry(none)).toBeUndefined();
  });
});
