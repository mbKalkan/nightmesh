// What a 3D printing check asks of a mesh: its surface area and volume, whether it is closed, and
// where it isn't. Corners at the same place are one vertex here, whatever their texture
// coordinates or normals, as a slicer sees them.
import type { MeshCheck } from '../../../shared/protocol';
import { Growable, TripleIndex, bitsOf } from './arrays';
import type { MeshObject, MeshPart, ParsedMesh } from './geometry';

/** Triangles to check: positions, and corners if they aren't every vertex once in order. */
export type Triangles = Pick<MeshPart, 'positions' | 'indices'>;

/** The parts of a mesh that are triangles, in every object. */
export function trianglesOf(mesh: ParsedMesh): MeshPart[] {
  const found: MeshPart[] = [];
  const visit = (objects: readonly MeshObject[]) => {
    for (const object of objects) {
      found.push(...object.parts.filter((part) => part.mode === 'triangles'));
      visit(object.children);
    }
  };
  visit(mesh.objects);
  return found;
}

/** The check of a mesh's triangles; undefined when it has none, as a point cloud. */
export function checkMesh(parts: readonly Triangles[]): MeshCheck | undefined {
  const most = parts.reduce((sum, part) => sum + part.positions.length / 3, 0);
  if (most === 0) return undefined;
  const weld = new TripleIndex(most);
  const positions = new Growable(Float64Array, most * 3);
  const corners = new Growable(Uint32Array, most * 3);
  for (const part of parts) {
    const xyz = part.positions;
    const vertex = new Uint32Array(xyz.length / 3);
    for (let i = 0; i < vertex.length; i++) {
      const x = xyz[i * 3];
      const y = xyz[i * 3 + 1];
      const z = xyz[i * 3 + 2];
      vertex[i] = weld.index(bitsOf(x), bitsOf(y), bitsOf(z));
      if (weld.added) positions.push3(x, y, z);
    }
    const { indices } = part;
    const count = indices?.length ?? vertex.length;
    corners.reserve(count - (count % 3));
    for (let i = 0; i + 2 < count; i += 3) {
      for (let k = 0; k < 3; k++) corners.push(vertex[indices ? indices[i + k] : i + k]);
    }
  }
  if (corners.length === 0) return undefined;
  return measure(positions.array, weld.size, corners.array.subarray(0, corners.length));
}

/**
 * Area, volume, edges and shells of `triangles`, three vertex indices each. Each edge is listed
 * under its smaller vertex, so the faces along it are counted vertex by vertex, in the order the
 * file has them, rather than all over memory.
 */
export function measure(
  positions: Float64Array,
  vertices: number,
  triangles: Uint32Array,
): MeshCheck {
  const count = triangles.length / 3;
  let twiceArea = 0;
  let sixTimesVolume = 0;
  let degenerate = 0;
  // Edges under each vertex: how many first, then where each vertex's list starts.
  const start = new Uint32Array(vertices + 1);
  for (let t = 0; t < count; t++) {
    const a = triangles[t * 3];
    const b = triangles[t * 3 + 1];
    const c = triangles[t * 3 + 2];
    if (a === b || b === c || a === c) {
      degenerate++;
      continue;
    }
    const ax = positions[a * 3];
    const ay = positions[a * 3 + 1];
    const az = positions[a * 3 + 2];
    const bx = positions[b * 3];
    const by = positions[b * 3 + 1];
    const bz = positions[b * 3 + 2];
    const cx = positions[c * 3];
    const cy = positions[c * 3 + 1];
    const cz = positions[c * 3 + 2];
    // (b - a) × (c - a): twice the area, and its direction the way the face is wound.
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    twiceArea += Math.sqrt(nx * nx + ny * ny + nz * nz);
    // Six times the tetrahedron from the origin to the face: they add up to what a closed
    // surface holds.
    sixTimesVolume +=
      ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
    start[(a < b ? a : b) + 1]++;
    start[(b < c ? b : c) + 1]++;
    start[(c < a ? c : a) + 1]++;
  }
  for (let v = 0; v < vertices; v++) start[v + 1] += start[v];

  // Each edge's other vertex, times two, plus one when the face goes along it from the smaller.
  const ends = new Float64Array(start[vertices]);
  const next = start.slice(0, vertices);
  const list = (from: number, to: number) => {
    if (from < to) ends[next[from]++] = to * 2 + 1;
    else ends[next[to]++] = from * 2;
  };
  for (let t = 0; t < count; t++) {
    const a = triangles[t * 3];
    const b = triangles[t * 3 + 1];
    const c = triangles[t * 3 + 2];
    if (a === b || b === c || a === c) continue;
    list(a, b);
    list(b, c);
    list(c, a);
  }

  const parent = Int32Array.from({ length: vertices }, (_, i) => i);
  const root = (v: number): number => {
    while (parent[v] !== v) {
      parent[v] = parent[parent[v]];
      v = parent[v];
    }
    return v;
  };
  let open = 0;
  let nonManifold = 0;
  let flipped = 0;
  let shells = 0;
  for (let v = 0; v < vertices; v++) {
    const from = start[v];
    const to = start[v + 1];
    if (to === from) continue;
    // A vertex's edges in order: the faces along one edge are then side by side.
    sortRange(ends, from, to);
    for (let i = from; i < to;) {
      const other = Math.floor(ends[i] / 2);
      let uses = 0;
      let forward = 0;
      for (; i < to && Math.floor(ends[i] / 2) === other; i++) {
        uses++;
        forward += ends[i] % 2;
      }
      if (uses === 1) open++;
      else if (uses > 2) nonManifold++;
      // Two faces turned the same way: one of them is wound against the other.
      else if (forward !== 1) flipped++;
      const rv = root(v);
      const ro = root(other);
      if (rv !== ro) parent[ro] = rv;
    }
  }
  // A shell's root lists edges of its own; a vertex of no face lists none and is no shell.
  for (let v = 0; v < vertices; v++) if (parent[v] === v && start[v + 1] > start[v]) shells++;

  const check: MeshCheck = {
    triangles: count,
    area: twiceArea / 2,
    shells,
    degenerate,
    openEdges: open,
    nonManifoldEdges: nonManifold,
    flippedEdges: flipped,
  };
  if (open === 0 && nonManifold === 0 && flipped === 0) check.volume = sixTimesVolume / 6;
  return check;
}

/** Sorts `values` from `from` to `to` in place: by insertion for a vertex's few edges. */
function sortRange(values: Float64Array, from: number, to: number): void {
  if (to - from > 32) {
    values.subarray(from, to).sort();
    return;
  }
  for (let i = from + 1; i < to; i++) {
    const value = values[i];
    let j = i - 1;
    for (; j >= from && values[j] > value; j--) values[j + 1] = values[j];
    values[j + 1] = value;
  }
}
