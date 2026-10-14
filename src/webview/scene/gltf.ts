import type { Material, Mesh } from 'three';
import { GLTFLoader, type GLTF, type GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { Decoders } from './modelView';

/**
 * Builds a three.js scene from glTF JSON and the parts the host sent for it. The parts go into
 * the loader's cache under the keys it looks them up by (`bufferView:3`, `buffer:5`), so it never
 * fetches anything and uses the bytes as they arrived, without copying them.
 */
export function parseModel(
  json: string,
  parts: ReadonlyMap<string, ArrayBuffer>,
  decoders: Decoders = {},
): Promise<GLTF> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  if (decoders.draco) loader.setDRACOLoader(decoders.draco);
  if (decoders.ktx2) loader.setKTX2Loader(decoders.ktx2);
  loader.register((parser) => {
    // The loader maps its objects to glTF indices in `associations`, then cuts that map down to
    // one scene each time a scene finishes loading: with two scenes, one loses its nodes. Keep
    // the full map; selection needs every node of the scene shown.
    const associations = parser.associations;
    Object.defineProperty(parser, 'associations', {
      get: () => associations,
      set: () => {},
      configurable: true,
    });
    return partsPlugin(parser, parts);
  });
  loader.register(variantsPlugin);
  return loader.parseAsync(json, '');
}

/** A mesh's material for each KHR_materials_variants variant it has one for, by variant index. */
export type VariantMaterials = Map<number, Material | Material[]>;

/**
 * Makes the materials of KHR_materials_variants while the parts are at hand: neither the parser
 * nor the bytes outlive the load. The variants' names go in `gltf.userData.variants`, and each
 * mesh with variants keeps its materials for them in `userData.variantMaterials`.
 */
function variantsPlugin(parser: GLTFParser) {
  return {
    name: 'nightmesh_variants',
    afterRoot: async (gltf: GLTF) => {
      const extension = (parser.json as { extensions?: Record<string, unknown> }).extensions
        ?.KHR_materials_variants as { variants?: { name?: unknown }[] } | undefined;
      const variants = Array.isArray(extension?.variants) ? extension.variants : [];
      gltf.userData.variants = variants.map((variant) =>
        typeof variant?.name === 'string' && variant.name.trim() ? variant.name : undefined,
      );
      if (variants.length === 0) return;
      const meshes: Mesh[] = [];
      gltf.scene.traverse((object) => {
        const mappings = variantMappings(object as Mesh);
        if ((object as Mesh).isMesh && mappings.length > 0) meshes.push(object as Mesh);
      });
      for (const mesh of meshes) {
        const own = mesh.material;
        const materials: VariantMaterials = new Map();
        for (const mapping of variantMappings(mesh)) {
          try {
            mesh.material = (await parser.getDependency('material', mapping.material)) as Material;
            // As the loader does for the mesh's own material: vertex colors, flat shading, skins.
            parser.assignFinalMaterial(mesh);
            for (const variant of mapping.variants) materials.set(variant, mesh.material);
          } catch {
            // A material that can't be made leaves the variant showing the mesh's own.
          }
        }
        mesh.material = own;
        mesh.userData.variantMaterials = materials;
      }
    },
  };
}

function variantMappings(mesh: Mesh): { material: number; variants: number[] }[] {
  const extension = (mesh.userData?.gltfExtensions as Record<string, unknown> | undefined)
    ?.KHR_materials_variants as { mappings?: unknown } | undefined;
  if (!Array.isArray(extension?.mappings)) return [];
  return extension.mappings.filter(
    (mapping): mapping is { material: number; variants: number[] } =>
      Number.isInteger(mapping?.material) && Array.isArray(mapping?.variants),
  );
}

/** Hands the host's parts to the loader through its cache. */
function partsPlugin(parser: GLTFParser, parts: ReadonlyMap<string, ArrayBuffer>) {
  return {
    name: 'nightmesh_parts',
    // The parser empties its cache when it starts; this runs right after.
    beforeRoot: async () => {
      const cache = (parser as unknown as { cache: { add(key: string, value: unknown): void } })
        .cache;
      for (const [key, data] of parts) cache.add(key, Promise.resolve(data));
    },
  };
}
