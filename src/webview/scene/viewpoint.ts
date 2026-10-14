import {
  MathUtils,
  OrthographicCamera,
  PerspectiveCamera,
  Spherical,
  Vector3,
  type Box3,
  type Sphere,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Projection, StandardView } from '../../shared/protocol';

/** Where the camera looks from in each standard view: a glTF model faces +Z, with +Y up. */
export const VIEW_DIRECTIONS: Readonly<Record<StandardView, Vector3>> = {
  front: new Vector3(0, 0, 1),
  back: new Vector3(0, 0, -1),
  right: new Vector3(1, 0, 0),
  left: new Vector3(-1, 0, 0),
  top: new Vector3(0, 1, 0),
  bottom: new Vector3(0, -1, 0),
};

/**
 * Each standard view as the orbit's angles: `theta` around the vertical from +Z toward +X, `phi`
 * down from straight above.
 */
const ANGLES: Readonly<Record<StandardView, { theta: number; phi: number }>> = {
  front: { theta: 0, phi: Math.PI / 2 },
  back: { theta: Math.PI, phi: Math.PI / 2 },
  right: { theta: Math.PI / 2, phi: Math.PI / 2 },
  left: { theta: -Math.PI / 2, phi: Math.PI / 2 },
  top: { theta: 0, phi: 0 },
  bottom: { theta: 0, phi: Math.PI },
};

export const OPPOSITE: Readonly<Record<StandardView, StandardView>> = {
  front: 'back',
  back: 'front',
  right: 'left',
  left: 'right',
  top: 'bottom',
  bottom: 'top',
};

/** Where a model is first looked at from: the front, right and above. */
const FIRST_DIRECTION = new Vector3(1, 0.6, 1.4).normalize();
const FOV = 45;
/** How long the camera takes to turn to a standard view, in milliseconds. */
const TURN_TIME = 300;
/** Framing leaves this much room around what it frames. */
const MARGIN = 1.08;

/**
 * The camera, orbited around a point with the mouse or the keyboard, in perspective or
 * orthographic projection. It frames boxes, turns to standard views, and keeps the clipping
 * planes around the model wherever it goes. `changed` runs whenever the view needs drawing.
 */
export class Viewpoint {
  readonly perspective = new PerspectiveCamera(FOV, 1, 0.01, 1000);
  readonly orthographic = new OrthographicCamera(-1, 1, 1, -1, 0.01, 1000);
  readonly controls: OrbitControls;
  /** The standard view the camera was turned to, until the user moves it. */
  view: StandardView | undefined;
  private aspect = 1;
  private turnRequest = 0;

  constructor(
    canvas: HTMLCanvasElement | null,
    /** Bounds of the whole model, kept between the clipping planes. */
    private readonly bounds: Sphere,
    private readonly changed: () => void,
  ) {
    this.controls = new OrbitControls(this.perspective, canvas);
    this.controls.addEventListener('change', () => this.afterMove());
    this.controls.addEventListener('start', () => {
      this.stopTurn();
      this.view = undefined;
    });
  }

  get camera(): PerspectiveCamera | OrthographicCamera {
    return this.controls.object as PerspectiveCamera | OrthographicCamera;
  }

  get projection(): Projection {
    return this.camera === this.orthographic ? 'orthographic' : 'perspective';
  }

  /** The direction from the point orbited to the camera. */
  direction(): Vector3 {
    return this.camera.position.clone().sub(this.controls.target).normalize();
  }

  setAspect(aspect: number): void {
    this.aspect = aspect;
    this.perspective.aspect = aspect;
    this.perspective.updateProjectionMatrix();
    this.setOrthographicHeight(this.orthographic.top);
  }

  /**
   * Switches projection without changing what is seen at the point orbited: the orthographic
   * view is as tall there as the perspective one.
   */
  setProjection(projection: Projection): void {
    if (projection === this.projection) return;
    this.stopTurn();
    const from = this.camera;
    const target = this.controls.target;
    const direction = this.direction();
    const tan = Math.tan(MathUtils.degToRad(FOV / 2));
    if (projection === 'orthographic') {
      const height = from.position.distanceTo(target) * tan;
      this.orthographic.zoom = 1;
      this.setOrthographicHeight(height);
      this.orthographic.position.copy(target).addScaledVector(direction, this.standOff(height));
    } else {
      const height = this.orthographic.top / this.orthographic.zoom;
      this.perspective.position.copy(target).addScaledVector(direction, height / tan);
    }
    this.controls.object = projection === 'orthographic' ? this.orthographic : this.perspective;
    this.camera.quaternion.copy(from.quaternion);
    this.controls.update();
    this.afterMove();
  }

  /**
   * Points the camera at `box` from `direction`, or from where it looks now, as close as it can
   * while every corner of the box stays in view. The first framing looks from the front, right
   * and above.
   */
  frame(box: Box3, direction?: Vector3): void {
    this.stopTurn();
    const center = box.getCenter(new Vector3());
    const from = (direction ?? FIRST_DIRECTION).clone().normalize();
    // Turned toward the box first, so its corners can be measured along the camera's own axes:
    // a view straight down has no "right" to compute from the direction alone.
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(from);
    this.controls.update();
    this.camera.updateMatrixWorld();
    const right = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);

