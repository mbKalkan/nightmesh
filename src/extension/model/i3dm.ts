// An Instanced 3D Model (i3dm) tile from 3D Tiles: a header, a feature table that places each
// instance, a batch table, and a GLB drawn once for every instance. The GLB shows in the panels as
// the file has it; what is drawn adds EXT_mesh_gpu_instancing to its meshes, with the instances
// moved into a frame of their own, upright where they stand on the globe.
import type { TileFacts } from '../../shared/protocol';
import type { Gltf } from './plan';
import { sliceSource, type ByteSource } from './sources';
import { batchFacts, count, isObject, parseTable } from './tileFile';

export type I3dm =
  | { facts: TileFacts; glb: ByteSource; instances: Float64Array }
  /** The glTF is a file of its own, which the tile names. */
  | { facts: TileFacts; uri: string }
  | { failure: 'notTile' | 'damaged' }
  | { failure: 'version'; version: number };

const HEADER = 32;
/** Tables past this aren't read: they place instances, a few numbers each. */
const MAX_TABLES = 256 * 1024 * 1024;
/** More instances than this aren't drawn: a damaged count would ask for more memory than there is. */
const MAX_INSTANCES = 1 << 24;

export function isI3dm(head: Uint8Array): boolean {
  return new TextDecoder().decode(head.subarray(0, 4)) === 'i3dm';
}

/** Reads an i3dm tile's header and tables, places its instances, and finds its glTF. */
export async function readI3dm(source: ByteSource): Promise<I3dm> {
  const head = await source.read(0, Math.min(HEADER, source.size));
  if (!isI3dm(head)) return { failure: 'notTile' };
  if (head.length < HEADER) return { failure: 'damaged' };
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const version = view.getUint32(4, true);
  if (version !== 1)
    return version < 256 ? { failure: 'version', version } : { failure: 'damaged' };
  const [featureJson, featureBinary, batchJson, batchBinary, gltfFormat] = [12, 16, 20, 24, 28].map(
    (offset) => view.getUint32(offset, true),
  );
  const gltf = HEADER + featureJson + featureBinary + batchJson + batchBinary;
  if (gltf >= source.size || gltf - HEADER > MAX_TABLES || gltfFormat > 1) {
    return { failure: 'damaged' };
  }
  const tables = await source.read(HEADER, gltf - HEADER);
  const featureTable = parseTable(tables.subarray(0, featureJson));
  const batchStart = featureJson + featureBinary;
  const batchTable = parseTable(tables.subarray(batchStart, batchStart + batchJson));
  const body = tables.subarray(featureJson, batchStart);

  const length = count(featureTable.INSTANCES_LENGTH);
  const facts: TileFacts = {
    format: 'i3dm',
    version,
    header: HEADER,
    featureTable: { json: featureJson, binary: featureBinary },
    batchTable: { json: batchJson, binary: batchBinary },
    batchLength: count(featureTable.BATCH_LENGTH),
    instances: length,
    semantics: Object.keys(featureTable).filter((name) => name !== 'extensions'),
    ...batchFacts(batchTable),
  };
  const center = global(body, featureTable.RTC_CENTER, 3);
  if (center) facts.rtcCenter = center as [number, number, number];
  if (isObject(featureTable.extensions)) {
    facts.extensions.unshift(...Object.keys(featureTable.extensions));
  }

  if (gltfFormat === 0) {
    const text = new TextDecoder().decode(await source.read(gltf, source.size - gltf));
    const uri = text.replace(/[\0\s]+$/, '');
    facts.gltfUri = uri;
    return { facts, uri };
  }
  const instances =
    length <= MAX_INSTANCES ? instanceMatrices(featureTable, body, length) : new Float64Array();
  return { facts, glb: sliceSource(source, gltf, source.size - gltf), instances };
}

const COMPONENT_BYTES: Readonly<Record<string, number>> = {
  UNSIGNED_BYTE: 1,
  UNSIGNED_SHORT: 2,
  FLOAT: 4,
};

/**
 * Where a value for `length` instances starts in the body, when it is there, has the type the
 * specification gives it and fits.
 */
function locate(
  body: Uint8Array,
  value: unknown,
  length: number,
  type: string,
  components: number,
): number | undefined {
  if (!isObject(value) || typeof value.byteOffset !== 'number') return undefined;
  if (value.componentType !== undefined && value.componentType !== type) return undefined;
  const at = value.byteOffset;
  const fits = at + length * COMPONENT_BYTES[type] * components <= body.length;
  return Number.isInteger(at) && at >= 0 && fits ? at : undefined;
}

