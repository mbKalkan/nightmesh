import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  SRGBColorSpace,
  Vector3,
  type Box3,
} from 'three';

/** Colors for the helpers, as sRGB channels from 0 to 1. */
export interface HelperColors {
  grid: readonly [number, number, number];
  x: readonly [number, number, number];
  y: readonly [number, number, number];
  z: readonly [number, number, number];
}

/** How strongly grid lines show at the middle; they fade out toward the edge. */
const GRID_OPACITY = 0.28;
/** The negative half of each axis is drawn this much fainter than the positive one. */
const NEGATIVE_AXIS = 0.35;
/** The bounding box, where the model doesn't hide it and, fainter, where it does. */
const BOUNDS_OPACITY = 0.8;
const BOUNDS_BEHIND_OPACITY = 0.25;
/** The grid reaches this far beyond the model, in model extents, and at least this many cells. */
const GRID_REACH = 1.5;
const GRID_MIN_CELLS = 5;

/**
 * The size of a grid cell for a model this wide on the ground, in the same unit: a power of ten,
 * so the model is 2 to 20 cells across.
 */
export function gridCell(extent: number): number {
  return extent > 0 && Number.isFinite(extent) ? 10 ** Math.floor(Math.log10(extent / 2)) : 1;
}

/**
 * Drawn around the model to read it by: a ground grid under it, in cells of a power of ten metres
 * (or of the file's own unit), the world's axes through the origin, and its bounding box. None is
 * picked, framed or measured.
 */
