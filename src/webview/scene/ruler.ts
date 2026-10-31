import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Group,
  LineBasicMaterial,
  LineSegments,
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
/** The ring around the point a click would snap to, in CSS pixels across. */
const RING_SIZE = 17;
/** Room for this many ends at first; more makes room for twice as many. */
const FIRST_ENDS = 16;

/** The last measurement as far as it has come: its ends, and once both are placed how far apart. */
export interface Measurement {
  /** How many of the two ends are placed. */
  ends: number;
  /** In metres, once both ends are placed. */
  length?: number;
  /** How far apart the ends are along X, Y and Z, in metres. */
  delta?: [number, number, number];
}

/** An end of a measurement, kept in its object's own space so it moves with the object. */
interface End {
  object: Object3D;
  local: Vector3;
}

/**
 * Distances between points on the model, as many as are measured: dots at the ends, a line
 * between each two, solid where it can be seen and faint where the model hides it, and each
 * length over its line's middle.
 */
export class Ruler {
  readonly group = new Group();
  /** Every measurement's ends, two by two; the last one may have only its first. */
  private readonly ends: End[] = [];
  /** Where the ends are, which the dots and the lines both draw, each as far as it should. */
  private positions = new BufferAttribute(new Float32Array(FIRST_ENDS * 3), 3);
  private pointGeometry = new BufferGeometry();
  private lineGeometry = new BufferGeometry();
  private readonly front = new LineBasicMaterial({ toneMapped: false });
  private readonly behind = new LineBasicMaterial({
    toneMapped: false,
    transparent: true,
    opacity: 0.35,
    depthTest: false,
    depthWrite: false,
  });
  private readonly dots: PointsMaterial;
  private readonly lines: LineSegments[];
  private readonly points: Points;
  /** A ring around the point a click would snap to. */
  private readonly ring: Points;
  /** Each whole measurement's length, over its line. */
  private readonly labels: HTMLElement[] = [];

