import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileResourceOpener } from '../../src/extension/model/fileResources';
import { Resources } from '../../src/extension/model/load';
import { readTile, tilesetMessage, tilesetPlace } from '../../src/extension/model/tiles';
import { memorySource } from '../../src/extension/model/sources';
import { loadTexts, type Translate } from '../../src/extension/texts';

const FIXTURES = resolve('test/fixtures');
const english: Translate = (message, ...args) =>
  message.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)]));
const texts = loadTexts(english);
const opener = fileResourceOpener('/fixtures', '/fixtures', (path) =>
  join(FIXTURES, path.slice('/fixtures'.length)),
);

const open = (json: string, path = 'tiles/tileset.json') =>
  tilesetMessage(memorySource(new TextEncoder().encode(json)), {
    loadId: 3,
    reload: false,
    texts,
    path,
  });

describe('tilesetMessage', () => {
  it('sends the tileset whole, with the path its tiles are asked for by', async () => {
    const json = readFileSync(join(FIXTURES, 'tiles/tileset.json'), 'utf8');
    expect(await open(json)).toEqual({
      type: 'tileset',
      loadId: 3,
      reload: false,
      url: '/_/tiles/tileset.json',
      json,
      fileSize: json.length,
    });
  });

  it('writes names in the path as URLs do', async () => {
    const message = await open('{"asset":{"version":"1.1"},"root":{}}', 'my city/tile#1.json');
    expect(message).toMatchObject({ url: '/_/my%20city/tile%231.json' });
  });

  it.each([
    ['other JSON', '{"name":"package"}'],
    ['a JSON array', '[1, 2]'],
    ['broken JSON', '{"asset":'],
    ['a tileset without a root', '{"asset":{"version":"1.0"}}'],
    ['a glTF model', '{"asset":{"version":"2.0"},"scenes":[]}'],
  ])('says %s is not a tileset', async (_, json) => {
    expect(await open(json)).toMatchObject({
      type: 'failed',
      message: "This JSON file isn't a 3D Tiles tileset.",
    });
  });

  it('names a version of 3D Tiles it does not open', async () => {
    expect(await open('{"asset":{"version":"2.0"},"root":{}}')).toMatchObject({
      type: 'failed',
      message: 'This tileset is 3D Tiles 2.0. Nightmesh opens 3D Tiles 1.0 and 1.1 tilesets.',
    });
  });

  it('says when the file is empty or a Git LFS pointer', async () => {
    expect(await open('')).toMatchObject({ message: 'The file is empty.' });
    const pointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${'0'.repeat(64)}\n`;
    expect(await open(pointer)).toMatchObject({ message: texts.lfsPointer });
  });

  it("brings a metadata schema written in a file of its own, or says why it can't", async () => {
    const tiles = fileResourceOpener('/fixtures/tiles', '/fixtures', (path) =>
      join(FIXTURES, path.slice('/fixtures'.length)),
    );
    const send = (json: string) => {
      const resources = new Resources(tiles, texts);
      return tilesetMessage(
        memorySource(new TextEncoder().encode(json)),
        { loadId: 1, reload: false, texts, path: 'tileset.json' },
        resources,
      );
    };
    const message = await send(readFileSync(join(FIXTURES, 'tiles/metadata.json'), 'utf8'));
    expect(message).toMatchObject({ type: 'tileset', schema: { id: 'district' } });
    expect(message).not.toHaveProperty('notices');
    // 1.0 names it in its extension.
    const missing = await send(
      JSON.stringify({
        asset: { version: '1.0' },
        extensions: { '3DTILES_metadata': { schemaUri: 'nowhere.json' } },
        root: {},
      }),
    );
    expect(missing).not.toHaveProperty('schema');
    expect(missing).toMatchObject({ notices: [expect.stringContaining('nowhere.json')] });
  });
});

describe('readTile', () => {
  it('reads a tile by its path in the folder the viewer may read', async () => {
    const tile = await readTile('/_/tiles/east/tower.b3dm', opener, texts);
    expect(tile).toEqual({
      data: new Uint8Array(readFileSync(join(FIXTURES, 'tiles/east/tower.b3dm'))),
    });
  });

  it('decodes names as URLs write them', async () => {
    expect(await readTile('/_/tiles/east%2Ftower.b3dm', opener, texts)).toEqual({
      problem: "east/tower.b3dm isn't a valid file reference.",
    });
    expect('data' in (await readTile('/_/tiles/%65ast/tower.b3dm', opener, texts))).toBe(true);
  });

  it('refuses paths that climbed out of the folder', async () => {
    expect(await readTile('/outside.b3dm', opener, texts)).toEqual({
      problem: "outside.b3dm wasn't loaded: it is outside the model's folder and workspace.",
    });
    expect(await readTile('/_/../../secret.b3dm', opener, texts)).toMatchObject({
      problem: expect.stringContaining('outside'),
    });
  });

  it('says a tile is missing', async () => {
    expect(await readTile('/_/tiles/missing.b3dm', opener, texts)).toEqual({
      problem: "missing.b3dm wasn't found next to the model.",
    });
  });

  it('says a tile is a Git LFS pointer', async () => {
    expect(await readTile('/_/lfs-pointer.glb', opener, texts)).toEqual({
      problem:
        "lfs-pointer.glb is a Git LFS pointer: the tile hasn't been downloaded. Run git lfs pull to get it.",
    });
  });
});

describe('tilesetPlace', () => {
  it('reads tiles from the workspace folder, whatever case VS Code gives its drive', () => {
    expect(tilesetPlace('/d:/Work/city/tileset.json', '/D:/Work')).toEqual({
      root: '/D:/Work',
      path: 'city/tileset.json',
    });
  });

  it("reads tiles from the tileset's own folder outside a workspace", () => {
    expect(tilesetPlace('/home/me/city/tileset.json', '/home/me/city')).toEqual({
      root: '/home/me/city',
      path: 'tileset.json',
    });
    expect(tilesetPlace('/elsewhere/tileset.json', '/home/me')).toEqual({
      root: '/elsewhere',
      path: 'tileset.json',
    });
  });
});