export class Helpers {
  readonly group = new Group();
  /** The grid's cell size in metres, once fitted to a model. */
  cell: number | undefined;
  /** The unit the cells are a power of ten of, in metres. */
  private unit = 1;
  private readonly grid = new LineSegments(
    new BufferGeometry(),
    new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }),
  );
  private readonly axes = new LineSegments(
    new BufferGeometry(),
    new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }),
  );
  private colors: HelperColors = {
    grid: [0.5, 0.5, 0.5],
    x: [0.95, 0.3, 0.3],
    y: [0.54, 0.82, 0.52],
    z: [0.22, 0.58, 1],
  };
  private box: Box3 | undefined;
  private readonly bounds = new Group();
  private readonly boundsGeometry = new BufferGeometry();
  private readonly boundsFront = new LineBasicMaterial({
    transparent: true,
    opacity: BOUNDS_OPACITY,
    depthWrite: false,
  });
  private readonly boundsBehind = new LineBasicMaterial({
    transparent: true,
    opacity: BOUNDS_BEHIND_OPACITY,
    depthTest: false,
    depthWrite: false,
  });

  constructor() {
    this.grid.name = 'Nightmesh grid';
    this.axes.name = 'Nightmesh axes';
    this.bounds.name = 'Nightmesh bounds';
    this.axes.visible = false;
    this.bounds.visible = false;
    this.bounds.add(
      new LineSegments(this.boundsGeometry, this.boundsFront),
      new LineSegments(this.boundsGeometry, this.boundsBehind),
    );
    this.group.add(this.grid, this.axes, this.bounds);
    this.setColors(this.colors);
  }

  get gridShown(): boolean {
    return this.grid.visible;
  }

  set gridShown(shown: boolean) {
    this.grid.visible = shown;
  }

  get axesShown(): boolean {
    return this.axes.visible;
  }

  set axesShown(shown: boolean) {
    this.axes.visible = shown;
  }

  get boundsShown(): boolean {
    return this.bounds.visible;
  }

  set boundsShown(shown: boolean) {
    this.bounds.visible = shown;
  }

  setColors(colors: HelperColors): void {
    this.colors = colors;
    const [r, g, b] = colors.grid;
    for (const material of [this.boundsFront, this.boundsBehind]) {
      material.color.setRGB(r, g, b, SRGBColorSpace);
    }
    if (this.box) this.fit(this.box);
  }

  /** Draws the bounding box around `box`: the model's, as it is posed now. */
  setBounds(box: Box3): void {
    const { min, max } = box;
    if (box.isEmpty()) {
      this.boundsGeometry.setAttribute('position', new Float32BufferAttribute([], 3));
      return;
    }
    const corner = (i: number) => [
      i & 1 ? max.x : min.x,
      i & 2 ? max.y : min.y,
      i & 4 ? max.z : min.z,
    ];
    const positions: number[] = [];
    // The twelve edges join corners that differ along one axis.
    for (let i = 0; i < 8; i++) {
      for (const axis of [1, 2, 4])
        if (!(i & axis)) positions.push(...corner(i), ...corner(i | axis));
    }
    this.boundsGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.boundsGeometry.computeBoundingSphere();
  }

  /**
   * Makes the cells a power of ten of `unit` metres: the unit of an OBJ, STL or PLY file, so a
   * model in inches lies on a grid of inches.
   */
  setUnit(unit: number): void {
    this.unit = unit;
    if (this.box) this.fit(this.box);
  }

  /** Lays the grid under `box`, centered below it, and sizes the axes to it. */
  fit(box: Box3): void {
    this.box = box.clone();
    const size = box.getSize(new Vector3());
    const extent = Math.max(size.x, size.z) || size.y || 1;
    const cell = gridCell(extent / this.unit) * this.unit;
    this.cell = cell;
    const cells = Math.max(GRID_MIN_CELLS, Math.ceil((extent * GRID_REACH) / cell));
    const half = cells * cell;
    const center = box.getCenter(new Vector3());
    // On world multiples of the cell, so the lines are where the metres are.
    const cx = Math.round(center.x / cell) * cell;
    const cz = Math.round(center.z / cell) * cell;
    // A hair below the model, so a flat bottom doesn't fight the lines for depth.
    const y = box.min.y - extent * 5e-4;

    const positions: number[] = [];
    const alphas: number[] = [];
    const fade = (x: number, z: number) =>
      Math.max(0, 1 - Math.hypot(x - cx, z - cz) ** 2 / half ** 2);
    const segment = (x0: number, z0: number, x1: number, z1: number) => {
      positions.push(x0, y, z0, x1, y, z1);
      alphas.push(fade(x0, z0), fade(x1, z1));
    };
    for (let line = -cells; line <= cells; line++) {
      for (let step = -cells; step < cells; step++) {
        const along = [step * cell, (step + 1) * cell];
        segment(cx + along[0], cz + line * cell, cx + along[1], cz + line * cell);
        segment(cx + line * cell, cz + along[0], cx + line * cell, cz + along[1]);
      }
    }
    setLines(
      this.grid,
      positions,
      alphas.map((alpha) => [...this.colors.grid, alpha * GRID_OPACITY]),
    );

    const length = Math.max(half, extent);
    const axisPositions: number[] = [];
    const axisColors: number[][] = [];
    (['x', 'y', 'z'] as const).forEach((axis, index) => {
      const end = [0, 0, 0];
      end[index] = length;
      axisPositions.push(0, 0, 0, ...end, 0, 0, 0, ...end.map((value) => -value));
      const color = this.colors[axis];
      axisColors.push(
        [...color, 1],
        [...color, 1],
        [...color, NEGATIVE_AXIS],
        [...color, NEGATIVE_AXIS],
      );
    });
    setLines(this.axes, axisPositions, axisColors);
  }

  dispose(): void {
    for (const lines of [this.grid, this.axes]) {
      lines.geometry.dispose();
      (lines.material as LineBasicMaterial).dispose();
    }
    this.boundsGeometry.dispose();
    this.boundsFront.dispose();
    this.boundsBehind.dispose();
  }
}

/** Gives `lines` new vertices, each with its color and opacity in sRGB. */
function setLines(lines: LineSegments, positions: number[], colors: number[][]): void {
  const linear = new Color();
  const values = colors.flatMap(([r, g, b, a]) => {
    linear.setRGB(r, g, b, SRGBColorSpace);
    return [linear.r, linear.g, linear.b, a];
  });
  lines.geometry.dispose();
  lines.geometry = new BufferGeometry();
  lines.geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  lines.geometry.setAttribute('color', new Float32BufferAttribute(values, 4));
}
