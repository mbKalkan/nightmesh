import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Group,
  Line,
  LineBasicMaterial,
  Points,
  PointsMaterial,
  SRGBColorSpace,
  Vector3,
  type Object3D,
  type OrthographicCamera,
  type PerspectiveCamera,
} from 'three';

/** The ends of a measurement are dots this many CSS pixels across. */
const DOT_SIZE = 9;

/** A measurement as far as it has come: its ends, and once both are placed how far apart. */
export interface Measurement {
  /** How many of the two ends are placed. */
  ends: number;
  /** In metres, once both ends are placed. */
  length?: number;
  /** How far apart the ends are along X, Y and Z, in metres. */
  delta?: [number, number, number];
}

/** An end of the measurement, kept in its object's own space so it moves with the object. */
interface End {
  object: Object3D;
  local: Vector3;
}

/**
 * The distance between two points on the model: dots at the ends, a line between them, solid
 * where it can be seen and faint where the model hides it, and the length over its middle.
 */
export class Ruler {
  readonly group = new Group();
  private readonly ends: End[] = [];
  private readonly positions = new BufferAttribute(new Float32Array(6), 3);
  private readonly front = new LineBasicMaterial({ toneMapped: false });
  private readonly behind = new LineBasicMaterial({
    toneMapped: false,
    transparent: true,
    opacity: 0.35,
    depthTest: false,
    depthWrite: false,
  });
  private readonly dots: PointsMaterial;
  private readonly lines: Line[];
  private readonly label: HTMLElement;

  constructor(container: HTMLElement) {
    this.group.name = 'Nightmesh ruler';
    this.group.visible = false;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', this.positions);
    this.dots = new PointsMaterial({
      size: DOT_SIZE * window.devicePixelRatio,
      sizeAttenuation: false,
      map: dot(),
      alphaTest: 0.5,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.lines = [new Line(geometry, this.behind), new Line(geometry, this.front)];
    const points = new Points(geometry, this.dots);
    // Over the model, the dots over the line.
    [...this.lines, points].forEach((object, index) => {
      object.frustumCulled = false;
      object.renderOrder = 1000 + index;
      this.group.add(object);
    });
    this.label = document.createElement('div');
    this.label.className = 'nm-ruler-label';
    // The corner of the view says it, for screen readers too.
    this.label.setAttribute('aria-hidden', 'true');
    this.label.hidden = true;
    container.append(this.label);
  }

  /** The theme's focus color, as sRGB channels from 0 to 1. */
  setColor([r, g, b]: readonly [number, number, number]): void {
    for (const material of [this.front, this.behind, this.dots])
      material.color.setRGB(r, g, b, SRGBColorSpace);
  }

  /** Places an end where `point` is on `object`; after two, a third starts a new measurement. */
  add(point: Vector3, object: Object3D): void {
    if (this.ends.length === 2) this.ends.length = 0;
    object.updateWorldMatrix(true, false);
    this.ends.push({ object, local: object.worldToLocal(point.clone()) });
  }

  clear(): void {
    this.ends.length = 0;
    this.group.visible = false;
    this.label.hidden = true;
  }

  /**
   * Puts the dots and the line where the ends are now and the length over the line's middle, as
   * `camera` sees it; `lengthText` writes a length given in metres.
   */
  update(
    camera: PerspectiveCamera | OrthographicCamera,
    lengthText: (metres: number) => string,
  ): Measurement {
    const points = this.ends.map(({ object, local }) => object.localToWorld(local.clone()));
    points.forEach((point, index) => this.positions.setXYZ(index, point.x, point.y, point.z));
    this.positions.needsUpdate = true;
    this.group.visible = points.length > 0;
    const [a, b] = points;
    for (const line of this.lines) line.visible = b !== undefined;
    (this.group.children[2] as Points).geometry.setDrawRange(0, points.length);
    if (!a || !b) {
      this.label.hidden = true;
      return { ends: points.length };
    }
    const length = a.distanceTo(b);
    camera.updateMatrixWorld();
    const middle = a.clone().add(b).multiplyScalar(0.5).project(camera);
    // Behind the camera, or past the edges, it isn't shown.
    this.label.hidden =
      middle.z < -1 || middle.z > 1 || Math.abs(middle.x) > 1 || Math.abs(middle.y) > 1;
    this.label.textContent = lengthText(length);
    this.label.style.left = `${((middle.x + 1) / 2) * 100}%`;
    this.label.style.top = `${((1 - middle.y) / 2) * 100}%`;
    return {
      ends: 2,
      length,
      delta: [Math.abs(b.x - a.x), Math.abs(b.y - a.y), Math.abs(b.z - a.z)],
    };
  }

  dispose(): void {
    (this.group.children[0] as Line).geometry.dispose();
    this.dots.map?.dispose();
    for (const material of [this.front, this.behind, this.dots]) material.dispose();
    this.label.remove();
  }
}

/** A round dot, white, for the points' color to tint. */
function dot(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.beginPath();
  context.arc(16, 16, 15, 0, Math.PI * 2);
  context.fill();
  return new CanvasTexture(canvas);
}