/** A value for the whole tile: in the JSON, or floats in the body. */
function global(body: Uint8Array, value: unknown, components: number): number[] | undefined {
  let numbers: unknown[] | undefined;
  if (Array.isArray(value)) numbers = value;
  else {
    const at = locate(body, value, 1, 'FLOAT', components);
    if (at !== undefined) {
      const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
      numbers = Array.from({ length: components }, (_, i) => view.getFloat32(at + 4 * i, true));
    }
  }
  if (numbers?.length !== components) return undefined;
  return numbers.every((n) => typeof n === 'number' && Number.isFinite(n))
    ? (numbers as number[])
    : undefined;
}

/**
 * Each instance's place in the tile's frame (Z up) as a 4×4 matrix by columns, 16 numbers each:
 * where it is, which way it faces (NORMAL_UP and NORMAL_RIGHT, plain or packed, or east, north
 * and up where it stands on the globe), and its size. Empty when the positions can't be read.
 */
export function instanceMatrices(
  table: Record<string, unknown>,
  body: Uint8Array,
  length: number,
): Float64Array {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const float = (at: number) => view.getFloat32(at, true);
  const uint16 = (at: number) => view.getUint16(at, true);
  const center = global(body, table.RTC_CENTER, 3) ?? [0, 0, 0];

  const plain = locate(body, table.POSITION, length, 'FLOAT', 3);
  const quantized = locate(body, table.POSITION_QUANTIZED, length, 'UNSIGNED_SHORT', 3);
  const volumeOffset = global(body, table.QUANTIZED_VOLUME_OFFSET, 3);
  const volumeScale = global(body, table.QUANTIZED_VOLUME_SCALE, 3);
  const position = (i: number): [number, number, number] | undefined => {
    if (plain !== undefined) {
      const at = plain + i * 12;
      return [float(at) + center[0], float(at + 4) + center[1], float(at + 8) + center[2]];
    }
    if (quantized === undefined || !volumeOffset || !volumeScale) return undefined;
    const at = quantized + i * 6;
    return [0, 1, 2].map(
      (axis) =>
        volumeOffset[axis] + (uint16(at + axis * 2) / 65535) * volumeScale[axis] + center[axis],
    ) as [number, number, number];
  };

  const up = locate(body, table.NORMAL_UP, length, 'FLOAT', 3);
  const right = locate(body, table.NORMAL_RIGHT, length, 'FLOAT', 3);
  const upOct = locate(body, table.NORMAL_UP_OCT32P, length, 'UNSIGNED_SHORT', 2);
  const rightOct = locate(body, table.NORMAL_RIGHT_OCT32P, length, 'UNSIGNED_SHORT', 2);
  const vector = (at: number): Vec3 => [float(at), float(at + 4), float(at + 8)];
  const oct = (at: number): Vec3 => octDecode(uint16(at) / 65535, uint16(at + 2) / 65535);
  const axes = (i: number, place: Vec3): [Vec3, Vec3, Vec3] => {
    let u: Vec3 | undefined;
    let r: Vec3 | undefined;
    if (up !== undefined && right !== undefined)
      [u, r] = [vector(up + i * 12), vector(right + i * 12)];
    else if (upOct !== undefined && rightOct !== undefined)
      [u, r] = [oct(upOct + i * 4), oct(rightOct + i * 4)];
    if (u && r) return [normalize(r), normalize(u), normalize(cross(r, u))];
    if (table.EAST_NORTH_UP === true) return eastNorthUp(place);
    return [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
  };

  const uniform = locate(body, table.SCALE, length, 'FLOAT', 1);
  const nonUniform = locate(body, table.SCALE_NON_UNIFORM, length, 'FLOAT', 3);
  const matrices = new Float64Array(length * 16);
  for (let i = 0; i < length; i++) {
    const place = position(i);
    if (!place) return new Float64Array();
    const scale: Vec3 = [1, 1, 1];
    if (uniform !== undefined) scale.fill(float(uniform + i * 4));
    if (nonUniform !== undefined) {
      const [x, y, z] = vector(nonUniform + i * 12);
      scale[0] *= x;
      scale[1] *= y;
      scale[2] *= z;
    }
    const [x, y, z] = axes(i, place);
    matrices.set(
      [
        ...x.map((v) => v * scale[0]),
        0,
        ...y.map((v) => v * scale[1]),
        0,
        ...z.map((v) => v * scale[2]),
        0,
        ...place,
        1,
      ],
      i * 16,
    );
  }
  return matrices;
}

type Vec3 = [number, number, number];
type Mat4 = Float64Array;

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(...v) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

/** A unit vector packed as a point on an octahedron unfolded into a square, from 0 to 1 each. */
function octDecode(u: number, v: number): Vec3 {
  let x = u * 2 - 1;
  let y = v * 2 - 1;
  const z = 1 - Math.abs(x) - Math.abs(y);
  if (z < 0) {
    [x, y] = [(1 - Math.abs(y)) * Math.sign(x || 1), (1 - Math.abs(x)) * Math.sign(y || 1)];
  }
  return normalize([x, y, z]);
}

/** Below this far from the Earth's center, a place isn't on the globe: its frame is the tile's. */
const GLOBE = 1e6;

/** East, north and up where `place` is on the WGS84 ellipsoid, in Earth-centered coordinates. */
function eastNorthUp(place: Vec3): [Vec3, Vec3, Vec3] {
  if (Math.hypot(...place) < GLOBE) {
    return [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
  }
  // The ellipsoid's normal: the place scaled by the inverse squares of its radii.
  const a2 = 6378137 ** 2;
  const b2 = 6356752.314245179 ** 2;
  const up = normalize([place[0] / a2, place[1] / a2, place[2] / b2]);
  const east = normalize([-place[1], place[0], 0]);
  return [east, normalize(cross(up, east)), up];
}

/** Column-major 4×4 product. */
function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

/** The inverse of a matrix that moves, turns and scales, with no projection. */
function invert(m: Mat4): Mat4 {
  const [a, b, c, , d, e, f, , g, h, i] = m;
  const det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
  if (!det) return identity();
  const inverse = [
    (e * i - f * h) / det,
    (c * h - b * i) / det,
    (b * f - c * e) / det,
    (f * g - d * i) / det,
    (a * i - c * g) / det,
    (c * d - a * f) / det,
    (d * h - e * g) / det,
    (b * g - a * h) / det,
    (a * e - b * d) / det,
  ];
  const out = new Float64Array(16);
  for (let column = 0; column < 3; column++) {
    for (let row = 0; row < 3; row++) out[column * 4 + row] = inverse[column * 3 + row];
  }
  for (let row = 0; row < 3; row++) {
    out[12 + row] = -(out[row] * m[12] + out[4 + row] * m[13] + out[8 + row] * m[14]);
  }
  out[15] = 1;
  return out;
}

const identity = (): Mat4 => Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** glTF's Y up to a tile's Z up, as 3D Tiles turns every glTF it places, and back. */
const Y_UP_TO_Z_UP = Float64Array.from([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]);
const Z_UP_TO_Y_UP = invert(Y_UP_TO_Z_UP);

/**
 * The frame the instances are shown in: centered on them and, when they stand on the globe,
 * turned so that up where they are is up in the view.
 */
export function viewFrame(instances: Float64Array): Mat4 {
  const length = instances.length / 16;
  const center: Vec3 = [0, 0, 0];
  for (let i = 0; i < length; i++) {
    for (let axis = 0; axis < 3; axis++) center[axis] += instances[i * 16 + 12 + axis] / length;
  }
  const [east, north, up] = eastNorthUp(center);
  const local = Float64Array.from([...east, 0, ...north, 0, ...up, 0, ...center, 1]);
  return invert(local);
}

/** A node's matrix: its own, or from its translation, rotation and scale. */
function nodeMatrix(node: Record<string, unknown>): Mat4 {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) {
    return Float64Array.from(node.matrix.map(Number));
  }
  const [tx, ty, tz] = Array.isArray(node.translation) ? node.translation.map(Number) : [0, 0, 0];
  const [x, y, z, w] = Array.isArray(node.rotation) ? node.rotation.map(Number) : [0, 0, 0, 1];
  const [sx, sy, sz] = Array.isArray(node.scale) ? node.scale.map(Number) : [1, 1, 1];
  return Float64Array.from([
    (1 - 2 * (y * y + z * z)) * sx,
    2 * (x * y + z * w) * sx,
    2 * (x * z - y * w) * sx,
    0,
    2 * (x * y - z * w) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    2 * (y * z + x * w) * sy,
    0,
    2 * (x * z + y * w) * sz,
    2 * (y * z - x * w) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ]);
}

/** Translation, rotation (x, y, z, w) and scale of a matrix, leaving out any shear. */
function decompose(m: Mat4): { t: Vec3; r: [number, number, number, number]; s: Vec3 } {
  const columns = [0, 4, 8].map((at) => [m[at], m[at + 1], m[at + 2]] as Vec3);
  const s = columns.map((column) => Math.hypot(...column)) as Vec3;
  const det =
    columns[0][0] * (columns[1][1] * columns[2][2] - columns[1][2] * columns[2][1]) -
    columns[1][0] * (columns[0][1] * columns[2][2] - columns[0][2] * columns[2][1]) +
    columns[2][0] * (columns[0][1] * columns[1][2] - columns[0][2] * columns[1][1]);
  if (det < 0) s[0] = -s[0];
  const [r0, r1, r2] = columns.map((column, i) => column.map((v) => v / (s[i] || 1)) as Vec3);
  // From a rotation matrix whose columns are r0, r1, r2.
  const trace = r0[0] + r1[1] + r2[2];
  let q: [number, number, number, number];
  if (trace > 0) {
    const k = 0.5 / Math.sqrt(trace + 1);
    q = [(r1[2] - r2[1]) * k, (r2[0] - r0[2]) * k, (r0[1] - r1[0]) * k, 0.25 / k];
  } else if (r0[0] > r1[1] && r0[0] > r2[2]) {
    const k = 2 * Math.sqrt(1 + r0[0] - r1[1] - r2[2]);
    q = [0.25 * k, (r1[0] + r0[1]) / k, (r2[0] + r0[2]) / k, (r1[2] - r2[1]) / k];
  } else if (r1[1] > r2[2]) {
    const k = 2 * Math.sqrt(1 + r1[1] - r0[0] - r2[2]);
    q = [(r1[0] + r0[1]) / k, 0.25 * k, (r2[1] + r1[2]) / k, (r2[0] - r0[2]) / k];
  } else {
    const k = 2 * Math.sqrt(1 + r2[2] - r0[0] - r1[1]);
    q = [(r2[0] + r0[2]) / k, (r2[1] + r1[2]) / k, 0.25 * k, (r0[1] - r1[0]) / k];
  }
  const length = Math.hypot(...q) || 1;
  return { t: [m[12], m[13], m[14]], r: q.map((v) => v / length) as typeof q, s };
}

/**
 * The glTF to draw for an i3dm tile: each node with a mesh in the default scene gets every
 * instance through EXT_mesh_gpu_instancing, in its own space, so that it lands where the tile
 * puts it in the view's frame. The instances' data is a buffer of its own, after the file's.
 */
export function instancedGltf(
  json: Gltf,
  instances: Float64Array,
): { json: Gltf; buffer: Uint8Array } | undefined {
  const length = instances.length / 16;
  const nodes = (json.nodes ?? []) as Record<string, unknown>[];
  const scenes = (json as { scenes?: { nodes?: number[] }[]; scene?: number }).scenes ?? [];
  const roots = scenes[(json as { scene?: number }).scene ?? 0]?.nodes ?? [];
  if (length === 0 || roots.length === 0) return undefined;

  // Each node with a mesh, with where its parents and it put it, walked without recursion.
  const placed: { node: number; global: Mat4 }[] = [];
  const stack = roots.map((node) => ({ node, parent: identity() }));
  const seen = new Set<number>();
  while (stack.length > 0) {
    const { node, parent } = stack.pop()!;
    if (seen.has(node) || !nodes[node]) continue;
    seen.add(node);
    const global = multiply(parent, nodeMatrix(nodes[node]));
    if (nodes[node].mesh !== undefined) placed.push({ node, global });
    const children = Array.isArray(nodes[node].children) ? (nodes[node].children as number[]) : [];
    for (const child of children) stack.push({ node: child, parent: global });
  }
  if (placed.length === 0) return undefined;

  const view = multiply(Z_UP_TO_Y_UP, viewFrame(instances));
  const floats = new Float32Array(placed.length * length * 10);
  const out = structuredClone(json) as Gltf & Record<string, unknown>;
  const outNodes = out.nodes as Record<string, unknown>[];
  const buffer = (out.buffers ??= []).push({ byteLength: floats.byteLength }) - 1;
  const views = (out.bufferViews ??= []);
  const accessors = (out.accessors ??= []) as Record<string, unknown>[];
  placed.forEach(({ node, global }, index) => {
    const start = index * length * 10;
    const toNode = invert(global);
    for (let i = 0; i < length; i++) {
      const instance = instances.subarray(i * 16, i * 16 + 16);
      const placedAt = multiply(view, multiply(instance, multiply(Y_UP_TO_Z_UP, global)));
      const { t, r, s } = decompose(multiply(toNode, placedAt));
      floats.set(t, start + i * 3);
      floats.set(r, start + length * 3 + i * 4);
      floats.set(s, start + length * 7 + i * 3);
    }
    const attributes: Record<string, number> = {};
    for (const [name, offset, type, size] of [
      ['TRANSLATION', 0, 'VEC3', 3],
      ['ROTATION', 3, 'VEC4', 4],
      ['SCALE', 7, 'VEC3', 3],
    ] as const) {
      const bufferView =
        views.push({
          buffer,
          byteOffset: (start + length * offset) * 4,
          byteLength: length * size * 4,
        }) - 1;
      attributes[name] =
        accessors.push({ bufferView, componentType: 5126, count: length, type }) - 1;
    }
    const target = outNodes[node];
    target.extensions = {
      ...(isObject(target.extensions) ? target.extensions : {}),
      EXT_mesh_gpu_instancing: { attributes },
    };
  });
  out.extensionsUsed = [...new Set([...(out.extensionsUsed ?? []), 'EXT_mesh_gpu_instancing'])];
  return { json: out, buffer: new Uint8Array(floats.buffer) };
}
