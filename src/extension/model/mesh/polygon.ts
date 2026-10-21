// Polygons as triangles. Most are convex, and a fan from the first corner is right for them; a
// concave one (an L-shaped floor, a letter) would spill outside its outline as a fan, so it is cut
// into ears in the plane it lies in.

/** Polygons with more corners than this are drawn as fans: ear clipping takes time by the square. */
const MAX_EAR_CLIPPED = 1024;

/**
 * Calls `triangle` with the corners (0 to count - 1) of each triangle of a polygon, wound as the
 * polygon is. `xyz` holds the corners' positions, three numbers each.
 */
export function triangulate(
  xyz: ArrayLike<number>,
  count: number,
  triangle: (a: number, b: number, c: number) => void,
): void {
  if (count === 4) return quad(xyz, triangle);
  if (count > 4 && count <= MAX_EAR_CLIPPED) {
    const plane = projected(xyz, count);
    if (plane && !convex(plane, count)) return earClip(plane, count, triangle);
  }
  for (let i = 1; i + 1 < count; i++) triangle(0, i, i + 1);
}

/**
 * A quad, the commonest polygon, split along the diagonal that lies inside it: from corner 0
 * when the two triangles that makes face the same way, from corner 1 when they don't.
 */
function quad(xyz: ArrayLike<number>, triangle: (a: number, b: number, c: number) => void): void {
  // (1 - 0) × (2 - 0) and (2 - 0) × (3 - 0): each triangle's normal.
  const ux = xyz[3] - xyz[0];
  const uy = xyz[4] - xyz[1];
  const uz = xyz[5] - xyz[2];
  const vx = xyz[6] - xyz[0];
  const vy = xyz[7] - xyz[1];
  const vz = xyz[8] - xyz[2];
  const wx = xyz[9] - xyz[0];
  const wy = xyz[10] - xyz[1];
  const wz = xyz[11] - xyz[2];
  const ax = uy * vz - uz * vy;
  const ay = uz * vx - ux * vz;
  const az = ux * vy - uy * vx;
  const bx = vy * wz - vz * wy;
  const by = vz * wx - vx * wz;
  const bz = vx * wy - vy * wx;
  if (ax * bx + ay * by + az * bz >= 0) {
    triangle(0, 1, 2);
    triangle(0, 2, 3);
  } else {
    triangle(1, 2, 3);
    triangle(1, 3, 0);
  }
}

/**
 * The corners in 2D, in the plane the polygon faces most, turned so that it runs anticlockwise
 * there; undefined when it has no area to speak of.
 */
function projected(xyz: ArrayLike<number>, count: number): Float64Array | undefined {
  // Newell's normal: twice the area the polygon covers, seen along each axis.
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    const x0 = xyz[i * 3];
    const y0 = xyz[i * 3 + 1];
    const z0 = xyz[i * 3 + 2];
    const x1 = xyz[j * 3];
    const y1 = xyz[j * 3 + 1];
    const z1 = xyz[j * 3 + 2];
    nx += (y0 - y1) * (z0 + z1);
    ny += (z0 - z1) * (x0 + x1);
    nz += (x0 - x1) * (y0 + y1);
  }
  const largest = Math.max(Math.abs(nx), Math.abs(ny), Math.abs(nz));
  if (!(largest > 0)) return undefined;
  // Seen along the axis it faces most: the other two, the first flipped if it faces away.
  const [u, v, facing] =
    Math.abs(nz) === largest ? [0, 1, nz] : Math.abs(nx) === largest ? [1, 2, nx] : [2, 0, ny];
  const sign = facing > 0 ? 1 : -1;
  const plane = new Float64Array(count * 2);
  for (let i = 0; i < count; i++) {
    plane[i * 2] = xyz[i * 3 + u] * sign;
    plane[i * 2 + 1] = xyz[i * 3 + v];
  }
  return plane;
}

/** How far `c` turns left of the line from `a` through `b`: positive when it does. */
function turn(plane: Float64Array, a: number, b: number, c: number): number {
  const [ax, ay] = [plane[a * 2], plane[a * 2 + 1]];
  return (
    (plane[b * 2] - ax) * (plane[c * 2 + 1] - ay) - (plane[b * 2 + 1] - ay) * (plane[c * 2] - ax)
  );
}

/** Whether every corner turns the same way, or not at all. */
function convex(plane: Float64Array, count: number): boolean {
  for (let i = 0; i < count; i++) {
    if (turn(plane, (i + count - 1) % count, i, (i + 1) % count) < 0) return false;
  }
  return true;
}

/**
 * Cuts off one ear after another: a corner that turns left and whose triangle holds no other
 * corner. If none is found, as in a polygon that crosses itself, the rest is drawn as a fan.
 */
function earClip(
  plane: Float64Array,
  count: number,
  triangle: (a: number, b: number, c: number) => void,
): void {
  const next = Int32Array.from({ length: count }, (_, i) => (i + 1) % count);
  const previous = Int32Array.from({ length: count }, (_, i) => (i + count - 1) % count);
  let left = count;
  let corner = 0;
  let tried = 0;
  while (left > 3) {
    const a = previous[corner];
    const c = next[corner];
    if (isEar(plane, a, corner, c, next)) {
      triangle(a, corner, c);
      next[a] = c;
      previous[c] = a;
      left--;
      tried = 0;
      corner = c;
      continue;
    }
    corner = c;
    if (++tried > left) break;
  }
  // The last triangle, or a fan of what no ear could be found in.
  const first = corner;
  for (let b = next[first]; next[b] !== first; b = next[b]) triangle(first, b, next[b]);
}

function isEar(plane: Float64Array, a: number, b: number, c: number, next: Int32Array): boolean {
  if (turn(plane, a, b, c) <= 0) return false;
  for (let p = next[c]; p !== a; p = next[p]) {
    // A corner at the same place as one of the ear's is the other side of a cut into a hole,
    // as exporters write a ring as one polygon: it doesn't stand in the way.
    if (same(plane, p, a) || same(plane, p, b) || same(plane, p, c)) continue;
    // On an edge counts as inside: a corner there would make a sliver over the cut.
    if (turn(plane, a, b, p) >= 0 && turn(plane, b, c, p) >= 0 && turn(plane, c, a, p) >= 0) {
      return false;
    }
  }
  return true;
}

const same = (plane: Float64Array, p: number, q: number) =>
  plane[p * 2] === plane[q * 2] && plane[p * 2 + 1] === plane[q * 2 + 1];
