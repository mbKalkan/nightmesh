import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileResourceOpener } from '../../src/extension/model/fileResources';
import { loadMessages } from '../../src/extension/model/load';
import { decodePoints } from '../../src/extension/model/mesh/draco';
import { threadParser } from '../../src/extension/model/mesh/parse';
import { fileSource, memorySource } from '../../src/extension/model/sources';
import { loadTexts, type Translate } from '../../src/extension/texts';
import { formatForPath } from '../../src/shared/formats';
import type { HostToWebviewMessage, StructureMessage } from '../../src/shared/protocol';

const FIXTURES = resolve('test/fixtures');
const english: Translate = (message, ...args) =>
  message.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)]));
const texts = loadTexts(english);

/**
 * Loads a fixture as the extension host does, with the fixtures folder as the workspace, reading
 * with the decoders the reading thread has.
 */
async function loadAll(name: string, largeBytes?: number): Promise<HostToWebviewMessage[]> {
  const source = await fileSource(join(FIXTURES, name));
  const opener = fileResourceOpener('/fixtures', '/fixtures', (path) =>
    join(FIXTURES, path.slice('/fixtures'.length)),
  );
  const messages: HostToWebviewMessage[] = [];
  try {
    const options = {
      loadId: 1,
      reload: false,
      texts,
      format: formatForPath(name),
      fileName: name,
      largeBytes,
      parseMesh: threadParser(decodePoints),
    };
    for await (const message of loadMessages(source, opener, options)) messages.push(message);
  } finally {
    await source.close();
  }
  return messages;
}

const types = (messages: HostToWebviewMessage[]) => messages.map((message) => message.type);

/** The last structure a load sent, with its glTF parsed. */
function structureOf(messages: HostToWebviewMessage[]) {
  const structure = messages.filter((message) => message.type === 'structure').at(-1) as
    StructureMessage | undefined;
  if (!structure) throw new Error('No structure');
  return { ...structure, gltf: JSON.parse(structure.json) };
}

const modelOf = (messages: HostToWebviewMessage[]) => {
  const model = messages.find((message) => message.type === 'model');
  if (model?.type !== 'model') throw new Error('No model');
  return model;
};

