import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateBytes } from 'gltf-validator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  saveTransformed,
  transformedBytes,
  transformedJson,
} from '../../src/extension/model/transformSave';
import type { Trs } from '../../src/shared/transforms';

const FIXTURES = 'test/fixtures';

const moved: Trs = { translation: [1, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
const turned: Trs = {
  translation: [0, 0, 0],
  rotation: [0, 0.707106781, 0, 0.707106781],
  scale: [2, 2, 2],
};

/** A GLB's JSON chunk, read as text, and what follows it. */
/** What the tests read of a glTF's JSON. */
interface Gltf {
  nodes: { children?: number[]; rotation?: number[]; scale?: number[] }[];
  scenes: { nodes: number[] }[];
}

function glbParts(data: Uint8Array): {
  json: Gltf;
  length: number;
  rest: Uint8Array;
} {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const length = view.getUint32(12, true);
  return {
    json: JSON.parse(new TextDecoder().decode(data.subarray(20, 20 + length))),
    length,
    rest: data.subarray(20 + length),
  };
}

describe('transformedJson', () => {
  const text = readFileSync(join(FIXTURES, 'triangle.gltf'), 'utf8');

  it('changes only the node, and keeps the layout of the rest', () => {
    const changed = transformedJson(text, new Map([[0, moved]]));
    const json = JSON.parse(changed);
    expect(json.nodes[0]).toEqual({ name: 'Triangle', mesh: 0, translation: [1, 2, 3] });
    // Everything before the nodes is as it was, to the byte.
    const before = text.indexOf('"nodes"');
    expect(changed.slice(0, before)).toBe(text.slice(0, before));
    // New lines laid out as the file's own: two spaces a level.
    expect(changed).toMatch(/\n {6}"translation": \[\n {8}1,/);
  });

  it("leaves glTF's defaults out, and takes out a value back at its default", () => {
    const back = transformedJson(
      transformedJson(text, new Map([[0, moved]])),
      new Map([[0, { ...moved, translation: [0, 0, 0] }]]),
    );
    expect(JSON.parse(back).nodes[0]).toEqual({ name: 'Triangle', mesh: 0 });
  });

  it('puts translation, rotation and scale in place of a matrix', () => {
    const json = JSON.stringify({
      scenes: [{ nodes: [0] }],
      nodes: [{ matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 5, 6, 1] }],
    });
    const node = JSON.parse(transformedJson(json, new Map([[0, turned]]))).nodes[0];
    expect(node).toEqual({ rotation: turned.rotation, scale: turned.scale });
  });

  it('adds a node above the top nodes to move the whole model', () => {
    const json = JSON.stringify({ scenes: [{ name: 'S', nodes: [0, 1] }], nodes: [{}, {}] });
    const changed = JSON.parse(transformedJson(json, new Map([[2, moved]])));
    expect(changed.nodes[2]).toEqual({ children: [0, 1], translation: [1, 2, 3] });
    expect(changed.scenes[0]).toEqual({ name: 'S', nodes: [2] });
  });

  it("doesn't add a node that would leave the model in place", () => {
    const json = JSON.stringify({ scenes: [{ nodes: [0, 1] }], nodes: [{}, {}] });
    const identity: Trs = { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
    expect(transformedJson(json, new Map([[2, identity]]))).toBe(json);
  });
});

describe('transformedBytes', () => {
  it("rewrites a GLB's JSON chunk and keeps its binary chunk as it was", () => {
    const data = readFileSync(join(FIXTURES, 'scene.glb'));
    const out = transformedBytes(data, new Map([[0, turned]]));
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    expect(view.getUint32(8, true)).toBe(out.byteLength);
    const { json, length, rest } = glbParts(out);
    expect(length % 4).toBe(0);
    expect(json.nodes[0].rotation).toEqual(turned.rotation);
    expect(json.nodes[0].scale).toEqual(turned.scale);
    expect(Buffer.from(rest).equals(glbParts(data).rest)).toBe(true);
  });

  it('keeps the GLB valid for the Khronos glTF Validator', async () => {
    const data = readFileSync(join(FIXTURES, 'animated.glb'));
    const target = glbParts(data).json.nodes.length;
    const out = transformedBytes(data, new Map([[target, moved]]));
    const report = await validateBytes(out);
    expect(report.issues.numErrors).toBe(0);
    const { json } = glbParts(out);
    expect(json.nodes[target].children).toEqual([0, 1, 2, 3, 5]);
    expect(json.scenes[0].nodes).toEqual([target]);
  });
});

describe('saveTransformed', () => {
  let folder: string;

  beforeAll(() => {
    folder = mkdtempSync(join(tmpdir(), 'nightmesh-save-'));
  });

  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  it('writes a GLB in place, as it would be in memory', async () => {
    const path = join(folder, 'scene.glb');
    copyFileSync(join(FIXTURES, 'scene.glb'), path);
    const transforms = new Map([[3, moved]]);
    const expected = transformedBytes(readFileSync(path), transforms);
    await saveTransformed(path, path, transforms);
    expect(Buffer.from(readFileSync(path)).equals(Buffer.from(expected))).toBe(true);
    expect(readdirSync(folder)).toEqual(['scene.glb']);
  });

  it('saves to another file, leaving the model as it was', async () => {
    const source = join(FIXTURES, 'triangle.gltf');
    const target = join(folder, 'copy.gltf');
    await saveTransformed(source, target, new Map([[0, moved]]));
    expect(JSON.parse(readFileSync(target, 'utf8')).nodes[0].translation).toEqual([1, 2, 3]);
    expect(JSON.parse(readFileSync(source, 'utf8')).nodes[0].translation).toBeUndefined();
  });

  it('keeps the byte order mark a .gltf file starts with', async () => {
    const path = join(folder, 'bom.gltf');
    writeFileSync(
      path,
      `${String.fromCharCode(0xfeff)}${JSON.stringify({ scenes: [{ nodes: [0] }], nodes: [{}] })}`,
    );
    await saveTransformed(path, path, new Map([[0, moved]]));
    const text = readFileSync(path, 'utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(JSON.parse(text.slice(1)).nodes[0].translation).toEqual([1, 2, 3]);
  });

  it("leaves a file it can't save as it was, with nothing left behind", async () => {
    const path = join(folder, 'broken.gltf');
    writeFileSync(path, '{ not json');
    await expect(saveTransformed(path, path, new Map([[0, moved]]))).rejects.toThrow();
    expect(readFileSync(path, 'utf8')).toBe('{ not json');
    expect(readdirSync(folder).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});
