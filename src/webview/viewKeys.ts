import type { Projection, StandardView } from '../shared/protocol';

/** What the keys move: the 3D view, once there is one. */
export interface Steerable {
  look(view: StandardView): void;
  lookOpposite(): void;
  readonly projection: Projection;
  setProjection(projection: Projection): void;
  orbit(left: number, up: number): void;
  zoom(factor: number): void;
  nextCamera(): void;
}

export const STANDARD_VIEWS: readonly StandardView[] = [
  'front',
  'back',
  'right',
  'left',
  'top',
  'bottom',
];

/**
 * The keys for each standard view, as on Blender's number pad: 1, 3 and 7 look from the front,
 * the right and the top, with Shift from the opposite side. Ctrl isn't used: VS Code keeps
 * Ctrl+1 and its kin for editor groups.
 */
export const SHORTCUTS: Readonly<Record<StandardView, string>> = {
  front: '1',
  back: 'Shift+1',
  right: '3',
  left: 'Shift+3',
  top: '7',
  bottom: 'Shift+7',
};

const DIGITS: Readonly<Record<string, readonly [StandardView, StandardView]>> = {
  1: ['front', 'back'],
  3: ['right', 'left'],
  7: ['top', 'bottom'],
};

/** An arrow key orbits this far, in radians. */
const ORBIT_STEP = Math.PI / 12;
/** + and - zoom by this factor. */
const ZOOM_STEP = 1.25;

/**
 * What a key does to the view, if anything. The number keys and + and - work wherever they
 * have no other job; the arrows only in the view, as elsewhere they move through lists.
 */
export function viewKey(
  event: KeyboardEvent,
  inView: boolean,
): ((view: Steerable) => void) | undefined {
  // By the key's place, not its character: Shift+1 is "!" on most layouts.
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(event.code)?.[1];
  const pair = digit && DIGITS[digit];
  if (pair) return (view) => view.look(pair[event.shiftKey ? 1 : 0]);
  if (digit === '9') return (view) => view.lookOpposite();
  // As Blender's 0, through the file's cameras, one after the other.
  if (digit === '0') return (view) => view.nextCamera();
  if (digit === '5') {
    return (view) =>
      view.setProjection(view.projection === 'perspective' ? 'orthographic' : 'perspective');
  }
  if (event.key === '+' || event.key === '=' || event.code === 'NumpadAdd') {
    return (view) => view.zoom(ZOOM_STEP);
  }
  if (event.key === '-' || event.code === 'NumpadSubtract') {
    return (view) => view.zoom(1 / ZOOM_STEP);
  }
  if (!inView || event.shiftKey) return undefined;
  // As dragging the model would: the arrow's way.
  switch (event.key) {
    case 'ArrowLeft':
      return (view) => view.orbit(-ORBIT_STEP, 0);
    case 'ArrowRight':
      return (view) => view.orbit(ORBIT_STEP, 0);
    case 'ArrowUp':
      return (view) => view.orbit(0, -ORBIT_STEP);
    case 'ArrowDown':
      return (view) => view.orbit(0, ORBIT_STEP);
    default:
      return undefined;
  }
}
