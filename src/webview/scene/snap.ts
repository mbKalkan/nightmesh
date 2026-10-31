// Where a measurement's end snaps to, from small drawings of the patch around the pointer: the
// picker draws them on the GPU, these read them. Each drawing is `size` × `size` pixels of four
// floats, rows from the bottom up.

/**
 * Faces that meet at less than this angle, in degrees, are taken as one flat surface: the
 * diagonal that splits a rectangle in two is no edge of the shape. Above float noise, below any
 * angle a model is made with.
 */
const CREASE_DEGREES = 1;
const CREASE_COS = Math.cos((CREASE_DEGREES * Math.PI) / 180);

/**
 * A surface whose plane misses the edge's point by more than this fraction of the point's
 * distance from the camera is another surface, behind or in front: about a pixel at most views.
 */
const OFF_PLANE = 1e-3;

/**
 * The offset of the pixel nearest the middle of the patch with something written on it (its
 * fourth float, the number of its object, from 1), at most `radius` pixels from the middle;
 * `accept` can turn pixels down.
 */
export function nearestWritten(
  pixels: Float32Array,
  size: number,
  radius: number,
  accept: (offset: number, row: number, column: number) => boolean = () => true,
): number | undefined {
  const middle = size >> 1;
  const found: { offset: number; row: number; column: number; distance: number }[] = [];
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const offset = (row * size + column) * 4;
      if (pixels[offset + 3] < 0.5) continue;
      const distance = (row - middle) ** 2 + (column - middle) ** 2;
      if (distance <= radius * radius) found.push({ offset, row, column, distance });
    }
  }
  found.sort((a, b) => a.distance - b.distance);
  return found.find(({ offset, row, column }) => accept(offset, row, column))?.offset;
}

/**
 * Whether the edge drawn at a pixel, at the view-space `point`, is an edge of the shape: where
 * the surfaces around it meet at an angle, end, or are not all one surface through the point.
 * `planes` holds, for each pixel, the plane of the face drawn there (its normal and its distance
 * along it, in view space), or zeros where none is.
 */
export function onEdgeOfShape(
  planes: Float32Array,
  size: number,
  row: number,
  column: number,
  point: readonly [number, number, number],
): boolean {
  const [x, y, z] = point;
  const tolerance = Math.hypot(x, y, z) * OFF_PLANE;
  let first: [number, number, number] | undefined;
  for (let r = row - 1; r <= row + 1; r++) {
    for (let c = column - 1; c <= column + 1; c++) {
      if (r < 0 || c < 0 || r >= size || c >= size) continue;
      const offset = (r * size + c) * 4;
      const nx = planes[offset];
      const ny = planes[offset + 1];
      const nz = planes[offset + 2];
      // Nothing there: the surface ends at the edge.
      if (nx * nx + ny * ny + nz * nz < 0.25) return true;
      if (Math.abs(nx * x + ny * y + nz * z - planes[offset + 3]) > tolerance) return true;
      // Either way a face is turned, its plane is the same.
      if (!first) first = [nx, ny, nz];
      else if (Math.abs(nx * first[0] + ny * first[1] + nz * first[2]) < CREASE_COS) return true;
    }
  }
  return false;
}

/** Whether a face is drawn anywhere in the patch `planes` holds. */
export function anyFace(planes: Float32Array): boolean {
  for (let offset = 0; offset < planes.length; offset += 4) {
    if (planes[offset] !== 0 || planes[offset + 1] !== 0 || planes[offset + 2] !== 0) return true;
  }
  return false;
}
