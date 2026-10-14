import { isObject, num, numbers, objects, type GltfModel, type JsonObject } from './gltf';

/** An axis-aligned box: `min` and `max` corners. */
export interface Bounds {
  min: number[];
  max: number[];
}

/** Column-major 4×4 matrices, as glTF stores them. */
export type Matrix = number[];

export const IDENTITY: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Integer component types and the largest value each holds, for normalized accessors. */
const NORMALIZED_MAX: Record<number, number> = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

/** Width, height and depth of a box: its extent along X, Y and Z. */
export const sizeOf = ({ min, max }: Bounds): number[] =>
  max.map((value, axis) => value - min[axis]);

/**
 * A primitive's POSITION bounds in its mesh's units. Normalized integer positions (as
 * KHR_mesh_quantization stores them) keep their raw values in `min` and `max`; those are scaled
 * back here.
 */
export function positionBounds(model: GltfModel, primitive: JsonObject): Bounds | undefined {
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

/** A box that grows to hold what is added to it; empty until then. */
export class BoxBuilder {
  readonly min = [Infinity, Infinity, Infinity];
  readonly max = [-Infinity, -Infinity, -Infinity];

  /** Adds a mesh's primitives, placed by `world`. */
  addMesh(model: GltfModel, mesh: number, world: Matrix = IDENTITY): void {
    for (const primitive of objects(model.items('meshes')[mesh]?.primitives)) {
      const bounds = positionBounds(model, primitive);
      if (!bounds) continue;
      for (const corner of corners(bounds.min, bounds.max)) this.addPoint(transform(world, corner));
    }
  }

  addPoint(point: number[]): void {
    for (let axis = 0; axis < 3; axis++) {
      this.min[axis] = Math.min(this.min[axis], point[axis]);
      this.max[axis] = Math.max(this.max[axis], point[axis]);
    }
  }

  bounds(): Bounds | undefined {
    return this.min[0] <= this.max[0] ? { min: [...this.min], max: [...this.max] } : undefined;
  }
}

/** A node's world matrix: its own transform under every node above it in the tree. */
export function worldMatrix(model: GltfModel, node: number): Matrix {
  const chain = [node];
  for (let parent = model.parent(node); parent !== undefined; parent = model.parent(parent)) {
    chain.unshift(parent);
  }
  return chain.reduce(
    (matrix, index) => multiply(matrix, localMatrix(model.items('nodes')[index])),
    IDENTITY,
  );
}

/** World-space bounds of nodes and everything below them, in metres. */
export function nodesBounds(model: GltfModel, nodes: readonly number[]): Bounds | undefined {
  const box = new BoxBuilder();
  const stack = nodes.map((node) => ({ node, world: worldMatrix(model, node) }));
  while (stack.length > 0) {
    const { node, world } = stack.pop()!;
    const mesh = model.ref('meshes', model.items('nodes')[node].mesh);
    if (mesh !== undefined) box.addMesh(model, mesh, world);
    for (const child of model.children(node)) {
      stack.push({ node: child, world: multiply(world, localMatrix(model.items('nodes')[child])) });
    }
  }
  return box.bounds();
}

/**
 * A node's size along its own axes, scaled as the scene scales it: how long, tall and deep it
 * is however it is turned, as Blender reports an object's dimensions.
 */
export function nodeSize(model: GltfModel, node: number): number[] | undefined {
  const box = new BoxBuilder();
  const stack = [{ node, local: IDENTITY }];
  while (stack.length > 0) {
    const { node: current, local } = stack.pop()!;
    const mesh = model.ref('meshes', model.items('nodes')[current].mesh);
    if (mesh !== undefined) box.addMesh(model, mesh, local);
    for (const child of model.children(current)) {
      stack.push({ node: child, local: multiply(local, localMatrix(model.items('nodes')[child])) });
    }
  }
  const bounds = box.bounds();
  if (!bounds) return undefined;
  const world = worldMatrix(model, node);
  const scale = [0, 4, 8].map((column) =>
    Math.hypot(world[column], world[column + 1], world[column + 2]),
  );
  return sizeOf(bounds).map((value, axis) => value * scale[axis]);
}

/** A mesh's bounds in its own units, before any node places or scales it. */
export function meshBounds(model: GltfModel, mesh: number): Bounds | undefined {
  const box = new BoxBuilder();
  box.addMesh(model, mesh);
  return box.bounds();
}

export function localMatrix(node: JsonObject): Matrix {
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

export function multiply(a: Matrix, b: Matrix): Matrix {
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
