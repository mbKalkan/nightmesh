import type { StandardView } from '../shared/protocol';

const SVG = 'http://www.w3.org/2000/svg';
/** How far from the center an axis reaches, in the gizmo's units; it is 88 across. */
const REACH = 30;

/** The ends of the three axes: the positive ones labelled and joined to the center. */
const ENDS: { view: StandardView; axis: 'x' | 'y' | 'z'; vector: [number, number, number] }[] = [
  { view: 'right', axis: 'x', vector: [1, 0, 0] },
  { view: 'left', axis: 'x', vector: [-1, 0, 0] },
  { view: 'top', axis: 'y', vector: [0, 1, 0] },
  { view: 'bottom', axis: 'y', vector: [0, -1, 0] },
  { view: 'front', axis: 'z', vector: [0, 0, 1] },
  { view: 'back', axis: 'z', vector: [0, 0, -1] },
];

interface End {
  view: StandardView;
  vector: [number, number, number];
  group: SVGGElement;
  circle: SVGCircleElement;
  label?: SVGTextElement;
  line?: SVGLineElement;
}

/**
 * The world's axes as the camera sees them, in a corner of the view, as in Blender: X red, Y
 * green, Z blue. Clicking an end looks from it. For the pointer only; the View menu and the
 * number keys do the same from the keyboard.
 */
export class Gizmo {
  readonly element: SVGSVGElement;
  private readonly ends: End[];

  constructor(titles: Record<StandardView, string>, look: (view: StandardView) => void) {
    this.element = document.createElementNS(SVG, 'svg');
    this.element.classList.add('nm-gizmo');
    this.element.setAttribute('viewBox', '-44 -44 88 88');
    this.element.setAttribute('aria-hidden', 'true');
    this.element.setAttribute('hidden', '');
    this.ends = ENDS.map(({ view, axis, vector }) => {
      const positive = vector[0] + vector[1] + vector[2] > 0;
      const group = document.createElementNS(SVG, 'g');
      group.classList.add('nm-gizmo-end', `nm-gizmo-${axis}`);
      group.classList.add(positive ? 'nm-gizmo-positive' : 'nm-gizmo-negative');
      group.dataset.view = view;
      const title = document.createElementNS(SVG, 'title');
      title.textContent = titles[view];
      const end: End = { view, vector, group, circle: document.createElementNS(SVG, 'circle') };
      if (positive) {
        end.line = document.createElementNS(SVG, 'line');
        group.append(end.line);
      }
      end.circle.setAttribute('r', positive ? '8' : '6');
      group.append(title, end.circle);
      if (positive) {
        end.label = document.createElementNS(SVG, 'text');
        end.label.textContent = axis.toUpperCase();
        group.append(end.label);
      }
      return end;
    });
    this.element.addEventListener('click', (event) => {
      const view = (event.target as Element).closest<SVGGElement>('[data-view]')?.dataset.view;
      if (view) look(view as StandardView);
    });
  }

  /** Turns the axes as the camera is turned: `rotation` is its quaternion, x, y, z and w. */
  update(rotation: readonly [number, number, number, number]): void {
    this.element.removeAttribute('hidden');
    const [x, y, z, w] = rotation;
    // Into the camera's frame: by the inverse rotation, the quaternion with its axis negated.
    const placed = this.ends.map((end) => ({ end, at: rotate(end.vector, [-x, -y, -z, w]) }));
    // The ends nearest the viewer are drawn last, over the others.
    placed.sort((a, b) => a.at[2] - b.at[2]);
    for (const { end, at } of placed) {
      const cx = (at[0] * REACH).toFixed(2);
      const cy = (-at[1] * REACH).toFixed(2);
      end.circle.setAttribute('cx', cx);
      end.circle.setAttribute('cy', cy);
      end.label?.setAttribute('x', cx);
      end.label?.setAttribute('y', cy);
      end.line?.setAttribute('x2', cx);
      end.line?.setAttribute('y2', cy);
      this.element.append(end.group);
    }
  }
}

/** `vector` turned by the unit quaternion `q`. */
function rotate(
  [vx, vy, vz]: readonly number[],
  [qx, qy, qz, qw]: readonly number[],
): [number, number, number] {
  // t = 2 (q × v); v' = v + w t + q × t
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}