  constructor(private readonly container: HTMLElement) {
    this.group.name = 'Nightmesh ruler';
    this.pointGeometry.setAttribute('position', this.positions);
    this.lineGeometry.setAttribute('position', this.positions);
    this.dots = new PointsMaterial({
      size: DOT_SIZE * window.devicePixelRatio,
      sizeAttenuation: false,
      map: circle(false),
      alphaTest: 0.5,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.lines = [
      new LineSegments(this.lineGeometry, this.behind),
      new LineSegments(this.lineGeometry, this.front),
    ];
    this.points = new Points(this.pointGeometry, this.dots);
    const ringGeometry = new BufferGeometry();
    ringGeometry.setAttribute('position', new BufferAttribute(new Float32Array(3), 3));
    this.ring = new Points(
      ringGeometry,
      new PointsMaterial({
        size: RING_SIZE * window.devicePixelRatio,
        sizeAttenuation: false,
        map: circle(true),
        alphaTest: 0.5,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.ring.visible = false;
    // Over the model, the dots over the lines, the ring over them all.
    [...this.lines, this.points, this.ring].forEach((object, index) => {
      object.frustumCulled = false;
      object.renderOrder = 1000 + index;
      this.group.add(object);
    });
    this.show();
  }

  /** The theme's focus color, as sRGB channels from 0 to 1. */
  setColor([r, g, b]: readonly [number, number, number]): void {
    for (const material of [
      this.front,
      this.behind,
      this.dots,
      this.ring.material as PointsMaterial,
    ])
      material.color.setRGB(r, g, b, SRGBColorSpace);
  }

  /** Rings the point a click would snap to; undefined takes the ring away. */
  setSnap(point: Vector3 | undefined): boolean {
    const was = this.ring.visible
      ? new Vector3().fromBufferAttribute(this.ring.geometry.attributes.position, 0)
      : undefined;
    if (point === was || (point && was?.equals(point))) return false;
    this.ring.visible = point !== undefined;
    if (point) {
      const position = this.ring.geometry.attributes.position as BufferAttribute;
      position.setXYZ(0, point.x, point.y, point.z);
      position.needsUpdate = true;
    }
    return true;
  }

  /**
   * Places an end where `point` is on `object`: the second end of the last measurement, or the
   * first of a new one, the ones before kept.
   */
  add(point: Vector3, object: Object3D): void {
    object.updateWorldMatrix(true, false);
    this.ends.push({ object, local: object.worldToLocal(point.clone()) });
    this.show();
  }

  /** Takes away the last measurement, or the end of one placed; whether there was one. */
  removeLast(): boolean {
    if (this.ends.length === 0) return false;
    this.ends.length -= this.ends.length % 2 === 1 ? 1 : 2;
    this.show();
    return true;
  }

  clear(): void {
    this.ends.length = 0;
    this.ring.visible = false;
    this.show();
  }

  /**
   * Puts the dots and the lines where the ends are now and each length over its line's middle,
   * as `camera` sees it; `lengthText` writes a length given in metres. Returns the last
   * measurement as far as it has come.
   */
  update(
    camera: PerspectiveCamera | OrthographicCamera,
    lengthText: (metres: number) => string,
  ): Measurement {
    const points = this.ends.map(({ object, local }) => object.localToWorld(local.clone()));
    const positions = this.positions;
    points.forEach((point, index) => positions.setXYZ(index, point.x, point.y, point.z));
    positions.needsUpdate = true;
    camera.updateMatrixWorld();
    let last: Measurement = { ends: 0 };
    this.labels.forEach((label, index) => {
      const a = points[index * 2];
      const b = points[index * 2 + 1];
      const length = a.distanceTo(b);
      const middle = a.clone().add(b).multiplyScalar(0.5).project(camera);
      // Behind the camera, or past the edges, it isn't shown.
      label.hidden =
        middle.z < -1 || middle.z > 1 || Math.abs(middle.x) > 1 || Math.abs(middle.y) > 1;
      label.textContent = lengthText(length);
      label.style.left = `${((middle.x + 1) / 2) * 100}%`;
      label.style.top = `${((1 - middle.y) / 2) * 100}%`;
      last = {
        ends: 2,
        length,
        delta: [Math.abs(b.x - a.x), Math.abs(b.y - a.y), Math.abs(b.z - a.z)],
      };
    });
    return points.length % 2 === 1 ? { ends: 1 } : last;
  }

  dispose(): void {
    this.pointGeometry.dispose();
    this.lineGeometry.dispose();
    this.ring.geometry.dispose();
    const ring = this.ring.material as PointsMaterial;
    for (const material of [this.front, this.behind, this.dots, ring]) {
      material.map?.dispose();
      material.dispose();
    }
    for (const label of this.labels) label.remove();
  }

  /** Draws as many dots, lines and lengths as there are ends and whole measurements. */
  private show(): void {
    const ends = this.ends.length;
    const capacity = this.positions.count;
    if (ends > capacity) {
      // The buffer drawn has a fixed size: a larger one takes its place.
      this.pointGeometry.dispose();
      this.lineGeometry.dispose();
      this.positions = new BufferAttribute(new Float32Array(capacity * 2 * 3), 3);
      this.pointGeometry = new BufferGeometry();
      this.lineGeometry = new BufferGeometry();
      this.pointGeometry.setAttribute('position', this.positions);
      this.lineGeometry.setAttribute('position', this.positions);
      this.points.geometry = this.pointGeometry;
      for (const line of this.lines) line.geometry = this.lineGeometry;
    }
    const whole = ends >> 1;
    this.points.visible = ends > 0;
    this.pointGeometry.setDrawRange(0, ends);
    for (const line of this.lines) line.visible = whole > 0;
    // Lines draw two ends each: the last end alone draws none.
    this.lineGeometry.setDrawRange(0, whole * 2);
    while (this.labels.length > whole) this.labels.pop()!.remove();
    while (this.labels.length < whole) {
      const label = document.createElement('div');
      label.className = 'nm-ruler-label';
      // The corner of the view says the last one, for screen readers too.
      label.setAttribute('aria-hidden', 'true');
      label.hidden = true;
      this.container.append(label);
      this.labels.push(label);
    }
  }
}

/** A white disc, or a ring, for the points' color to tint. */
function circle(ring: boolean): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d')!;
  context.beginPath();
  if (ring) {
    context.strokeStyle = '#ffffff';
    context.lineWidth = 8;
    context.arc(32, 32, 27, 0, Math.PI * 2);
    context.stroke();
  } else {
    context.fillStyle = '#ffffff';
    context.arc(32, 32, 30, 0, Math.PI * 2);
    context.fill();
  }
  return new CanvasTexture(canvas);
}
