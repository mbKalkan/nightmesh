import type { ImageInfo } from '../../shared/protocol';
import { meshCounts } from './counts';
import { drawnImage, textureMemory } from './textures';
import { BoxBuilder, IDENTITY, localMatrix, multiply, type Bounds } from './bounds';
import { isObject, num, type GltfModel } from './gltf';

/** One mesh as the scene draws it. */
export interface MeshStatistics {
  mesh: number;
  /** How many times it is drawn: once per node, times its GPU instances. */
  instances: number;
  primitives: number;
  /** Per instance. */
  vertices: number;
  triangles: number;
  lines: number;
  points: number;
}

/**
 * Counts for the scene a viewer shows, from the JSON alone: every mesh counted each time it is
 * drawn, with its vertex and triangle totals, and the scene's size in metres.
 */
export interface Statistics {
  scene: number | undefined;
  nodes: number;
  instances: number;
  drawCalls: number;
  vertices: number;
  triangles: number;
  lines: number;
  points: number;
  materials: number;
  textures: number;
  /** Estimated GPU memory of the textures used, once image sizes are known. */
  textureMemory?: number;
  /** World-space bounds, from each primitive's POSITION bounds; undefined when there are none. */
  bounds?: Bounds;
  meshes: MeshStatistics[];
}

export function statistics(model: GltfModel, images?: readonly (ImageInfo | null)[]): Statistics {
  const scenes = model.items('scenes');
  const scene = scenes.length > 0 ? (model.ref('scenes', model.root.scene) ?? 0) : undefined;
  const roots = scene !== undefined ? model.sceneRoots(scene) : model.unreachedRoots();
  const result: Statistics = {
    scene,
    nodes: 0,
    instances: 0,
    drawCalls: 0,
    vertices: 0,
    triangles: 0,
    lines: 0,
    points: 0,
    materials: 0,
    textures: 0,
    meshes: [],
  };
  const byMesh = new Map<number, MeshStatistics>();
  const materials = new Set<number>();
  const box = new BoxBuilder();

  const stack = roots.map((node) => ({ node, parent: IDENTITY }));
  while (stack.length > 0) {
    const { node, parent } = stack.pop()!;
    result.nodes++;
    const item = model.items('nodes')[node];
    const world = multiply(parent, localMatrix(item));
    for (const child of model.children(node)) stack.push({ node: child, parent: world });
    const mesh = model.ref('meshes', item.mesh);
    if (mesh === undefined) continue;

    const instancing = model.extension(item, 'EXT_mesh_gpu_instancing');
    const attributes = isObject(instancing?.attributes) ? instancing.attributes : {};
    const instanceRef = Object.values(attributes)[0];
    const instances = instanceRef !== undefined ? accessorCountOf(model, instanceRef) : 1;
    let row = byMesh.get(mesh);
    if (!row) {
      const { materials: used, ...counts } = meshCounts(model, mesh);
      row = { mesh, instances: 0, ...counts };
      byMesh.set(mesh, row);
      used.forEach((material) => materials.add(material));
    }
    row.instances += instances;
    // GPU instancing draws all of a node's instances in one call per primitive.
    result.drawCalls += row.primitives;

    box.addMesh(model, mesh, world);
  }

  for (const row of byMesh.values()) {
    result.instances += row.instances;
    result.vertices += row.vertices * row.instances;
    result.triangles += row.triangles * row.instances;
    result.lines += row.lines * row.instances;
    result.points += row.points * row.instances;
  }
  result.meshes = [...byMesh.values()];
  result.materials = materials.size;
  const textures = new Set<number>();
  model.items('textures').forEach((_, texture) => {
    if (model.textureUses(texture).some((use) => materials.has(use.material)))
      textures.add(texture);
  });
  result.textures = textures.size;
  if (images) {
    // Textures sharing an image and sampler are one upload.
    const uploads = new Map<string, number>();
    for (const texture of textures) {
      const memory = textureMemory(model, images, texture);
      const item = model.items('textures')[texture];
      if (memory !== undefined)
        uploads.set(`${drawnImage(model, texture)}:${String(item.sampler)}`, memory);
    }
    if (uploads.size > 0) result.textureMemory = [...uploads.values()].reduce((a, b) => a + b, 0);
  }
  result.bounds = box.bounds();
  return result;
}

function accessorCountOf(model: GltfModel, ref: unknown): number {
  return num(model.item('accessors', model.ref('accessors', ref))?.count) ?? 1;
}
