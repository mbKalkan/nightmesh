import { Box3, Vector3, type BufferAttribute, type LineSegments } from 'three';
import { describe, expect, it } from 'vitest';
import { Helpers, gridCell } from '../../src/webview/scene/helpers';

describe('gridCell', () => {
  it('picks a power of ten that puts the model 2 to 20 cells across', () => {
    expect(gridCell(4.1)).toBe(1);
    expect(gridCell(19)).toBe(1);
    expect(gridCell(21)).toBe(10);
    expect(gridCell(1.2)).toBeCloseTo(0.1, 10);
    expect(gridCell(296)).toBe(100);
    expect(gridCell(0)).toBe(1);
    expect(gridCell(Number.NaN)).toBe(1);
  });
});

describe('Helpers', () => {
  it('lays the grid just under the model, on world multiples of the cell, fading out', () => {
    const helpers = new Helpers();
    helpers.fit(new Box3(new Vector3(8.3, 0.5, -0.5), new Vector3(12.4, 2, 0.5)));
    expect(helpers.cell).toBe(1);
    const grid = helpers.group.getObjectByName('Nightmesh grid') as LineSegments;
    const position = grid.geometry.getAttribute('position') as BufferAttribute;
    const color = grid.geometry.getAttribute('color') as BufferAttribute;
    const ys = new Set<number>();
    for (let i = 0; i < position.count; i++) {
      ys.add(position.getY(i));
      // Every vertex is on a grid line: one of its coordinates is a whole number of metres.
      const onLine = [position.getX(i), position.getZ(i)].some(
        (value) => Math.abs(value - Math.round(value)) < 1e-9,
      );
      expect(onLine).toBe(true);
    }
    expect([...ys]).toHaveLength(1);
    const [y] = ys;
    expect(y).toBeLessThan(0.5);
    expect(y).toBeGreaterThan(0.49);
    const alphas = Array.from({ length: color.count }, (_, i) => color.getW(i));
    expect(Math.min(...alphas)).toBe(0);
    expect(Math.max(...alphas)).toBeGreaterThan(0.2);
    helpers.dispose();
  });

  it('draws the axes through the origin, and shows only what is asked for', () => {
    const helpers = new Helpers();
    expect(helpers.gridShown).toBe(true);
    expect(helpers.axesShown).toBe(false);
    helpers.fit(new Box3(new Vector3(-1, 0, -1), new Vector3(1, 2, 1)));
    const axes = helpers.group.getObjectByName('Nightmesh axes') as LineSegments;
    const position = axes.geometry.getAttribute('position') as BufferAttribute;
    expect(position.count).toBe(12);
    expect(position.getX(0)).toBe(0);
    expect(position.getX(1)).toBeGreaterThanOrEqual(2);
    helpers.axesShown = true;
    helpers.gridShown = false;
    expect(axes.visible).toBe(true);
    helpers.dispose();
  });
});
