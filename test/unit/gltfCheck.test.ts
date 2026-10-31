import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Points,
} from 'three';
import { describe, expect, it } from 'vitest';
import { meshesForCheck } from '../../src/webview/scene/meshCheck';
import { checkMesh, placeMeshes } from '../../src/shared/meshCheck';

const material = new MeshBasicMaterial();

/** The check of `root`'s meshes as the view takes them. */
function check(root: Group) {
  const meshes = meshesForCheck(root);
  return meshes && checkMesh(placeMeshes(meshes));
}

describe('meshesForCheck', () => {
  it('takes each mesh where its node puts it, far from the origin too', () => {
    // A 2 × 1 × 1 m box, with a vertex of its own at each face's corner, scaled twice over a
    // thousand kilometres away: 4 × 2 × 2 m.
    const root = new Group();
    const node = new Group();
    node.position.set(1e6, 0, -1e6);
    node.scale.setScalar(2);
    node.add(new Mesh(new BoxGeometry(2, 1, 1), material));
    root.add(node);
    expect(check(root)).toEqual({
      triangles: 12,
      area: 40,
      volume: 16,
      shells: 1,
      degenerate: 0,
      openEdges: 0,
      nonManifoldEdges: 0,
      flippedEdges: 0,
    });
  });

  it('takes every GPU instance', () => {
    const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), material, 3);
    [-2, 0, 2].forEach((x, i) => mesh.setMatrixAt(i, new Matrix4().makeTranslation(x, 0, 0)));
    const root = new Group().add(mesh);
    expect(check(root)).toMatchObject({ triangles: 36, area: 18, volume: 3, shells: 3 });
  });

  it('takes the triangles of meshes without indices, and finds where they are open', () => {
    // One triangle, which a quantized file might store as normalized integers.
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Int16Array([0, 0, 0, 32767, 0, 0, 0, 32767, 0]), 3, true),
    );
    const root = new Group().add(new Mesh(geometry, material));
    const found = check(root)!;
    expect(found).toMatchObject({ triangles: 1, openEdges: 3, shells: 1 });
    expect(found.area).toBeCloseTo(0.5, 6);
    expect(found.volume).toBeUndefined();
  });

  it('leaves out what is hidden, points, and models past the limit', () => {
    const hidden = new Mesh(new BoxGeometry(1, 1, 1), material);
    hidden.visible = false;
    const points = new Points(new BoxGeometry(1, 1, 1));
    expect(meshesForCheck(new Group().add(hidden, points))).toBeUndefined();
    const box = new Group().add(new Mesh(new BoxGeometry(1, 1, 1), material));
    expect(meshesForCheck(box, 12)).toHaveLength(1);
    expect(meshesForCheck(box, 11)).toBeUndefined();
  });
});
