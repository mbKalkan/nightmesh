import { describe, expect, it } from 'vitest';
import { Formatter, withoutNoise } from '../../src/webview/structure/format';
import { fileTransform, unitsFor, withUnits } from '../../src/webview/units';

/** glTF as the host makes it from a file: the file's node, and maybe a node moving it back. */
const gltf = (translation?: number[]) =>
  JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: translation
      ? [
          { name: 'scan.ply', children: [1] },
          { translation, mesh: 0 },
        ]
      : [{ name: 'part.stl', mesh: 0 }],
    meshes: [{ primitives: [] }],
  });

const nodes = (json: string) => (JSON.parse(json) as { nodes: Record<string, unknown>[] }).nodes;

describe('units of OBJ, STL and PLY files', () => {
  it('takes STL to be in millimetres with Z up, OBJ and PLY in metres with Y up', () => {
    expect(unitsFor('stl', gltf())).toEqual({ unit: 'mm', up: 'z' });
    expect(unitsFor('obj', gltf())).toEqual({ unit: 'm', up: 'y' });
    expect(unitsFor('ply', gltf())).toEqual({ unit: 'm', up: 'y' });
  });

  it('takes georeferenced coordinates to have Z up, as their height', () => {
    expect(unitsFor('ply', gltf([500002, 4100001, 100]))).toEqual({ unit: 'm', up: 'z' });
    expect(unitsFor('obj', gltf([500002, 4100001, 100]))).toEqual({ unit: 'm', up: 'z' });
  });

  it("scales and turns the file's node to metres with Y up", () => {
    const [file] = nodes(withUnits(gltf(), { unit: 'mm', up: 'z' }));
    expect(file.scale).toEqual([0.001, 0.001, 0.001]);
    expect(file.rotation).toEqual([-Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
    expect(nodes(withUnits(gltf(), { unit: 'm', up: 'y' }))[0]).toEqual({
      name: 'part.stl',
      mesh: 0,
    });
    expect(fileTransform({ unit: 'in', up: 'y' })).toEqual({
      scale: 0.0254,
      rotation: [0, 0, 0, 1],
    });
  });

  it('draws far-away geometry around the origin, and keeps its place for the panels', () => {
    const json = gltf([500002, 4100001, 100]);
    expect(nodes(withUnits(json, { unit: 'm', up: 'z' }))[1].translation).toEqual([
      500002, 4100001, 100,
    ]);
    expect(nodes(withUnits(json, { unit: 'm', up: 'z' }, true))[1]).toEqual({ mesh: 0 });
  });

  it('shows lengths, given in metres, in the unit set', () => {
    const format = new Formatter('en');
    expect(format.metres(0.04)).toBe('0.04 m');
    format.setLength('mm');
    expect(format.metres(0.04)).toBe('40 mm');
    expect(format.dimensions([0.04, 0.025, 0.02])).toBe('[40, 25, 20] mm');
    format.setLength('in');
    expect(format.metres(1.016)).toBe('40 in');
    format.setLength('ft');
    expect(format.metres(1)).toBe('3.281 ft');
  });

  it('shows a flat model turned upright as flat, not a hair thick', () => {
    expect(withoutNoise([0.002, 4.4e-19, 0.002])).toEqual([0.002, 0, 0.002]);
    expect(withoutNoise([0.002, 1e-6, 0.002])).toEqual([0.002, 1e-6, 0.002]);
    const format = new Formatter('en');
    format.setLength('mm');
    expect(format.dimensions([0.002, 4.4e-19, 0.002])).toBe('[2, 0, 2] mm');
  });
});
