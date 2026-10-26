// Where a node's GPU instances (EXT_mesh_gpu_instancing) are: their transforms are in binary data,
// so from glTF's JSON alone a node of many instances measures as one.
import type { InstancesMessage } from '../../shared/protocol';
import { AccessorReader, normalizedMax } from './accessors';
import type { Gltf, Part } from './plan';

/** Instance transforms read, over all nodes; past it, the rest keep the size of one instance. */
export const INSTANCE_BYTES = 64 * 1024 * 1024;

interface Node {
  mesh?: number;
  extensions?: { EXT_mesh_gpu_instancing?: { attributes?: Record<string, unknown> } };
}

interface Mesh {
  primitives?: { attributes?: Record<string, unknown> }[];
}

/**
 * For each node with GPU instances, the box around all of them in the node's own space: its
 * mesh's box placed by each instance's translation, rotation and scale.
 */
export async function instanceBounds(plan: {
  json: Gltf;
  parts: readonly Part[];
}): Promise<InstancesMessage['nodes']> {
  const { nodes, meshes } = plan.json as unknown as { nodes?: Node[]; meshes?: Mesh[] };
  const reader = new AccessorReader(plan.json, plan.parts, INSTANCE_BYTES);
  const found: InstancesMessage['nodes'] = [];
  for (const [index, node] of (nodes ?? []).entries()) {
    const attributes = node?.extensions?.EXT_mesh_gpu_instancing?.attributes;
    if (!attributes) continue;
    const box = meshBox(reader, meshes?.[node.mesh ?? -1]);
    if (!box) continue;
    const ref = (name: string) =>
      Number.isInteger(attributes[name]) ? (attributes[name] as number) : undefined;
    const names = ['TRANSLATION', 'ROTATION', 'SCALE'].filter((name) => ref(name) !== undefined);
    if (names.length === 0) continue;
    const count = reader.accessor(ref(names[0]))?.count;
    if (names.some((name) => reader.accessor(ref(name))?.count !== count)) continue;
    const [translation, rotation, scale] = await Promise.all(
      ['TRANSLATION', 'ROTATION', 'SCALE'].map((name) =>
        ref(name) === undefined ? null : reader.read(ref(name)),
      ),
    );
    if (translation === undefined || rotation === undefined || scale === undefined) continue;
    found.push({ node: index, ...placed(box, count!, translation, rotation, scale) });
  }
  return found;
}

/** The box around a mesh's primitives, from their POSITION bounds. */
function meshBox(reader: AccessorReader, mesh: Mesh | undefined) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const primitive of mesh?.primitives ?? []) {
    const position = primitive?.attributes?.POSITION;
    const accessor = reader.accessor(Number.isInteger(position) ? (position as number) : undefined);
    if (!accessor || !isTriple(accessor.min) || !isTriple(accessor.max)) continue;
    // Normalized integers, as KHR_mesh_quantization stores positions, keep raw values in min/max.
    const largest = normalizedMax(accessor);
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], Math.max(accessor.min[axis] / largest, -1));
      max[axis] = Math.max(max[axis], Math.max(accessor.max[axis] / largest, -1));
    }
  }
  return min[0] <= max[0] ? { min, max } : undefined;
}

/** The box around `box` placed by each of `count` instances; null transforms are the identity. */
function placed(
  box: { min: number[]; max: number[] },
  count: number,
  translation: number[] | null,
  rotation: number[] | null,
  scale: number[] | null,
): { min: number[]; max: number[] } {
  const center = box.min.map((value, axis) => (value + box.max[axis]) / 2);
  const half = box.min.map((value, axis) => (box.max[axis] - value) / 2);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    const linear = turnAndScale(rotation?.slice(i * 4, i * 4 + 4), scale?.slice(i * 3, i * 3 + 3));
    for (let row = 0; row < 3; row++) {
      // Center moved, and the half extent of the turned box along this axis.
      let at = translation ? translation[i * 3 + row] : 0;
      let reach = 0;
      for (let column = 0; column < 3; column++) {
        at += linear[row][column] * center[column];
        reach += Math.abs(linear[row][column]) * half[column];
      }
      min[row] = Math.min(min[row], at - reach);
      max[row] = Math.max(max[row], at + reach);
    }
  }
  return { min, max };
}

/** Rows of the 3×3 matrix that turns by quaternion `q` after scaling by `s`. */
function turnAndScale(q: number[] = [0, 0, 0, 1], s: number[] = [1, 1, 1]): number[][] {
  const length = Math.hypot(...q) || 1;
  const [x, y, z, w] = q.map((value) => value / length);
  return [
    [(1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y - w * z) * s[1], 2 * (x * z + w * y) * s[2]],
    [2 * (x * y + w * z) * s[0], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z - w * x) * s[2]],
    [2 * (x * z - w * y) * s[0], 2 * (y * z + w * x) * s[1], (1 - 2 * (x * x + y * y)) * s[2]],
  ];
}

function isTriple(value: unknown): value is number[] {
  return Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(Number.isFinite);
}
