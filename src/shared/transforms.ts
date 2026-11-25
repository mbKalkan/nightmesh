/**
 * Moving, turning and scaling a glTF model's nodes (D-069). A change is kept as the node's whole
 * transform, never as a step from the one before: applied twice, or to the file once saved, it
 * gives the same result.
 */

/** Where a node is relative to its parent, as glTF says it: a rotation is a unit quaternion. */
export interface Trs {
  translation: [number, number, number];
  rotation: [number, number, number, number];
  scale: [number, number, number];
}

export type TransformPath = keyof Trs;

export const TRANSFORM_PATHS: readonly TransformPath[] = ['translation', 'rotation', 'scale'];

/** Which handles the 3D view shows: G moves, R rotates, S scales, as in Blender. */
export type TransformMode = 'move' | 'rotate' | 'scale';

/** The part of a node's transform each kind of handle changes. */
export const MODE_PATHS: Readonly<Record<TransformMode, TransformPath>> = {
  move: 'translation',
  rotate: 'rotation',
  scale: 'scale',
};

export const IDENTITY: Readonly<Trs> = {
  translation: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
};

type Json = Record<string, unknown>;

const isJson = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function numberList(value: unknown, length: number): number[] | undefined {
  return Array.isArray(value) &&
    value.length === length &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
    ? (value as number[])
    : undefined;
}

/** Whether `value` is a transform: three lists of finite numbers of the right lengths. */
export function isTrs(value: unknown): value is Trs {
  return (
    isJson(value) &&
    numberList(value.translation, 3) !== undefined &&
    numberList(value.rotation, 4) !== undefined &&
    numberList(value.scale, 3) !== undefined
  );
}

function nodesOf(json: unknown): unknown[] {
  return isJson(json) && Array.isArray(json.nodes) ? json.nodes : [];
}

/**
 * Node `index` of the glTF JSON, as a transform; a matrix is taken apart as three.js does. A node
 * the JSON doesn't have, as the one added above the whole model when it is saved, is in place.
 */
export function nodeTrs(json: unknown, index: number): Trs {
  const node = nodesOf(json)[index];
  if (!isJson(node)) return copyTrs(IDENTITY);
  const matrix = numberList(node.matrix, 16);
  if (matrix) return decompose(matrix);
  return {
    translation: [
      ...(numberList(node.translation, 3) ?? IDENTITY.translation),
    ] as Trs['translation'],
    rotation: [...(numberList(node.rotation, 4) ?? IDENTITY.rotation)] as Trs['rotation'],
    scale: [...(numberList(node.scale, 3) ?? IDENTITY.scale)] as Trs['scale'],
  };
}

/** The parts of node `index` an animation sets: they are the animation's, not to be changed. */
export function animatedPaths(json: unknown, index: number): Set<TransformPath> {
  const paths = new Set<TransformPath>();
  const animations = isJson(json) && Array.isArray(json.animations) ? json.animations : [];
  for (const animation of animations) {
    const channels =
      isJson(animation) && Array.isArray(animation.channels) ? animation.channels : [];
    for (const channel of channels) {
      const target = isJson(channel) && isJson(channel.target) ? channel.target : undefined;
      if (target?.node !== index) continue;
      const path = target.path;
      if (path === 'translation' || path === 'rotation' || path === 'scale') paths.add(path);
    }
  }
  return paths;
}

/** The scene three.js shows: the default one, or the first. */
function shownScene(json: unknown): { index: number; roots: number[] } | undefined {
  if (!isJson(json) || !Array.isArray(json.scenes)) return undefined;
  const index = typeof json.scene === 'number' ? json.scene : 0;
  const scene: unknown = json.scenes[index];
  if (!isJson(scene) || !Array.isArray(scene.nodes)) return undefined;
  const count = nodesOf(json).length;
  const roots = scene.nodes.filter(
    (node): node is number => Number.isInteger(node) && node >= 0 && node < count,
  );
  return roots.length > 0 ? { index, roots } : undefined;
}

/**
 * The node that moves the whole model: the shown scene's top node, when it has just one and no
 * animation moves it; otherwise `nodes.length`, a node that saving adds above the scene's top
 * nodes. Undefined when the scene shows no nodes.
 */
export function modelTarget(json: unknown): number | undefined {
  const scene = shownScene(json);
  if (!scene) return undefined;
  const [root] = scene.roots;
  if (scene.roots.length === 1 && animatedPaths(json, root).size === 0) return root;
  return nodesOf(json).length;
}

