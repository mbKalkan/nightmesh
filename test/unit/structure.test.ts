import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { viewerStrings, type Translate } from '../../src/extension/texts';
import { inspect, type Inspection, type Row } from '../../src/webview/structure/details';
import { Formatter } from '../../src/webview/structure/format';
import { GltfModel } from '../../src/webview/structure/gltf';
import { statistics } from '../../src/webview/structure/statistics';
import {
  ancestors,
  initiallyExpanded,
  outline,
  type OutlineEntry,
} from '../../src/webview/structure/outline';

const english: Translate = (message, ...args) =>
  message.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)]));
const strings = viewerStrings(english).structure;

/** A fixture's glTF JSON, from a .gltf or the JSON chunk of a .glb. */
function fixture(name: string): unknown {
  const bytes = readFileSync(join('test/fixtures', name));
  const text = name.endsWith('.glb')
    ? bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')
    : bytes.toString('utf8');
  return JSON.parse(text);
}

const labels = (entries: OutlineEntry[]) => entries.map((entry) => entry.label);
const childrenOf = (entries: OutlineEntry[], key: string) =>
  entries.find((entry) => entry.key === key)?.children?.() ?? [];

function inspectFixture(name: string, key: string, json = fixture(name)): Inspection | undefined {
  return inspect(
    {
      model: new GltfModel(json),
      strings,
      format: new Formatter('en'),
      file: { name, size: 1234, container: name.endsWith('.glb') ? 'glb' : 'gltf' },
    },
    key,
  );
}

/** A section's rows as `label: value`, links by their text. */
function rows(inspection: Inspection | undefined, title: string): string[] {
  const section = inspection?.sections.find((candidate) => candidate.title === title);
  return (section?.rows ?? []).map((row: Row) =>
    [
      row.label,
      [
        row.links?.map((item) => item.text).join(', '),
        row.text,
        row.json,
        row.note && `(${row.note})`,
      ]
        .filter(Boolean)
        .join(' '),
    ]
      .filter(Boolean)
      .join(': '),
  );
}

describe('structure tree', () => {
  it('lists the model, its scenes with their nodes, and groups of what it holds', () => {
    const model = new GltfModel(fixture('scene.glb'));
    const entries = outline(model, strings);
    expect(labels(entries)).toEqual([
      'Model',
      'Main',
      'Sphere Only',
      'Meshes',
      'Materials',
      'Cameras',
      'Lights',
    ]);
    expect(entries.find((entry) => entry.key === 'group:meshes')?.count).toBe(4);
    const [root] = childrenOf(entries, 'scene:0');
    expect(root).toMatchObject({ key: 'node:0', label: 'Root', icon: 'node' });
    expect(labels(root.children!())).toEqual([
      'Box',
      'Sphere',
      'Group',
      'Axes',
      'Front Camera',
      'Top Camera',
      'Sun',
      'Lamp',
      'Spot',
    ]);
    expect(root.children!().map((entry) => entry.icon)).toEqual([
      'mesh',
      'mesh',
      'node',
      'mesh',
      'camera',
      'camera',
      'light',
      'light',
      'light',
    ]);
    expect(labels(childrenOf(entries, 'scene:1'))).toEqual(['Lonely Sphere']);
  });

  it('finds the way down to any entry, and opens the scenes and single-child wrappers', () => {
    const model = new GltfModel(fixture('scene.glb'));
    expect(ancestors(model, 'node:4')).toEqual(['scene:0', 'node:0', 'node:3']);
    expect(ancestors(model, 'material:0')).toEqual(['group:materials']);
    expect(ancestors(model, 'scene:1')).toEqual([]);
    expect(initiallyExpanded(model)).toEqual(['scene:0', 'node:0', 'scene:1']);
  });

  it('names unnamed things by kind and index, and an unnamed node by its mesh', () => {
    const model = new GltfModel({
      asset: { version: '2.0' },
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ name: 'Wheel', primitives: [] }],
    });
    const [, scene] = outline(model, strings);
    expect(scene.label).toBe('Scene 0');
    expect(scene.children!()[0]).toMatchObject({ label: 'Node 0', description: 'Wheel' });
  });

  it('gives every node one place in a broken hierarchy, loops and all', () => {
    const model = new GltfModel({
      scenes: [{ nodes: [0, 0, 7, 'x'] }],
      // 1 is listed twice, 2 and 3 form a loop no scene reaches, 4 is a child of itself.
      nodes: [
        { children: [1, 1] },
        { children: [0] },
        { children: [3] },
        { children: [2] },
        { children: [4] },
      ],
    });
    const entries = outline(model, strings);
    expect(labels(entries)).toEqual(['Model', 'Scene 0', 'Nodes outside scenes']);
    const [root] = childrenOf(entries, 'scene:0');
    expect(root.key).toBe('node:0');
    expect(root.children!().map((entry) => entry.key)).toEqual(['node:1']);
    expect(root.children!()[0].children).toBeUndefined();
    expect(childrenOf(entries, 'group:otherNodes').map((entry) => entry.key)).toEqual([
      'node:2',
      'node:4',
    ]);
    expect(ancestors(model, 'node:3')).toEqual(['group:otherNodes', 'node:2']);
  });

  it('shows something for JSON that is not a glTF model at all', () => {
    for (const json of [null, 42, 'text', [], { scenes: 'no', nodes: [null, 3] }]) {
      const model = new GltfModel(json);
      expect(() => outline(model, strings)).not.toThrow();
      expect(outline(model, strings)[0].key).toBe('model');
      for (const key of ['model', 'node:0', 'node:1', 'scene:0', 'mesh:0']) {
        expect(() => inspectFixture('broken.glb', key, json)).not.toThrow();
      }
    }
  });
});

