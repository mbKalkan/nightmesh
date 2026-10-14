import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshNormalMaterial,
  MeshStandardMaterial,
  Texture,
} from 'three';
import { describe, expect, it } from 'vitest';
import { Shading } from '../../src/webview/scene/shading';

function model() {
  const texture = new Texture();
  const clay = new MeshStandardMaterial({ color: new Color(0.8, 0.5, 0.2), map: texture });
  const glass = new MeshStandardMaterial({ transparent: true, opacity: 0.4, side: DoubleSide });
  const box: Mesh = new Mesh(new BoxGeometry(), clay);
  const panes: Mesh = new Mesh(new BoxGeometry(), [clay, glass]);
  // Not indexed, and its vertices leave memory once on the GPU: no wireframe for it.
  const soup = new BufferGeometry();
  soup.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  const triangle: Mesh = new Mesh(soup, clay);
  const root = new Group().add(box, panes, triangle);
  return { root, box, panes, triangle, clay, glass, texture };
}

describe('Shading', () => {
  it('draws unlit in the materials own colors, textures and transparency', () => {
    const { root, box, panes, clay, glass, texture } = model();
    const shading = new Shading();
    shading.attach(root);
    shading.setMode('unlit');
    const unlit = box.material as MeshBasicMaterial;
    expect(unlit).toBeInstanceOf(MeshBasicMaterial);
    expect(unlit.color.equals(clay.color)).toBe(true);
    expect(unlit.map).toBe(texture);
    const [first, second] = panes.material as MeshBasicMaterial[];
    expect(first).toBe(unlit);
    expect(second.transparent).toBe(true);
    expect(second.opacity).toBe(0.4);
    expect(second.side).toBe(DoubleSide);

    shading.setMode('lit');
    expect(box.material).toBe(clay);
    expect(panes.material).toEqual([clay, glass]);
  });

  it('colors by normals, both sides where the material has two', () => {
    const { root, box, panes } = model();
    const shading = new Shading();
    shading.attach(root);
    shading.setMode('normals');
    expect(box.material).toBeInstanceOf(MeshNormalMaterial);
    const [, glass] = panes.material as MeshNormalMaterial[];
    expect(glass.side).toBe(DoubleSide);
    expect(shading.current).toBe('normals');
  });

  it('draws a wireframe over meshes it can build one for, and puts everything back', () => {
    const { root, box, triangle, clay } = model();
    const shading = new Shading();
    shading.attach(root);
    expect(box.layers.isEnabled(1)).toBe(true);
    expect(triangle.layers.isEnabled(1)).toBe(false);

    shading.setWireframe(true);
    expect(shading.wireframe).toBe(true);
    // Pushed back in depth, so the lines over it aren't hidden by it.
    expect(clay.polygonOffset).toBe(true);
    shading.setMode('unlit');
    expect((box.material as MeshBasicMaterial).polygonOffset).toBe(true);

    shading.detach();
    expect(box.material).toBe(clay);
    expect(clay.polygonOffset).toBe(false);
  });
});
