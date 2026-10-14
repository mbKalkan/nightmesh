import { meshCounts } from './counts';
import { isObject, num, numbers, objects, type GltfModel, type JsonObject } from './gltf';

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
  /** World-space bounds, from each primitive's POSITION bounds; undefined when there are none. */
  bounds?: { min: number[]; max: number[] };
  meshes: MeshStatistics[];
}

/** Column-major 4×4 matrices, as glTF stores them. */
type Matrix = number[];

const IDENTITY: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Integer component types and the largest value each holds, for normalized accessors. */
const NORMALIZED_MAX: Record<number, number> = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

export function statistics(model: GltfModel): Statistics {
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
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

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

    for (const primitive of objects(model.items('meshes')[mesh].primitives)) {
      const bounds = positionBounds(model, primitive);
      if (!bounds) continue;
      for (const corner of corners(bounds.min, bounds.max)) {
        const point = transform(world, corner);
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis], point[axis]);
          max[axis] = Math.max(max[axis], point[axis]);
        }
      }
    }
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
  if (min[0] <= max[0]) result.bounds = { min, max };
  return result;
}

/**
 * A primitive's POSITION bounds in its mesh's units. Normalized integer positions (as
 * KHR_mesh_quantization stores them) keep their raw values in `min` and `max`; those are scaled
 * back here.
 */
export function positionBounds(
  model: GltfModel,
  primitive: JsonObject,
): { min: number[]; max: number[] } | undefined {
  const attributes = isObject(primitive.attributes) ? primitive.attributes : {};
  const accessor = model.item('accessors', model.ref('accessors', attributes.POSITION));
  const min = numbers(accessor?.min, 3);
  const max = numbers(accessor?.max, 3);
  if (!accessor || !min || !max) return undefined;
  const largest =
    accessor.normalized === true ? NORMALIZED_MAX[num(accessor.componentType) ?? 0] : 1;
  const scale = (value: number) => Math.max(value / (largest ?? 1), -1);
  return largest === 1 ? { min, max } : { min: min.map(scale), max: max.map(scale) };
}

function accessorCountOf(model: GltfModel, ref: unknown): number {
  return num(model.item('accessors', model.ref('accessors', ref))?.count) ?? 1;
}

function localMatrix(node: JsonObject): Matrix {
  const matrix = numbers(node.matrix, 16);
  if (matrix) return matrix;
  const [tx, ty, tz] = numbers(node.translation, 3) ?? [0, 0, 0];
  const [x, y, z, w] = numbers(node.rotation, 4) ?? [0, 0, 0, 1];
  const [sx, sy, sz] = numbers(node.scale, 3) ?? [1, 1, 1];
  const [xx, yy, zz] = [x * x, y * y, z * z];
  const [xy, xz, yz, wx, wy, wz] = [x * y, x * z, y * z, w * x, w * y, w * z];
  return [
    (1 - 2 * (yy + zz)) * sx,
    2 * (xy + wz) * sx,
    2 * (xz - wy) * sx,
    0,
    2 * (xy - wz) * sy,
    (1 - 2 * (xx + zz)) * sy,
    2 * (yz + wx) * sy,
    0,
    2 * (xz + wy) * sz,
    2 * (yz - wx) * sz,
    (1 - 2 * (xx + yy)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

function multiply(a: Matrix, b: Matrix): Matrix {
  const out = new Array<number>(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

function transform(m: Matrix, [x, y, z]: number[]): number[] {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

function corners(min: number[], max: number[]): number[][] {
  const points: number[][] = [];
  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) points.push([x, y, z]);
    }
  }
  return points;
}
