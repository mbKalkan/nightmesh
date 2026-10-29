import { readFileSync, statSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileResourceOpener } from '../../src/extension/model/fileResources';
import { loadMessages } from '../../src/extension/model/load';
import { fileSource, memorySource } from '../../src/extension/model/sources';
import { loadTexts, type Translate } from '../../src/extension/texts';
import type { HostToWebviewMessage, ModelFormat } from '../../src/shared/protocol';

const FIXTURES = resolve('test/fixtures');
const english: Translate = (message, ...args) =>
  message.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)]));

/** Loads a fixture as the extension host does, with the fixtures folder as the workspace. */
async function loadAll(name: string, format?: ModelFormat): Promise<HostToWebviewMessage[]> {
  const source = await fileSource(join(FIXTURES, name));
  const opener = fileResourceOpener(posix.dirname(`/fixtures/${name}`), '/fixtures', (path) =>
    join(FIXTURES, path.slice('/fixtures'.length)),
  );
  const messages: HostToWebviewMessage[] = [];
  try {
    const options = { loadId: 1, reload: false, texts: loadTexts(english), format };
    for await (const message of loadMessages(source, opener, options)) messages.push(message);
  } finally {
    await source.close();
  }
  return messages;
}

/** The messages after the structure, image sizes, animation motion and instances, on their own. */
const load = async (name: string) =>
  (await loadAll(name)).filter(
    (message) => !['structure', 'images', 'animations', 'instances'].includes(message.type),
  );

const failure = async (name: string) => {
  const [message] = await load(name);
  if (message.type !== 'failed') throw new Error(`${name} loaded as ${message.type}`);
  return { message: message.message, details: message.details };
};