describe('inspector', () => {
  it('describes the model, its file and what it holds', () => {
    const model = inspectFixture('scene.glb', 'model');
    expect(model).toMatchObject({ title: 'scene.glb', kind: 'Model' });
    expect(rows(model, 'Model')).toEqual([
      'version: 2.0',
      'generator: Nightmesh fixture generator',
      'copyright: Public domain (CC0 1.0)',
      'scene: Main',
    ]);
    expect(rows(model, 'File')).toEqual(['Container: GLB', 'File size: 1.2 KB']);
    expect(rows(model, 'Contents')).toEqual([
      'Nodes: 13',
      'Meshes: 4',
      'Primitives: 4',
      'Materials: 1',
      'Cameras: 2',
      'Lights: 3',
    ]);
    expect(rows(model, 'Extensions')).toEqual(['KHR_lights_punctual']);
    expect(rows(inspectFixture('ktx2.glb', 'model'), 'Extensions')).toEqual([
      'KHR_texture_basisu (Required)',
    ]);
  });

  it("shows a node's transform, references and mesh", () => {
    const node = inspectFixture('scene.glb', 'node:2');
    expect(node).toMatchObject({ title: 'Sphere', kind: 'Node 2' });
    expect(rows(node, 'Node')).toEqual(['parent: Root', 'mesh: Sphere']);
    expect(rows(node, 'Transform')).toEqual([
      'translation: [0, 0.5, 0]',
      'rotation: [0, 0.382683, 0, 0.92388]',
      'Rotation (degrees): [0, 45, 0]',
      'scale: [1.2, 1.2, 1.2]',
    ]);
    expect(rows(node, 'Mesh')).toEqual([
      'mesh: Sphere',
      'Primitives: 1',
      expect.stringMatching(/^Vertices: [\d,]+$/),
      expect.stringMatching(/^Triangles: [\d,]+$/),
      'Materials: Clay',
    ]);
    expect(rows(inspectFixture('scene.glb', 'node:9'), 'Node')).toEqual([
      'parent: Root',
      'light: Sun',
    ]);
  });

  it('counts what a primitive draws, whatever its mode', () => {
    const mesh = inspectFixture('scene.glb', 'mesh:2');
    expect(rows(mesh, 'Primitive 0')).toEqual([
      'mode: LINES',
      'Vertices: 6',
      'Lines: 3',
      'POSITION: VEC3 · FLOAT',
      'min: [0, 0, 0]',
      'max: [1, 1, 1]',
      'Size: [1, 1, 1]',
      'COLOR_0: VEC3 · FLOAT',
    ]);
    expect(rows(mesh, 'Used by')).toEqual(['Nodes: Axes']);
    expect(rows(inspectFixture('scene.glb', 'mesh:0'), 'Used by')).toEqual([
      'Nodes: Box, Small Box',
    ]);
  });

  it('lists material values with defaults, extensions, texture links and users', () => {
    const material = inspectFixture('textured.gltf', 'material:0');
    expect(material?.title).toBe('Checker');
    expect(rows(material, 'Material')).toEqual(['alphaMode: OPAQUE', 'doubleSided: false']);
    expect(rows(material, 'pbrMetallicRoughness')).toEqual([
      'baseColorFactor: [1, 1, 1, 1]',
      'metallicFactor: 1',
      'roughnessFactor: 1',
      'baseColorTexture: checker',
    ]);
    const swatch = material?.sections[1].rows[0].swatch;
    expect(swatch).toBe('rgb(255 255 255 / 1)');
  });

  it('describes a texture: its image, sampler and where it is used', () => {
    const texture = inspectFixture('textured.gltf', 'texture:0');
    expect(rows(texture, 'Texture')).toEqual(['source: checker · checker.png · image/png']);
    expect(rows(texture, 'Sampler')).toEqual([
      'magFilter: —',
      'minFilter: —',
      'wrapS: REPEAT',
      'wrapT: REPEAT',
    ]);
    expect(rows(texture, 'Used by')).toEqual(['Checker (pbrMetallicRoughness.baseColorTexture)']);
    expect(rows(inspectFixture('ktx2.glb', 'texture:1'), 'Texture')).toEqual([
      expect.stringMatching(/^KHR_texture_basisu: UASTC · image\/ktx2 · \d+ B$/),
    ]);
  });

  it('times animations and lists what they move', () => {
    const animation = inspectFixture('animated.glb', 'animation:0');
    expect(rows(animation, 'Animation')[0]).toMatch(/^Duration: [\d.]+ s$/);
    expect(rows(animation, 'Channels').length).toBeGreaterThan(0);
  });

  it('shows cameras and lights with angles in degrees', () => {
    expect(rows(inspectFixture('scene.glb', 'camera:0'), 'Camera')).toEqual([
      'type: perspective',
      'znear: 0.1',
      'zfar: 100',
      'yfov: 0.8',
      'aspectRatio: 1.5',
      'yfov (°): 45.837°',
    ]);
    expect(rows(inspectFixture('scene.glb', 'light:2'), 'Light')).toEqual([
      'type: spot',
      'color: [1, 1, 1]',
      'intensity: 40',
      'spot: {\n  "innerConeAngle": 0.3,\n  "outerConeAngle": 0.6\n}',
      'innerConeAngle (°): 17.189°',
      'outerConeAngle (°): 34.377°',
    ]);
  });

  it('has nothing to show for entries the model does not have', () => {
    expect(inspectFixture('scene.glb', 'node:99')).toBeUndefined();
    expect(inspectFixture('scene.glb', 'group:meshes')).toBeUndefined();
  });
});

