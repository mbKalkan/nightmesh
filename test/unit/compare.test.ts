import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compare } from '../../src/webview/structure/compare';
import { GltfModel } from '../../src/webview/structure/gltf';
import { summarize } from '../../src/webview/structure/summary';

/** A car: a body and two wheels sharing a mesh, in red paint and rubber. */
function car() {
  return {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'Car', children: [1, 2, 3] },
      { name: 'Body', mesh: 0 },
      { name: 'Wheel', mesh: 1, translation: [-1, 0, 0] },
      { name: 'Wheel', mesh: 1, translation: [1, 0, 0] },
    ] as Record<string, unknown>[],
    meshes: [
      { name: 'Body', primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] },
      { name: 'Wheel', primitives: [{ attributes: { POSITION: 2 }, indices: 3, material: 1 }] },
    ] as Record<string, unknown>[],
    accessors: [
      { count: 8, componentType: 5126, type: 'VEC3', min: [-1, 0, -2], max: [1, 1, 2] },
      { count: 36, componentType: 5123, type: 'SCALAR' },
      {
        count: 24,
        componentType: 5126,
        type: 'VEC3',
        min: [-0.3, -0.3, -0.1],
        max: [0.3, 0.3, 0.1],
      },
      { count: 60, componentType: 5123, type: 'SCALAR' },
    ] as Record<string, unknown>[],
    materials: [
      { name: 'Paint', pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } },
      { name: 'Rubber', pbrMetallicRoughness: { roughnessFactor: 0.9 } },
    ] as Record<string, unknown>[],
  };
}

const summaryOf = (json: object, fileSize = 1000) => summarize(new GltfModel(json), { fileSize });

/** A fixture's summary, from the JSON chunk of a .glb. */
function fixtureSummary(name: string) {
  const path = join('test/fixtures', name);
  const bytes = readFileSync(path);
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
  return summaryOf(json as object, statSync(path).size);
}

describe('comparing two versions of a model', () => {
  it('finds nothing when nothing changed, whatever the order of the JSON', () => {
    const json = car();
    const shuffled = car();
    shuffled.materials[0] = {
      pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] },
      name: 'Paint',
    };
    const { changes, totals } = compare(summaryOf(json), summaryOf(shuffled));
    expect(changes).toEqual([]);
    expect(totals.filter((total) => total.changed)).toEqual([]);
  });

  it('matches by name, and says what was added, removed and changed', () => {
    const modified = car();
    // The body moves, the second wheel goes, a spoiler comes, the paint turns blue and the wheel
    // gets bigger.
    modified.nodes[1].translation = [0, 0.1, 0];
    modified.nodes[0].children = [1, 2, 3];
    modified.nodes[3] = { name: 'Spoiler', mesh: 2 };
    modified.meshes.push({ name: 'Spoiler', primitives: [{ attributes: { POSITION: 0 } }] });
    (modified.materials[0].pbrMetallicRoughness as Record<string, unknown>).baseColorFactor = [
      0, 0, 1, 1,
    ];
    modified.accessors[2] = { ...modified.accessors[2], max: [0.4, 0.4, 0.1] };

    const { changes, totals } = compare(summaryOf(car()), summaryOf(modified, 1200));
    const brief = changes.map(({ collection, key, kind, facets }) =>
      [collection, key, kind, facets.join(',')].join(' '),
    );
    expect(brief).toEqual([
      'nodes Car/Body changed transform',
      // The wheel left didn't change itself; its mesh did.
      'nodes Car/Wheel changed geometry',
      // What was removed shows where it was.
      'nodes Car/Wheel (2) removed ',
      'nodes Car/Spoiler added ',
      'meshes Wheel changed bounds',
      'meshes Spoiler added ',
      'materials Paint changed pbrMetallicRoughness',
    ]);
    // Where each is on its side, to select it there.
    expect([changes[2].original, changes[2].modified]).toEqual([3, undefined]);
    expect([changes[3].original, changes[3].modified]).toEqual([undefined, 3]);
    expect(totals.find((total) => total.name === 'fileSize')).toMatchObject({
      original: 1000,
      modified: 1200,
      changed: true,
    });
    expect(totals.find((total) => total.name === 'nodes')?.changed).toBe(false);
  });

  it('tells nodes of the same name apart by their order, and textures by their image', () => {
    const json = {
      ...car(),
      textures: [{ source: 0 }],
      images: [{ uri: 'textures/paint.png' }],
    };
    const summary = summaryOf(json);
    expect(summary.nodes.map((node) => node.key)).toEqual([
      'Car',
      'Car/Body',
      'Car/Wheel',
      'Car/Wheel (2)',
    ]);
    expect(summary.textures[0].key).toBe('paint.png');
  });

  it('finds what changed between the two versions of the scene fixture', () => {
    const { changes, totals } = compare(
      fixtureSummary('scene.glb'),
      fixtureSummary('scene-edited.glb'),
    );
    expect(
      changes.map(({ collection, key, kind, facets }) =>
        [collection, key, kind, facets.join(',')].join(' ').trim(),
      ),
    ).toEqual([
      'nodes Root/Box changed transform',
      'nodes Root/Group/Points removed',
      'nodes Root/Group/Tall Box added',
      'meshes Cloud removed',
      'materials Clay changed pbrMetallicRoughness',
    ]);
    expect(totals.filter((total) => total.changed).map((total) => total.name)).toEqual([
      'fileSize',
      'vertices',
      'triangles',
      'dimensions',
    ]);
  });
});