/** The shown scene's index and top nodes, for the node saving adds above them. */
export function modelRoots(json: unknown): { scene: number; roots: number[] } | undefined {
  const scene = shownScene(json);
  return scene && { scene: scene.index, roots: scene.roots };
}

/** Values as they are kept and saved: nine significant digits, and a hair from zero is zero. */
export function cleanValues<T extends number[]>(values: Readonly<T>): T {
  return values.map((value) => (Math.abs(value) < 1e-12 ? 0 : Number(value.toPrecision(9)))) as T;
}

/** `trs` with `path` set to `values`, cleaned; the other parts stay exactly as they were. */
export function withPath(trs: Trs, path: TransformPath, values: readonly number[]): Trs {
  return { ...copyTrs(trs), [path]: cleanValues([...values]) };
}

export function copyTrs(trs: Readonly<Trs>): Trs {
  return {
    translation: [...trs.translation],
    rotation: [...trs.rotation],
    scale: [...trs.scale],
  };
}

export function sameTrs(a: Trs, b: Trs): boolean {
  return TRANSFORM_PATHS.every((path) => a[path].every((value, i) => value === b[path][i]));
}

/** Whether `values` are glTF's default for `path`, which a file leaves out. */
export function isDefault(path: TransformPath, values: readonly number[]): boolean {
  return values.every((value, i) => value === IDENTITY[path][i]);
}

/** Euler angles in degrees, X then Y then Z, as three.js and most tools apply them. */
export function eulerDegrees([x, y, z, w]: readonly number[]): [number, number, number] {
  const length = Math.hypot(x, y, z, w) || 1;
  [x, y, z, w] = [x / length, y / length, z / length, w / length];
  const m11 = 1 - 2 * (y * y + z * z);
  const m12 = 2 * (x * y - z * w);
  const m13 = 2 * (x * z + y * w);
  const m22 = 1 - 2 * (x * x + z * z);
  const m23 = 2 * (y * z - x * w);
  const m32 = 2 * (y * z + x * w);
  const m33 = 1 - 2 * (x * x + y * y);
  const ey = Math.asin(Math.max(-1, Math.min(1, m13)));
  const [ex, ez] =
    Math.abs(m13) < 0.9999999
      ? [Math.atan2(-m23, m33), Math.atan2(-m12, m11)]
      : [Math.atan2(m32, m22), 0];
  return [ex, ey, ez].map((angle) => {
    const degrees = (angle * 180) / Math.PI;
    return Object.is(degrees, -0) ? 0 : degrees;
  }) as [number, number, number];
}

/** The quaternion, x, y, z and w, of Euler angles in degrees applied X then Y then Z. */
export function quaternionFromDegrees(degrees: readonly number[]): Trs['rotation'] {
  const [cx, cy, cz] = degrees.map((value) => Math.cos((value * Math.PI) / 360));
  const [sx, sy, sz] = degrees.map((value) => Math.sin((value * Math.PI) / 360));
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
}

/** A column-major matrix taken apart into translation, rotation and scale, as three.js does. */
function decompose(m: readonly number[]): Trs {
  let sx = Math.hypot(m[0], m[1], m[2]);
  const sy = Math.hypot(m[4], m[5], m[6]);
  const sz = Math.hypot(m[8], m[9], m[10]);
  const determinant =
    m[0] * (m[5] * m[10] - m[9] * m[6]) -
    m[4] * (m[1] * m[10] - m[9] * m[2]) +
    m[8] * (m[1] * m[6] - m[5] * m[2]);
  if (determinant < 0) sx = -sx;
  const r = (value: number, scale: number) => (scale === 0 ? 0 : value / scale);
  const [m11, m21, m31] = [r(m[0], sx), r(m[1], sx), r(m[2], sx)];
  const [m12, m22, m32] = [r(m[4], sy), r(m[5], sy), r(m[6], sy)];
  const [m13, m23, m33] = [r(m[8], sz), r(m[9], sz), r(m[10], sz)];
  const trace = m11 + m22 + m33;
  let rotation: Trs['rotation'];
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    rotation = [(m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25 / s];
  } else if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
    rotation = [0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s];
  } else if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
    rotation = [(m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
    rotation = [(m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s];
  }
  return { translation: [m[12], m[13], m[14]], rotation, scale: [sx, sy, sz] };
}