    let distance = 0;
    let height = 0;
    const tanY = Math.tan(MathUtils.degToRad(FOV / 2));
    const tanX = tanY * this.aspect;
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          const corner = new Vector3(x, y, z).sub(center);
          // A corner closer to the camera needs the camera further back to stay in the frustum.
          const toward = corner.dot(from);
          const across = Math.abs(corner.dot(right));
          const along = Math.abs(corner.dot(up));
          distance = Math.max(distance, toward + across / tanX, toward + along / tanY);
          height = Math.max(height, along, across / this.aspect);
        }
      }
    }
    if (this.projection === 'orthographic') {
      height = Math.max(height * MARGIN, 1e-3);
      this.orthographic.zoom = 1;
      this.setOrthographicHeight(height);
      distance = this.standOff(height);
    } else {
      distance = Math.max(distance * MARGIN, 1e-3);
    }
    this.camera.position.copy(center).addScaledVector(from, distance);
    this.controls.update();
    this.afterMove();
  }

  /**
   * Turns the camera around the point orbited to look from a standard view, along the shortest
   * way around and over. Seen from above or below, the model's front is at the bottom.
   */
  look(view: StandardView, animate = !prefersReducedMotion()): void {
    this.stopTurn();
    const target = this.controls.target;
    const from = new Spherical().setFromVector3(this.camera.position.clone().sub(target));
    const to = ANGLES[view];
    // The way around the vertical that turns less: never more than half a turn.
    const around =
      MathUtils.euclideanModulo(to.theta - from.theta + Math.PI, Math.PI * 2) - Math.PI;
    const place = (amount: number) => {
      const spherical = new Spherical(
        from.radius,
        MathUtils.lerp(from.phi, to.phi, amount),
        from.theta + around * amount,
      );
      this.camera.position.copy(target).add(new Vector3().setFromSpherical(spherical));
      this.controls.update();
    };
    const finish = () => {
      place(1);
      this.view = view;
      this.afterMove();
    };
    if (!animate) return finish();
    const start = performance.now();
    const step = (now: number) => {
      const amount = Math.min((now - start) / TURN_TIME, 1);
      if (amount >= 1) {
        this.turnRequest = 0;
        return finish();
      }
      place(easeInOut(amount));
      this.turnRequest = requestAnimationFrame(step);
    };
    this.turnRequest = requestAnimationFrame(step);
  }

  /** Orbits by angles in radians: around the vertical, then up over the point orbited. */
  orbit(left: number, up: number): void {
    this.stopTurn();
    this.view = undefined;
    this.controls.rotateLeft(left);
    this.controls.rotateUp(up);
  }

  /** Moves in, or zooms in when orthographic, by `factor`; below 1 moves out. */
  zoom(factor: number): void {
    this.stopTurn();
    // The controls name these the other way around: dollying "out" brings the camera closer.
    if (factor > 1) this.controls.dollyOut(factor);
    else this.controls.dollyIn(1 / factor);
  }

  dispose(): void {
    this.stopTurn();
    this.controls.dispose();
  }

  private afterMove(): void {
    this.updateClipping();
    this.changed();
  }

  private stopTurn(): void {
    if (this.turnRequest) cancelAnimationFrame(this.turnRequest);
    this.turnRequest = 0;
  }

  /** Half the orthographic view's height, at zoom 1; its width follows the aspect. */
  private setOrthographicHeight(height: number): void {
    const camera = this.orthographic;
    camera.top = height;
    camera.bottom = -height;
    camera.right = height * this.aspect;
    camera.left = -height * this.aspect;
    camera.updateProjectionMatrix();
  }

  /**
   * How far back an orthographic camera stands: distance doesn't change what it sees, but the
   * whole model has to be in front of it.
   */
  private standOff(height: number): number {
    const toModel = this.bounds.center.distanceTo(this.controls.target);
    return Math.max(height, toModel + this.bounds.radius * 2, 1e-3);
  }

  /**
   * Keeps the whole model between the clipping planes wherever the camera is: the far plane past
   * its farthest side, the near one well short of the point orbited, so a part zoomed in on is
   * never cut and the rest of the model doesn't disappear behind it.
   */
  updateClipping(): void {
    const camera = this.camera;
    const toModel = camera.position.distanceTo(this.bounds.center);
    const far = Math.max(toModel + this.bounds.radius * 2, 1e-2);
    const toTarget = camera.position.distanceTo(this.controls.target);
    camera.far = far;
    camera.near = Math.max(Math.min(toTarget / 100, far / 1000), far / 1e6);
    camera.updateProjectionMatrix();
  }
}

function easeInOut(amount: number): number {
  return amount < 0.5 ? 2 * amount * amount : 1 - (-2 * amount + 2) ** 2 / 2;
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
