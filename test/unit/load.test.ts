import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileResourceOpener } from '../../src/extension/model/fileResources';
import { loadMessages } from '../../src/extension/model/load';
import { fileSource } from '../../src/extension/model/sources';
import { loadTexts, type Translate } from '../../src/extension/texts';
import type { HostToWebviewMessage } from '../../src/shared/protocol';

const FIXTURES = resolve('test/fixtures');
const english: Translate = (message, ...args) =>
  message.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)]));

/** Loads a fixture as the extension host does, with the fixtures folder as the workspace. */
async function loadAll(name: string): Promise<HostToWebviewMessage[]> {
  const source = await fileSource(join(FIXTURES, name));
  const opener = fileResourceOpener('/fixtures', '/fixtures', (path) =>
    join(FIXTURES, path.slice('/fixtures'.length)),
  );
  const messages: HostToWebviewMessage[] = [];
  try {
    const options = { loadId: 1, reload: false, texts: loadTexts(english) };
    for await (const message of loadMessages(source, opener, options)) messages.push(message);
  } finally {
    await source.close();
  }
  return messages;
}

/** The messages after the structure, which is checked on its own. */
const load = async (name: string) =>
  (await loadAll(name)).filter((message) => message.type !== 'structure');

const failure = async (name: string) => {
  const [message] = await load(name);
  if (message.type !== 'failed') throw new Error(`${name} loaded as ${message.type}`);
  return { message: message.message, details: message.details };
};

describe('loadMessages', () => {
  it('sends the structure first, as the file has it', async () => {
    const [structure, model] = await loadAll('textured.gltf');
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

  it('sends the structure of models it cannot draw', async () => {
    for (const name of ['unsupported-extension.glb', 'missing-resource.gltf']) {
      expect((await loadAll(name)).map((message) => message.type)).toEqual(['structure', 'failed']);
    }
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

  it('turns textures next to a .gltf into parts and leaves no URI behind', async () => {
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