describe('statistics', () => {
  it('counts the scene shown, each mesh every time it is drawn', () => {
    const stats = statistics(new GltfModel(fixture('scene.glb')));
    expect(stats).toMatchObject({
      scene: 0,
      nodes: 12,
      instances: 5,
      drawCalls: 5,
      triangles: 984,
      lines: 3,
      points: 64,
      materials: 1,
      textures: 0,
    });
    expect(stats.meshes.find((row) => row.mesh === 0)).toMatchObject({
      instances: 2,
      triangles: 12,
    });
  });

  it('measures the scene in metres, through node transforms and quantized positions', () => {
    const size = (name: string) => {
      const { bounds } = statistics(new GltfModel(fixture(name)));
      return bounds!.max.map((value, axis) => Number((value - bounds!.min[axis]).toFixed(4)));
    };
    expect(size('dense.glb')).toEqual([1, 1, 1]);
    // Positions stored as normalized shorts, scaled back by the node.
    expect(size('quantized.glb')).toEqual([1, 1, 1]);
    const model = new GltfModel({
      scenes: [{ nodes: [0] }],
      nodes: [
        { children: [1], scale: [2, 2, 2] },
        { mesh: 0, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1] },
      ],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ count: 3, type: 'VEC3', componentType: 5126, min: [0, 0, 0], max: [1, 2, 3] }],
    });
    expect(statistics(model).bounds).toEqual({ min: [20, 0, 0], max: [22, 4, 6] });
  });

  it('counts GPU instances and draws them in one call per primitive', () => {
    const model = new GltfModel({
      scenes: [{ nodes: [0] }],
      nodes: [
        { mesh: 0, extensions: { EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: 1 } } } },
      ],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }, { attributes: { POSITION: 0 } }] }],
      accessors: [
        { count: 3, type: 'VEC3', componentType: 5126 },
        { count: 50, type: 'VEC3', componentType: 5126 },
      ],
    });
    expect(statistics(model)).toMatchObject({ instances: 50, drawCalls: 2, triangles: 100 });
  });

  it('has no bounds, and no trouble, for a model without geometry', () => {
    const stats = statistics(new GltfModel({ asset: { version: '2.0' } }));
    expect(stats).toMatchObject({ scene: undefined, nodes: 0, meshes: [] });
    expect(stats.bounds).toBeUndefined();
  });
});
