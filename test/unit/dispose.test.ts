import {
  Bone,
  BoxGeometry,
  DataTexture,
  Group,
  InstancedMesh,
  MeshStandardMaterial,
  Skeleton,
  SkinnedMesh,
  type EventDispatcher,
} from 'three';
import { describe, expect, it } from 'vitest';
import { disposeObject, disposeObjectBuffers } from '../../src/webview/scene/dispose';

/** Whether `target` was told to free what it holds. */
function freed(target: EventDispatcher<{ dispose: object }>): () => boolean {
  let disposed = false;
  target.addEventListener('dispose', () => (disposed = true));
  return () => disposed;
}

function model() {
  const geometry = new BoxGeometry();
  const texture = new DataTexture(new Uint8Array(4), 1, 1);
  const material = new MeshStandardMaterial({ map: texture });
  const instances = new InstancedMesh(geometry, material, 3);
  const bone = new Bone();
  const skinned = new SkinnedMesh(new BoxGeometry(), new MeshStandardMaterial());
  skinned.add(bone);
  skinned.bind(new Skeleton([bone]));
  skinned.skeleton.computeBoneTexture();
  const root = new Group().add(instances, skinned);
  return { root, geometry, texture, material, instances, skinned };
}

describe('disposing a model', () => {
  it('frees the instances and bones of a tile, whose geometry and materials the renderer frees', () => {
    const { root, geometry, material, instances, skinned } = model();
    const was = {
      geometry: freed(geometry),
      material: freed(material),
      instances: freed(instances),
    };
    const bones = freed(skinned.skeleton.boneTexture!);
    disposeObjectBuffers(root);
    expect(was.instances()).toBe(true);
    expect(bones()).toBe(true);
    expect(was.geometry()).toBe(false);
    expect(was.material()).toBe(false);
  });

  it('frees everything of a model no longer shown', () => {
    const { root, geometry, texture, material, instances } = model();
    const was = [freed(geometry), freed(texture), freed(material), freed(instances)];
    disposeObject(root);
    expect(was.map((check) => check())).toEqual([true, true, true, true]);
  });
});
