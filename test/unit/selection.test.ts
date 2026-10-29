import {
  BoxGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';
import { boundsOf, localBox } from '../../src/webview/scene/selection';

/** Three 1 m boxes, 2 m apart along X, drawn as GPU instances. */
function instancedBoxes(): InstancedMesh {
  const geometry = new BoxGeometry(1, 1, 1);
  geometry.computeBoundingBox();
  const mesh = new InstancedMesh(geometry, new MeshBasicMaterial(), 3);
  [-2, 0, 2].forEach((x, i) => mesh.setMatrixAt(i, new Matrix4().makeTranslation(x, 0, 0)));
  return mesh;
}

const size = (box: { getSize(target: Vector3): Vector3 }) => box.getSize(new Vector3()).toArray();

describe('localBox', () => {
  it('holds every instance of an instanced mesh, as the inspector measures it', () => {
    const node = new Group();
    node.add(instancedBoxes());
    expect(size(localBox(node)!)).toEqual([5, 1, 1]);
    expect(size(boundsOf([node]))).toEqual([5, 1, 1]);
  });

  it("boxes instances along the selected node's own axes", () => {
    const node = new Group();
    node.quaternion.copy(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 4));
    const parent = new Group();
    parent.add(node);
    node.add(instancedBoxes());
    const local = size(localBox(node)!);
    [5, 1, 1].forEach((value, axis) => expect(local[axis]).toBeCloseTo(value, 6));
  });

  it('boxes a plain mesh by its geometry', () => {
    const geometry = new BoxGeometry(2, 3, 4);
    geometry.computeBoundingBox();
    const node = new Group();
    node.add(new Mesh(geometry));
    expect(size(localBox(node)!)).toEqual([2, 3, 4]);
  });
});
