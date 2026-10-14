import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { viewerStrings, type Translate } from '../../src/extension/texts';
import { composeReference } from '../../src/shared/reference';
import type { InspectContext } from '../../src/webview/structure/details';
import { Formatter } from '../../src/webview/structure/format';
import { GltfModel } from '../../src/webview/structure/gltf';
import { referenceOf } from '../../src/webview/structure/reference';

const fill = (message: string, args: Array<string | number>) =>
  message.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)]));
const english: Translate = (message, ...args) => fill(message, args);
const turkishBundle = JSON.parse(readFileSync('l10n/bundle.l10n.tr.json', 'utf8')) as Record<
  string,
  string
>;
const turkish: Translate = (message, ...args) => fill(turkishBundle[message] ?? message, args);

function context(json: unknown, translate = english, locale = 'en'): InspectContext {
  return {
    model: new GltfModel(json),
    strings: viewerStrings(translate).structure,
    format: new Formatter(locale),
    file: { name: 'scene.glb', size: 1234, container: 'glb' },
  };
}

/** The glTF JSON of scene.glb: Root holds Box, Sphere, Group (Small Box, Points) and more. */
function scene(): unknown {
  const bytes = readFileSync(join('test/fixtures', 'scene.glb'));
  return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
}

const location = (json: unknown, key: string) =>
  referenceOf(context(json), key, 'en', false)?.location;

describe('composeReference', () => {
  it('puts the file first, then the place, then the details', () => {
    expect(composeReference('models/robot.glb')).toBe('models/robot.glb');
    expect(composeReference('models/robot.glb', 'node "Arm" (nodes[12])')).toBe(
      'models/robot.glb, node "Arm" (nodes[12])',
    );
    expect(composeReference('robot.glb', 'mesh "Arm" (meshes[3])', 'Mesh\n- primitives: 2')).toBe(
      'robot.glb, mesh "Arm" (meshes[3]):\nMesh\n- primitives: 2',
    );
  });
});

describe('referenceOf', () => {
  it('names an entry by kind and name, and where the JSON has it', () => {
    const json = scene();
    expect(location(json, 'mesh:1')).toBe('mesh "Sphere" (meshes[1])');
    expect(location(json, 'material:0')).toBe('material "Clay" (materials[0])');
    expect(location(json, 'scene:1')).toBe('scene "Sphere Only" (scenes[1])');
    expect(location(json, 'light:2')).toBe(
      'light "Spot" (extensions.KHR_lights_punctual.lights[2])',
    );
    expect(location(json, 'group:meshes')).toBe('meshes');
  });

  it('says which nodes a node is under', () => {
    const json = scene();
    expect(location(json, 'node:0')).toBe('node "Root" (nodes[0])');
    expect(location(json, 'node:4')).toBe('node "Small Box" (nodes[4]), under Root › Group');
  });

  it('refers to the model by its file alone, and to nothing it lacks', () => {
    const json = scene();
    expect(referenceOf(context(json), 'model', 'en', false)).toEqual({});
    expect(referenceOf(context(json), 'node:99', 'en', false)).toBeUndefined();
    expect(referenceOf(context(json), 'group:nowhere', 'en', false)).toBeUndefined();
  });

  it('names unnamed things by index, quotes names safely, and shortens deep hierarchies', () => {
    const nodes = Array.from({ length: 12 }, (_, i) => ({
      name: `N${i}`,
      children: i < 11 ? [i + 1] : undefined,
    }));
    const json = {
      asset: { version: '2.0' },
      nodes: [...nodes, { name: 'say "hi"' }, {}],
      meshes: [{ primitives: [] }],
    };
    expect(location(json, 'mesh:0')).toBe('mesh 0 (meshes[0])');
    expect(location(json, 'node:13')).toBe('node 13 (nodes[13])');
    expect(location(json, 'node:12')).toBe('node "say \\"hi\\"" (nodes[12])');
    expect(location(json, 'node:11')).toBe(
      'node "N11" (nodes[11]), under N0 › … › N5 › N6 › N7 › N8 › N9 › N10',
    );
  });

  it('adds what the inspector says, section by section', () => {
    const reference = referenceOf(context(scene()), 'node:4', 'en', true);
    const lines = reference?.details?.split('\n') ?? [];
    expect(lines).toContain('Transform');
    expect(lines).toContain('- translation: [0, 0.25, 0]');
    // Links name what they point at, and where it is, for tools to follow.
    expect(lines).toContain('- parent: Group (nodes[3])');
    expect(lines).toContain('- mesh: Box (meshes[0])');
    expect(lines.filter((line) => !line.startsWith('- ')).length).toBeGreaterThan(1);
    expect(lines.every((line) => line.trim() === line && line !== '')).toBe(true);
  });

  it('speaks the language of the editor', () => {
    expect(referenceOf(context(scene(), turkish, 'tr'), 'node:4', 'tr', false)?.location).toBe(
      'düğüm "Small Box" (nodes[4]), Root › Group altında',
    );
    expect(referenceOf(context(scene(), turkish, 'tr'), 'light:0', 'tr', false)?.location).toBe(
      'ışık "Sun" (extensions.KHR_lights_punctual.lights[0])',
    );
  });
});
