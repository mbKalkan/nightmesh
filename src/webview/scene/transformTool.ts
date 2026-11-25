import type { Object3D, OrthographicCamera, PerspectiveCamera } from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { TransformMode } from '../../shared/transforms';

const CONTROL_MODES = { move: 'translate', rotate: 'rotate', scale: 'scale' } as const;

export interface TransformToolEvents {
  /** A handle was grabbed, or let go: the camera stays still meanwhile. */
  dragging(dragging: boolean): void;
  /** The handles moved the object (`moved`), or only look different, as under the pointer. */
  changed(moved: boolean): void;
}

/**
 * Handles on a node in the 3D view to move, rotate or scale it with the mouse (D-069): three.js's
 * TransformControls, in the view's camera.
 */
export class TransformTool {
  private readonly controls: TransformControls;
  /** What the view draws for the handles, over the model. */
  readonly helper: Object3D;
  /** A handle is held: told once when grabbed, once when let go. */
  private grabbed = false;

  constructor(
    camera: PerspectiveCamera | OrthographicCamera,
    canvas: HTMLCanvasElement,
    events: TransformToolEvents,
  ) {
    this.controls = new TransformControls(camera, canvas);
    this.helper = this.controls.getHelper();
    const grab = (grabbed: boolean) => {
      if (grabbed === this.grabbed) return;
      this.grabbed = grabbed;
      events.dragging(grabbed);
    };
    this.controls.addEventListener('dragging-changed', ({ value }) => grab(value as boolean));
    this.controls.addEventListener('change', () => events.changed(false));
    this.controls.addEventListener('objectChange', () => events.changed(true));
    // Before the camera's controls hear the press, so the camera doesn't start turning.
    canvas.addEventListener(
      'pointerdown',
      (event) => {
        if (event.button === 0 && this.engaged) grab(true);
      },
      { capture: true },
    );
    // A press over a handle that didn't become a drag.
    canvas.addEventListener('pointerup', () => {
      if (!this.controls.dragging) grab(false);
    });
  }

  /** Shows the handles of `mode` on `object`; none without either. */
  show(object: Object3D | undefined, mode: TransformMode | undefined): void {
    if (!object || !mode) {
      this.controls.detach();
      return;
    }
    this.controls.setMode(CONTROL_MODES[mode]);
    if (this.controls.object !== object) this.controls.attach(object);
  }

  /** The object the handles are on. */
  get object(): Object3D | undefined {
    return this.controls.object;
  }

  get dragging(): boolean {
    return this.controls.dragging;
  }

  /** The pointer is over a handle, or drags one: a click there doesn't pick what is behind. */
  get engaged(): boolean {
    return (
      this.controls.object !== undefined && (this.controls.dragging || this.controls.axis !== null)
    );
  }

  /** Follows the view's camera, which changes with the projection. */
  setCamera(camera: PerspectiveCamera | OrthographicCamera): void {
    if (this.controls.camera !== camera) this.controls.camera = camera;
  }

  dispose(): void {
    this.controls.detach();
    this.controls.dispose();
  }
}