describe('loading OBJ, STL and PLY', () => {
  it('reads the file, then sends it as glTF: structure, images, model, parts, check', async () => {
    const messages = await loadAll('cube.obj');
    expect(types(messages).filter((type) => type !== 'progress')).toEqual([
      'structure',
      'images',
      'model',
      'parts',
      'meshCheck',
    ]);
    // The box is closed; the ground under it, a shell of its own, is open all round.
    expect(messages.at(-1)).toMatchObject({
      type: 'meshCheck',
      check: { triangles: 14, shells: 2, openEdges: 4, nonManifoldEdges: 0, flippedEdges: 0 },
    });
    const { gltf, source } = structureOf(messages);
    expect(gltf.nodes[0]).toEqual({ name: 'cube.obj', children: [1, 2, 3] });
    expect(gltf.nodes.slice(1).map((node: { name: string }) => node.name)).toEqual([
      'Box',
      'Ground',
      'Outline',
    ]);
    expect(gltf.images).toEqual([{ uri: 'checker.png' }]);
    expect(gltf.materials[0]).toMatchObject({
      name: 'Checker',
      pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], baseColorTexture: { index: 0 } },
      doubleSided: true,
    });
    // Kd as linear, and roughness from the Phong exponent, as Blender does.
    expect(gltf.materials[1].pbrMetallicRoughness).toEqual({
      baseColorFactor: [0.787412, 0.100482, 0.0331048, 1],
      metallicFactor: 0,
      roughnessFactor: 0.683772,
    });
    expect(source).toMatchObject({
      format: 'obj',
      mtllibs: ['cube.mtl'],
      materials: [
        { library: 'cube.mtl', statements: expect.arrayContaining([['map_Kd', 'checker.png']]) },
        { library: 'cube.mtl' },
        { library: 'cube.mtl' },
      ],
    });
    const model = modelOf(messages);
    expect(model.notices).toEqual([]);
    expect(JSON.parse(model.json).images).toEqual([{ bufferView: 14, mimeType: 'image/png' }]);
  });

  it('gives positions the bounds glTF requires, and indices in 16 bits when they fit', async () => {
    const { gltf } = structureOf(await loadAll('bracket.stl'));
    // A single object is drawn by the file's own node.
    expect(gltf.nodes).toEqual([{ name: 'bracket.stl', mesh: 0 }]);
    const [position, indices] = gltf.accessors;
    expect(position).toMatchObject({ count: 14, min: [0, 0, 0], max: [40, 20, 25] });
    expect(indices).toMatchObject({ componentType: 5123, count: 72 });
  });

  it('moves geometry far from the origin back with a node of its own', async () => {
    const { gltf } = structureOf(await loadAll('cloud.ply'));
    expect(gltf.nodes).toEqual([
      { name: 'cloud.ply', children: [1] },
      { translation: [500002, 4100001, 100], mesh: 0 },
    ]);
    expect(gltf.meshes[0].primitives[0].mode).toBe(0);
    expect(gltf.accessors[1]).toMatchObject({
      componentType: 5123,
      normalized: true,
      type: 'VEC3',
    });
    expect(gltf.bufferViews[1].byteStride).toBe(8);
  });

  it('finds textures by name when a library gives an absolute path, and says what it missed', async () => {
    const messages = await loadAll('problems.obj');
    const { gltf } = structureOf(messages);
    expect(gltf.images).toEqual([{ uri: 'checker.png' }]);
    expect(modelOf(messages).notices).toEqual([
      "bumps.tga wasn't found next to the model.",
      "stone.tga isn't shown: textures are shown from PNG, JPEG, WebP, GIF and BMP files.",
      "Materials the material libraries don't define: Undefined",
      'Faces left out because they are incomplete or name vertices the file lacks: 1',
      "Free-form curves and surfaces aren't drawn: 1",
    ]);
  });

  it('says when a material library is missing, and draws without it', async () => {
    const messages = await loadAll('missing-library.obj');
    expect(modelOf(messages).notices).toEqual(["nowhere.mtl wasn't found next to the model."]);
    expect(structureOf(messages).gltf.materials).toEqual([
      expect.objectContaining({ name: 'Something' }),
    ]);
  });

  it('matches material names written in Latin-1, as older exporters write them', async () => {
    const messages = await loadAll('latin1.obj');
    expect(modelOf(messages).notices).toEqual([]);
    expect(structureOf(messages).gltf.materials).toEqual([
      expect.objectContaining({ name: 'Terraindæk' }),
    ]);
  });

  it("puts faces in a library's only material when the file selects none", async () => {
    const messages = await loadAll('only-material.obj');
    const { gltf } = structureOf(messages);
    expect(gltf.materials).toEqual([expect.objectContaining({ name: 'Clay' })]);
    expect(gltf.meshes[0].primitives[0].material).toBe(0);
    expect(modelOf(messages).notices).toEqual([]);
  });

  it('says why a file can not be shown', async () => {
    const failed = async (name: string) => {
      const messages = await loadAll(name);
      expect(types(messages)).toEqual(['failed']);
      return messages[0].type === 'failed' ? messages[0].message : '';
    };
    expect(await failed('object-file.obj')).toBe(texts.notMesh('obj', true));
    expect(await failed('not-a-model.stl')).toBe(texts.notMesh('stl', false));
    expect(await failed('not-a-model.ply')).toBe(texts.notMesh('ply', false));
  });

  it('asks before reading a large file, showing its header meanwhile', async () => {
    const messages = await loadAll('cloud.ply', 1000);
    expect(types(messages).filter((type) => type !== 'progress')).toEqual([
      'structure',
      'large',
      'structure',
      'images',
      'model',
      'parts',
    ]);
    const [header, , read] = messages.filter((message) => message.type !== 'progress');
    expect(header).toMatchObject({
      source: { format: 'ply', elements: [{ name: 'vertex', count: 601 }, { name: 'camera' }] },
    });
    // Once the user has waited, the panels keep their place.
    expect(read).toMatchObject({ type: 'structure', reload: true });
  });

  it('says how far reading has come', async () => {
    const progress = (await loadAll('points.obj')).filter((message) => message.type === 'progress');
    expect(progress).toEqual([{ type: 'progress', loadId: 1, done: 17133, total: 17133 }]);
  });

  it('reads a pnts tile into points, and says so when they are compressed', async () => {
    const messages = await loadAll('tiles/points.pnts');
    const { source, gltf } = structureOf(messages);
    expect(source).toMatchObject({ format: 'pnts', points: 24 * 48 + 1 });
    const [primitive] = gltf.meshes[0].primitives;
    expect(primitive.mode).toBe(0);
    expect(Object.keys(primitive.attributes).sort()).toEqual(['COLOR_0', 'POSITION']);
    expect(modelOf(messages).notices).toEqual([]);

    // Positions and colors from Draco, normals from the body.
    const draco = await loadAll('tiles/draco.pnts');
    const [decoded] = structureOf(draco).gltf.meshes[0].primitives;
    expect(Object.keys(decoded.attributes).sort()).toEqual(['COLOR_0', 'NORMAL', 'POSITION']);
    expect(modelOf(draco).notices).toEqual([]);

    const json = JSON.stringify({
      POINTS_LENGTH: 1,
      extensions: { '3DTILES_draco_point_compression': { properties: { POSITION: 0 } } },
    }).padEnd(36);
    const bytes = new Uint8Array(28 + json.length);
    bytes.set(new TextEncoder().encode(`pnts`));
    const view = new DataView(bytes.buffer);
    view.setUint32(4, 1, true);
    view.setUint32(8, bytes.length, true);
    view.setUint32(12, json.length, true);
    bytes.set(new TextEncoder().encode(json), 28);
    const compressed: HostToWebviewMessage[] = [];
    const options = {
      loadId: 1,
      reload: false,
      texts,
      format: 'pnts' as const,
      fileName: 'a.pnts',
    };
    for await (const message of loadMessages(memorySource(bytes), async () => 'missing', options)) {
      compressed.push(message);
    }
    expect(types(compressed).filter((type) => type !== 'progress')).toEqual([
      'structure',
      'failed',
    ]);
    expect(compressed.at(-1)).toMatchObject({ message: expect.stringMatching(/Draco/) });
  });
});
