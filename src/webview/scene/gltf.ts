import {
  DoubleSide,
  type Line,
  type LineBasicMaterial,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  type Points,
  type PointsMaterial,
} from 'three';
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
  /** The glTF was made from an OBJ, STL or PLY file. */
  readFromMesh = false,
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
  loader.register(nodeVisibilityPlugin);
  if (readFromMesh) loader.register(meshFormatsPlugin);
  return loader.parseAsync(json, '');
}

/**
 * How many pixels wide points are drawn, rather than glTF's one: the fewer there are, the wider,
 * so a scan's millions stay apart and a handful stay visible.
 */
export function pointSize(count: number): number {
  return count <= 1000 ? 6 : count <= 100_000 ? 3 : 2;
}
/** Linear grey of surfaces the file gives no material: light, as CAD and slicer tools show them. */
const SURFACE_GREY = 0.4;
/** Linear grey of lines and points without colors: visible on dark and light backgrounds. */
const LINE_GREY = 0.35;

/**
 * OBJ, STL and PLY files often give no material, and glTF's default is a white metal, dark in
 * most light: those parts are drawn matte grey instead, from both sides as the formats don't say
 * which is the front. Points are drawn larger.
 */
function meshFormatsPlugin(parser: GLTFParser) {
  return {
    name: 'nightmesh_mesh_formats',
    afterRoot: async (gltf: GLTF) => {
      const meshes =
        (parser.json as { meshes?: { primitives: { material?: number }[] }[] }).meshes ?? [];
      gltf.scene.traverse((object) => {
        const association = parser.associations.get(object);
        if (association?.meshes === undefined || association.primitives === undefined) return;
        const primitive = meshes[association.meshes]?.primitives[association.primitives];
        const drawable = object as Mesh & Line & Points;
        const colored = drawable.geometry?.attributes.color !== undefined;
        if (drawable.isPoints) {
          const count = drawable.geometry.attributes.position?.count ?? 0;
          (drawable.material as PointsMaterial).size = pointSize(count);
        }
        if (primitive?.material !== undefined) return;
        if (drawable.isPoints || drawable.isLine) {
          if (!colored)
            (drawable.material as PointsMaterial | LineBasicMaterial).color.setScalar(LINE_GREY);
        } else if (drawable.isMesh) {
          const material = drawable.material as MeshStandardMaterial;
          material.metalness = 0;
          material.roughness = 0.5;
          material.side = DoubleSide;
          if (!colored) material.color.setScalar(SURFACE_GREY);
        }
      });
    },
  };
}

/**
 * KHR_node_visibility: a node it hides is not drawn, nor anything below it, lights included. It
 * stays in the scene, so it can still be selected and outlined.
 */
function nodeVisibilityPlugin(parser: GLTFParser) {
  return {
    name: 'KHR_node_visibility',
    afterRoot: async (gltf: GLTF) => {
      const nodes = (parser.json as { nodes?: { extensions?: Record<string, unknown> }[] }).nodes;
      gltf.scene.traverse((object) => {
        const node = parser.associations.get(object)?.nodes;
        if (node === undefined) return;
        const visibility = nodes?.[node]?.extensions?.KHR_node_visibility as
          { visible?: unknown } | undefined;
        if (visibility?.visible === false) object.visible = false;
      });
    },
  };
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