describe('loadMessages', () => {
  it('sends the structure first, as the file has it', async () => {
    const [structure, , model] = await loadAll('textured.gltf');
    expect(structure).toMatchObject({
      type: 'structure',
      fileSize: statSync(join(FIXTURES, 'textured.gltf')).size,
      chunks: undefined,
    });
    expect(structure.type === 'structure' && JSON.parse(structure.json).buffers).toEqual([
      expect.objectContaining({ uri: 'textured.bin' }),
    ]);
    expect(model.type).toBe('model');

    const [glb] = await loadAll('scene.glb');
    const bytes = readFileSync(join(FIXTURES, 'scene.glb'));
    expect(glb).toMatchObject({
      type: 'structure',
      fileSize: bytes.length,
      chunks: {
        json: bytes.readUInt32LE(12),
        bin: bytes.readUInt32LE(20 + bytes.readUInt32LE(12)),
      },
    });
  });

  it("shows a b3dm tile's GLB as a GLB, with what the tile says around it", async () => {
    const bytes = readFileSync(join(FIXTURES, 'tiles/batched.b3dm'));
    const messages = await loadAll('tiles/batched.b3dm', 'b3dm');
    const [structure] = messages;
    const glb = 28 + [12, 16, 20, 24].reduce((sum, at) => sum + bytes.readUInt32LE(at), 0);
    expect(structure).toMatchObject({
      type: 'structure',
      fileSize: bytes.length,
      chunks: { json: bytes.readUInt32LE(glb + 12) },
      tile: { format: 'b3dm', batchLength: 3 },
    });
    // Three buildings under a node that turns them to the Earth's axes, as such tiles have them.
    expect(structure.type === 'structure' && JSON.parse(structure.json).nodes).toHaveLength(4);
    // On the globe, the model is placed where it is, to stand upright in the view.
    const model = messages.find((message) => message.type === 'model');
    expect(model).toMatchObject({ extensions: ['EXT_mesh_gpu_instancing'] });

    const failed = async (name: string) => {
      const [message] = await loadAll(name, 'b3dm');
      return message.type === 'failed' ? message.message : message.type;
    };
    expect(await failed('tiles/damaged.b3dm')).toBe(
      "The file isn't a b3dm tile, or it is damaged.",
    );
    expect(await failed('scene.glb')).toBe("The file isn't a b3dm tile, or it is damaged.");
    expect(await failed('lfs-pointer.glb')).toMatch(/Git LFS pointer/);
  });

  it("draws an i3dm tile's GLB once for each instance, and shows the GLB as the file has it", async () => {
    const messages = await loadAll('tiles/instanced.i3dm', 'i3dm');
    const structure = messages.find((message) => message.type === 'structure');
    const model = messages.find((message) => message.type === 'model');
    if (structure?.type !== 'structure' || model?.type !== 'model') throw new Error('not drawn');
    expect(structure.tile).toMatchObject({ format: 'i3dm', instances: 9 });
    expect(JSON.parse(structure.json).extensionsUsed ?? []).not.toContain(
      'EXT_mesh_gpu_instancing',
    );
    expect(model.extensions).toContain('EXT_mesh_gpu_instancing');
    // The panels measure every instance: posts 10 m apart, the widest and tallest twice as big.
    const instances = messages.find((message) => message.type === 'instances');
    expect(instances).toMatchObject({ nodes: [{ node: 0 }] });
    if (instances?.type !== 'instances') throw new Error('no instances');
    const [{ min, max }] = instances.nodes;
    expect(max[0] - min[0]).toBeCloseTo(22, 3);
    expect(max[1] - min[1]).toBeCloseTo(6, 3);
  });

  it("draws the glTF an i3dm tile names, with that file's own resources", async () => {
    const messages = await loadAll('tiles/external.i3dm', 'i3dm');
    const structure = messages.find((message) => message.type === 'structure');
    const model = messages.find((message) => message.type === 'model');
    if (structure?.type !== 'structure' || model?.type !== 'model') throw new Error('not drawn');
    // The panels show the named glTF, with the tile's size and the glTF file's.
    expect(JSON.parse(structure.json).buffers).toEqual([{ uri: 'textured.bin', byteLength: 840 }]);
    expect(structure).toMatchObject({
      fileSize: statSync(join(FIXTURES, 'tiles/external.i3dm')).size,
      tile: {
        format: 'i3dm',
        instances: 3,
        gltfUri: '../textured.gltf',
        gltfBytes: statSync(join(FIXTURES, 'textured.gltf')).size,
      },
    });
    // Its buffer and image are found next to it, not next to the tile.
    expect(model.notices).toEqual([]);
    expect(model.extensions).toContain('EXT_mesh_gpu_instancing');
    expect(messages.find((message) => message.type === 'images')).toMatchObject({
      images: [{ width: 64, height: 64 }],
    });
  });

  it("says why an i3dm tile's glTF can't be opened", async () => {
    const tile = readFileSync(join(FIXTURES, 'tiles/external.i3dm'));
    const named = (uri: string) => {
      const at = tile.indexOf('../textured.gltf');
      return Buffer.concat([tile.subarray(0, at), Buffer.from(uri.padEnd(16, ' '))]);
    };
    const opener = fileResourceOpener('/fixtures/tiles', '/fixtures', (path) =>
      join(FIXTURES, path.slice('/fixtures'.length)),
    );
    const options = {
      loadId: 1,
      reload: false,
      texts: loadTexts(english),
      format: 'i3dm' as const,
    };
    for (const [uri, reason] of [
      ['gone.glb', "gone.glb wasn't found"],
      ['../../out.glb', 'outside'],
      ['https://a.b/c.glb', "doesn't use the network"],
    ]) {
      const messages = loadMessages(memorySource(named(uri)), opener, options);
      const { value: message } = await messages.next();
      await messages.return(undefined);
      expect(message).toMatchObject({
        type: 'failed',
        message: expect.stringMatching(new RegExp(`in a file of its own[.] .*${reason}`)),
      });
    }
  });

  it('draws the b3dm and i3dm tiles of a composite as one model, and says what it leaves out', async () => {
    const messages = await loadAll('tiles/composite.cmpt', 'cmpt');
    const structure = messages.find((message) => message.type === 'structure');
    const model = messages.find((message) => message.type === 'model');
    if (structure?.type !== 'structure' || model?.type !== 'model') throw new Error('not drawn');
    expect(structure).toMatchObject({
      fileSize: statSync(join(FIXTURES, 'tiles/composite.cmpt')).size,
      tile: {
        format: 'cmpt',
        tiles: [
          { path: '1', format: 'b3dm' },
          { path: '2', format: 'i3dm' },
          { path: '3', format: 'cmpt' },
          { path: '3/1', format: 'pnts' },
        ],
      },
    });
    const json = JSON.parse(structure.json);
    const holders = json.scenes[0].nodes.map((index: number) => json.nodes[index].name);
    expect(holders).toEqual(['b3dm 1', 'i3dm 2']);
    expect(model.notices).toEqual([expect.stringContaining('pnts 3/1')]);
    // The buildings and the posts 40 m east of them, together.
    const instances = messages.find((message) => message.type === 'instances');
    if (instances?.type !== 'instances') throw new Error('no instances');
    expect(instances.nodes).toHaveLength(4);
  });

  it("draws a composite's i3dm tile that names its glTF, from that glTF's folder", async () => {
    const inner = readFileSync(join(FIXTURES, 'tiles/external.i3dm'));
    const header = Buffer.alloc(16);
    header.write('cmpt', 0, 'ascii');
    header.writeUInt32LE(1, 4);
    header.writeUInt32LE(16 + inner.length, 8);
    header.writeUInt32LE(1, 12);
    const opener = fileResourceOpener('/fixtures/tiles', '/fixtures', (path) =>
      join(FIXTURES, path.slice('/fixtures'.length)),
    );
    const options = {
      loadId: 1,
      reload: false,
      texts: loadTexts(english),
      format: 'cmpt' as const,
    };
    const messages: HostToWebviewMessage[] = [];
    const source = memorySource(Buffer.concat([header, inner]));
    for await (const message of loadMessages(source, opener, options)) messages.push(message);
    const structure = messages.find((message) => message.type === 'structure');
    const model = messages.find((message) => message.type === 'model');
    if (structure?.type !== 'structure' || model?.type !== 'model') throw new Error('not drawn');
    // Its buffer and image are named from the composite's folder, where the merged model is.
    const json = JSON.parse(structure.json);
    expect(json.buffers[0].uri).toBe('../textured.bin');
    expect(json.images[0].uri).toBe('../checker.png');
    expect(model.notices).toEqual([]);
  });

  it('sends the structure of models it cannot draw', async () => {
    expect((await loadAll('unsupported-extension.glb')).map((message) => message.type)).toEqual([
      'structure',
      'failed',
    ]);
    expect((await loadAll('missing-resource.gltf')).map((message) => message.type)).toEqual([
      'structure',
      'images',
      'failed',
    ]);
    for (const name of ['empty.glb', 'not-a-model.glb', 'lfs-pointer.glb']) {
      expect((await loadAll(name)).map((message) => message.type)).toEqual(['failed']);
    }
  });

  it('sends a model and then all of its parts, keyed for the loader', async () => {
    const messages = await load('scene.glb');
    const [model, ...rest] = messages;
    if (model.type !== 'model') throw new Error('expected a model');

    const keys = rest.flatMap((message) =>
      message.type === 'part' ? [message.key] : message.type === 'parts' ? message.keys : [],
    );
    expect(keys).toHaveLength(model.parts);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((key) => /^(bufferView|buffer):\d+$/.test(key))).toBe(true);
    const sent = rest.reduce(
      (sum, message) => sum + ('data' in message ? message.data.byteLength : 0),
      0,
    );
    expect(sent).toBe(model.bytes);
    expect(model.notices).toEqual([]);
    expect(JSON.parse(model.json).asset.generator).toBe('Nightmesh fixture generator');
  });

  it('tells which animations move anything before the model is drawn', async () => {
    const messages = await loadAll('animated.glb');
    expect(messages.map((message) => message.type).slice(0, 3)).toEqual([
      'structure',
      'images',
      'animations',
    ]);
    expect(messages[2]).toMatchObject({ motion: ['moves', 'moves', 'moves', 'moves', 'none'] });
    expect((await loadAll('scene.glb')).map((message) => message.type)).not.toContain('animations');
  });

  it('says where GPU instances are before the model is drawn', async () => {
    const messages = await loadAll('instanced.glb');
    expect(messages.map((message) => message.type).slice(0, 3)).toEqual([
      'structure',
      'images',
      'instances',
    ]);
    // Three boxes a metre wide, at x = -2, 0 and 2, standing on the ground.
    expect(messages[2]).toEqual({
      type: 'instances',
      loadId: 1,
      nodes: [{ node: 0, min: [-2.5, 0, -0.5], max: [2.5, 1, 0.5] }],
    });
    expect((await loadAll('scene.glb')).map((message) => message.type)).not.toContain('instances');
  });

  it('asks before sending a model too large to draw lightly, and only then', async () => {
    const source = await fileSource(join(FIXTURES, 'scene.glb'));
    const types: string[] = [];
    let large: HostToWebviewMessage | undefined;
    try {
      const options = { loadId: 1, reload: false, texts: loadTexts(english), largeBytes: 1000 };
      for await (const message of loadMessages(
        source,
        fileResourceOpener('/f', '/f', (p) => p),
        options,
      )) {
        types.push(message.type);
        if (message.type === 'large') large = message;
      }
    } finally {
      await source.close();
    }
    expect(types.indexOf('large')).toBe(types.indexOf('model') - 1);
    const model = (await loadAll('scene.glb')).find((message) => message.type === 'model');
    expect(large).toMatchObject({ bytes: model?.type === 'model' && model.bytes });
    expect((await loadAll('scene.glb')).map((message) => message.type)).not.toContain('large');
  });

  it('packs small parts together, since a message carries only so many arrays', async () => {
    const messages = await load('animated.glb');
    const packs = messages.filter((message) => message.type === 'parts');
    expect(packs.length).toBeGreaterThan(0);
    for (const pack of packs) {
      if (pack.type !== 'parts') continue;
      expect(pack.offsets).toHaveLength(pack.keys.length);
      expect(pack.offsets[0]).toBe(0);
    }
  });

  it('turns textures next to a .gltf into typed parts and leaves no URI behind', async () => {
    const [model] = await load('textured.gltf');
    if (model.type !== 'model') throw new Error('expected a model');
    expect(model.json).not.toMatch(/"uri"/);
    expect(JSON.parse(model.json).images).toEqual([
      expect.objectContaining({ bufferView: expect.any(Number), mimeType: 'image/png' }),
    ]);
  });

  it('tells the viewer which extensions a model uses, so it can load their decoders', async () => {
    const [draco] = await load('draco.glb');
    expect(draco).toMatchObject({ type: 'model', notices: [] });
    expect(draco.type === 'model' && draco.extensions).toContain('KHR_draco_mesh_compression');
    const [ktx2] = await load('ktx2.glb');
    expect(ktx2).toMatchObject({ type: 'model', notices: [] });
    expect(ktx2.type === 'model' && ktx2.extensions).toContain('KHR_texture_basisu');
  });

  it("reads every image's size, from the binary chunk or a separate file", async () => {
    const images = async (name: string) =>
      (await loadAll(name)).find((message) => message.type === 'images');
    expect(await images('textured.gltf')).toMatchObject({
      images: [{ format: 'png', width: 64, height: 64 }],
    });
    expect(await images('ktx2.glb')).toMatchObject({
      images: [
        { format: 'ktx2', width: 64, height: 64, levels: 7 },
        { format: 'ktx2', width: 64, height: 64, levels: 7 },
      ],
    });
    expect(await images('scene.glb')).toMatchObject({ images: [] });
  });

  it('reads embedded data: URIs', async () => {
    const [model] = await load('embedded.gltf');
    expect(model).toMatchObject({ type: 'model', bytes: 44, notices: [] });
  });

  it('explains files it cannot show', async () => {
    expect(await failure('empty.glb')).toEqual({ message: 'The file is empty.', details: [] });
    expect(await failure('not-a-model.glb')).toEqual({
      message: "The file isn't a glTF model, or it is damaged.",
      details: [],
    });
    expect(await failure('lfs-pointer.glb')).toMatchObject({
      message: expect.stringMatching(/^This file is a Git LFS pointer/),
    });
    expect(await failure('unsupported-extension.glb')).toEqual({
      message: "This model needs EXT_nightmesh_unknown, which Nightmesh can't draw yet.",
      details: [],
    });
  });

  it('names the resources it could not load and why', async () => {
    expect(await failure('missing-resource.gltf')).toEqual({
      message: "None of this model's geometry could be loaded.",
      details: ["missing.bin wasn't found next to the model."],
    });
    expect((await failure('network-resource.gltf')).details).toEqual([
      "triangle.bin wasn't loaded: Nightmesh doesn't use the network.",
    ]);
    expect((await failure('outside-folder.gltf')).details).toEqual([
      "triangle.bin wasn't loaded: it is outside the model's folder and workspace.",
    ]);
    expect((await failure('absolute-path.gltf')).details).toEqual([
      "triangle.bin wasn't loaded: only paths relative to the model are followed.",
    ]);
  });

  it('draws what it can of a file that was cut off, and says so', async () => {
    const [model] = await load('truncated.glb');
    expect(model).toMatchObject({
      type: 'model',
      notices: [
        'The file ends early, as if it was cut off while being copied or saved.',
        expect.stringMatching(/^Primitives left out: \d+$/),
      ],
    });
  });

  it('closes the resources it opened when the caller stops early', async () => {
    const source = await fileSource(join(FIXTURES, 'textured.gltf'));
    let closed = 0;
    const opener = fileResourceOpener('/fixtures', '/fixtures', (path) =>
      join(FIXTURES, path.slice('/fixtures'.length)),
    );
    const counting: typeof opener = async (uri) => {
      const opened = await opener(uri);
      if (typeof opened === 'string') return opened;
      return { ...opened, close: async () => void (closed++, await opened.close()) };
    };
    const messages = loadMessages(source, counting, {
      loadId: 1,
      reload: false,
      texts: loadTexts(english),
    });
    for await (const message of messages) {
      if (message.type === 'model') break;
    }
    await source.close();
    expect(closed).toBe(2);
  });
});
