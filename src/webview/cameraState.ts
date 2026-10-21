// Cameras of the two sides of a comparison, which move together.
import type { CameraState } from '../shared/protocol';

/** Whether two cameras are in the same place, within what rounding moves them. */
export function sameCamera(a: CameraState, b: CameraState): boolean {
  if (a.projection !== b.projection) return false;
  const scale = Math.max(
    1e-9,
    Math.hypot(...a.position.map((value, axis) => value - a.target[axis])),
  );
  const near = (x: number, y: number, tolerance: number) => Math.abs(x - y) <= tolerance;
  return (
    a.position.every((value, axis) => near(value, b.position[axis], scale * 1e-6)) &&
    a.target.every((value, axis) => near(value, b.target[axis], scale * 1e-6)) &&
    near(a.fov, b.fov, 1e-6) &&
    near(a.height, b.height, a.height * 1e-6) &&
    near(a.zoom, b.zoom, a.zoom * 1e-6)
  );
}
