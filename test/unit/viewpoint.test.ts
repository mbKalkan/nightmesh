import { Box3, MathUtils, Sphere, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Viewpoint } from '../../src/webview/scene/viewpoint';

/** A model 4 m wide, 2 m tall and 1 m deep, standing on the ground at x = 10. */
const BOX = new Box3(new Vector3(8, 0, -0.5), new Vector3(12, 2, 0.5));

function viewpoint(aspect = 1.5) {
  const bounds = BOX.getBoundingSphere(new Sphere());
  let changes = 0;
  const view = new Viewpoint(null, bounds, () => changes++);
  view.setAspect(aspect);
  return { view, changes: () => changes };
}

/** The box's corners in normalized device coordinates: in view when all are within ±1. */
function corners(view: Viewpoint): Vector3[] {
  const camera = view.camera;
  camera.updateMatrixWorld();
  const points: Vector3[] = [];
  for (const x of [BOX.min.x, BOX.max.x])
    for (const y of [BOX.min.y, BOX.max.y])
      for (const z of [BOX.min.z, BOX.max.z]) points.push(new Vector3(x, y, z).project(camera));
  return points;
}

const extent = (points: Vector3[]) =>
  Math.max(...points.map((point) => Math.max(Math.abs(point.x), Math.abs(point.y))));

/** Where the camera's top points in the world. */
function screenUp(view: Viewpoint): Vector3 {
  view.camera.updateMatrixWorld();
  return new Vector3().setFromMatrixColumn(view.camera.matrixWorld, 1);
}

const near = (a: Vector3, b: Vector3, tolerance = 1e-4) =>
  expect(a.distanceTo(b)).toBeLessThan(tolerance);

describe('Viewpoint', () => {
  it('frames a box closely, with every corner in view, in either projection', () => {
    const { view, changes } = viewpoint();
    view.frame(BOX);
    expect(extent(corners(view))).toBeLessThanOrEqual(1);
    expect(extent(corners(view))).toBeGreaterThan(0.85);
    near(view.controls.target, BOX.getCenter(new Vector3()));
    expect(changes()).toBeGreaterThan(0);

    view.setProjection('orthographic');
    view.frame(BOX, new Vector3(0, 0, 1));
    expect(view.projection).toBe('orthographic');
    expect(extent(corners(view))).toBeLessThanOrEqual(1);
    expect(extent(corners(view))).toBeGreaterThan(0.85);
    // Far enough back that the whole model is in front of the camera.
    for (const point of corners(view)) expect(point.z).toBeGreaterThan(-1);
  });

  it('frames from where it looks now when asked to', () => {
    const { view } = viewpoint();
    view.frame(BOX);
    view.look('left', false);
    view.frame(new Box3(new Vector3(9, 0, 0), new Vector3(10, 1, 0.5)), view.direction());
    near(view.direction(), new Vector3(-1, 0, 0));
  });

  it('switches projection without changing what is seen at the point orbited', () => {
    const { view } = viewpoint();
    view.frame(BOX);
    const distance = view.camera.position.distanceTo(view.controls.target);
    const direction = view.direction();
    view.setProjection('orthographic');
    const height = view.orthographic.top / view.orthographic.zoom;
    expect(height).toBeCloseTo(distance * Math.tan(MathUtils.degToRad(22.5)), 6);
    near(view.direction(), direction);

    view.zoom(2);
    expect(view.orthographic.zoom).toBeCloseTo(2, 6);
    view.setProjection('perspective');
    expect(view.camera.position.distanceTo(view.controls.target)).toBeCloseTo(distance / 2, 6);
    near(view.direction(), direction);
  });

  it('turns to standard views, with the front at the bottom seen from above or below', () => {
    const { view } = viewpoint();
    view.frame(BOX);
    const distance = view.camera.position.distanceTo(view.controls.target);
    const cases = [
      ['front', new Vector3(0, 0, 1), new Vector3(0, 1, 0)],
      ['back', new Vector3(0, 0, -1), new Vector3(0, 1, 0)],
      ['right', new Vector3(1, 0, 0), new Vector3(0, 1, 0)],
      ['left', new Vector3(-1, 0, 0), new Vector3(0, 1, 0)],
      ['top', new Vector3(0, 1, 0), new Vector3(0, 0, -1)],
      ['bottom', new Vector3(0, -1, 0), new Vector3(0, 0, 1)],
    ] as const;
    for (const [name, direction, up] of cases) {
      view.look(name, false);
      expect(view.view).toBe(name);
      near(view.direction(), direction);
      near(screenUp(view), up);
      expect(view.camera.position.distanceTo(view.controls.target)).toBeCloseTo(distance, 6);
    }
  });

  it('orbits and zooms in steps, and forgets the standard view once moved', () => {
    const { view } = viewpoint();
    view.frame(BOX);
    view.look('front', false);
    // As dragging to the right does: the camera goes left, the model turns right.
    view.orbit(Math.PI / 2, 0);
    expect(view.view).toBeUndefined();
    near(view.direction(), new Vector3(-1, 0, 0));
    const distance = view.camera.position.distanceTo(view.controls.target);
    view.zoom(1.25);
    expect(view.camera.position.distanceTo(view.controls.target)).toBeCloseTo(distance / 1.25, 6);
    view.zoom(1 / 1.25);
    expect(view.camera.position.distanceTo(view.controls.target)).toBeCloseTo(distance, 6);
  });

  it('keeps the whole model between the clipping planes', () => {
    const { view } = viewpoint();
    view.frame(BOX);
    view.zoom(20);
    const camera = view.camera;
    const toTarget = camera.position.distanceTo(view.controls.target);
    expect(camera.near).toBeLessThan(toTarget);
    const farthest = Math.max(
      ...[BOX.min, BOX.max].map((corner) => camera.position.distanceTo(corner)),
    );
    expect(camera.far).toBeGreaterThan(farthest);
  });
});

describe('Viewpoint.lookThrough', () => {
  it('looks through a perspective camera from the file, with its field of view', async () => {
    const { PerspectiveCamera } = await import('three');
    const { view } = viewpoint();
    view.frame(BOX);
    const camera = new PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(10, 1, 6);
    view.lookThrough(camera);
    expect(view.projection).toBe('perspective');
    expect(view.perspective.fov).toBe(30);
    near(view.camera.position, new Vector3(10, 1, 6));
    near(view.direction(), new Vector3(0, 0, 1));
    // The point orbited is level with the model's middle, straight ahead.
    expect(view.controls.target.z).toBeCloseTo(0, 6);

    // Framing goes back to the viewer's own field of view.
    view.frame(BOX);
    expect(view.perspective.fov).toBe(45);
  });

  it('looks through an orthographic camera, as tall as it is', async () => {
    const { OrthographicCamera, Quaternion } = await import('three');
    const { view } = viewpoint();
    view.frame(BOX);
    const camera = new OrthographicCamera(-3, 3, 2, -2, 0.1, 50);
    camera.position.set(10, 10, 0);
    camera.quaternion.copy(new Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2));
    view.lookThrough(camera);
    expect(view.projection).toBe('orthographic');
    expect(view.orthographic.top / view.orthographic.zoom).toBeCloseTo(2, 6);
    // Leaning a hair to the front, so the view's top stays the camera's top.
    near(view.direction(), new Vector3(0, 1, 0), 1e-3);
    near(screenUp(view), new Vector3(0, 0, -1), 1e-3);
  });
});
