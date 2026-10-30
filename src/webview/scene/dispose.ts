// Freeing what a model holds on the GPU once it isn't shown.
import type { InstancedMesh, Material, Mesh, Object3D, SkinnedMesh, Texture } from 'three';
import type { VariantMaterials } from './gltf';

/** Frees what `root` holds on the GPU: geometry, materials and their textures, and the rest. */
export function disposeObject(root: Object3D): void {
  root.traverse((object) => {
    const { geometry, material } = object as Partial<Mesh>;
    geometry?.dispose();
    const variants = (object.userData.variantMaterials as VariantMaterials | undefined)?.values();
    for (const item of [material, ...(variants ?? [])].flat()) if (item) disposeMaterial(item);
  });
  disposeObjectBuffers(root);
}

/**
 * Frees what three.js keeps on the GPU for objects themselves, rather than for their geometry
 * and materials: instances' matrices and colors, skeletons' bones. Nothing frees them unasked.
 */
export function disposeObjectBuffers(root: Object3D): void {
  root.traverse((object) => {
    if ((object as Partial<InstancedMesh>).isInstancedMesh) (object as InstancedMesh).dispose();
    (object as Partial<SkinnedMesh>).skeleton?.dispose();
  });
}

function disposeMaterial(material: Material): void {
  for (const value of Object.values(material)) {
    if ((value as Texture | null)?.isTexture) (value as Texture).dispose();
  }
  material.dispose();
}
