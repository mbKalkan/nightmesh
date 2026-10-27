import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileResourceOpener } from '../../src/extension/model/fileResources';
import { loadMessages } from '../../src/extension/model/load';
import { fileSource } from '../../src/extension/model/sources';
import { loadTexts, type Translate } from '../../src/extension/texts';
import { formatForPath } from '../../src/shared/formats';
import type { ImageInfo, StructureMessage } from '../../src/shared/protocol';
import { GltfModel } from '../../src/webview/structure/gltf';
import { sizeAnalysis, type SizeAnalysis } from '../../src/webview/structure/sizes';
import { ModelUsage } from '../../src/webview/structure/usage';

const FIXTURES = resolve('test/fixtures');
const english: Translate = (message, ...args) =>
  message.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)]));

/** A fixture's size analysis, from what the host sends for it. */
async function analyse(name: string): Promise<SizeAnalysis> {
  const source = await fileSource(join(FIXTURES, name));
  const opener = fileResourceOpener('/fixtures', '/fixtures', (path) =>
    join(FIXTURES, path.slice('/fixtures'.length)),
  );
  let json = '{}';
  let chunks;
  let tile: StructureMessage['tile'];
  let images;
  let bytes;
  try {
    const options = {
      loadId: 1,
      reload: false,
      texts: loadTexts(english),
      format: formatForPath(name),
    };
    for await (const message of loadMessages(source, opener, options)) {
      if (message.type === 'structure') ({ json, chunks, tile } = message);
      if (message.type === 'images') ({ images, bytes } = message);
    }
  } finally {
    await source.close();
  }
  const model = new GltfModel(JSON.parse(json));
  return sizeAnalysis(model, new ModelUsage(model), {
    fileName: name,
    fileSize: statSync(join(FIXTURES, name)).size,
    chunks,
    tile: tile?.format === 'cmpt' ? undefined : tile,
    images,
    imageBytes: bytes,
  });
}

const byCategory = (analysis: SizeAnalysis) =>
  Object.fromEntries(analysis.categories.map((entry) => [entry.category, entry.bytes]));
const sum = (analysis: SizeAnalysis) =>
  analysis.categories.reduce((total, entry) => total + entry.bytes, 0);

describe('sizeAnalysis', () => {
  it('accounts for every byte of a GLB', async () => {
    const analysis = await analyse('scene.glb');
    expect(analysis.total).toBe(statSync(join(FIXTURES, 'scene.glb')).size);
    expect(analysis.files).toBe(1);
    expect(Math.abs(sum(analysis) - analysis.total)).toBeLessThanOrEqual(
      analysis.categories.length,
    );
    expect(byCategory(analysis)).toMatchObject({
      json: expect.any(Number),
      vertices: expect.any(Number),
      indices: expect.any(Number),
      other: expect.any(Number),
    });
    expect(analysis.largest[0].key).toMatch(/^mesh:\d+$/);
  });

  it('counts only what a GLB cut short still holds', async () => {
    const analysis = await analyse('truncated.glb');
    expect(analysis.total).toBe(statSync(join(FIXTURES, 'truncated.glb')).size);
    expect(Math.abs(sum(analysis) - analysis.total)).toBeLessThanOrEqual(
      analysis.categories.length,
    );
  });

  it("accounts for a b3dm tile's header and tables apart from its GLB", async () => {
    const analysis = await analyse('tiles/batched.b3dm');
    const bytes = readFileSync(join(FIXTURES, 'tiles/batched.b3dm'));
    expect(analysis.total).toBe(bytes.length);
    // The header, the feature table's JSON, the batch table's JSON and binary body.
    const tables = [12, 16, 20, 24].reduce((sum, at) => sum + bytes.readUInt32LE(at), 0);
    expect(byCategory(analysis).tile).toBe(28 + tables);
    expect(Math.abs(sum(analysis) - analysis.total)).toBeLessThanOrEqual(
      analysis.categories.length,
    );
  });

  it('counts the files a .gltf uses', async () => {
    const analysis = await analyse('textured.gltf');
    const own = statSync(join(FIXTURES, 'textured.gltf')).size;
    const bin = statSync(join(FIXTURES, 'textured.bin')).size;
    const png = statSync(join(FIXTURES, 'checker.png')).size;
    expect(analysis.files).toBe(3);
    expect(analysis.total).toBe(own + bin + png);
    expect(byCategory(analysis)).toMatchObject({ json: own, textures: png });
    expect(analysis.images).toEqual([
      expect.objectContaining({ name: 'checker', bytes: png, texture: 0, warnings: [] }),
    ]);
    expect(analysis.compression.textures).toEqual({ png: 1 });
  });

  it('leaves data embedded in the JSON out of its share', async () => {
    const analysis = await analyse('embedded.gltf');
    const categories = byCategory(analysis);
    expect(analysis.files).toBe(1);
    // The base64 text takes a third more than the bytes it holds.
    expect(categories.other).toBeGreaterThan(0);
    expect(categories.json + categories.other + categories.vertices + categories.indices).toBe(
      analysis.total,
    );
  });

  it('counts compressed data as stored, and decoded data on the GPU', async () => {
    const meshopt = await analyse('meshopt.glb');
    expect(meshopt.compression).toMatchObject({ meshopt: 4, views: 4, quantized: true, draco: 0 });
    expect(sum(meshopt)).toBeLessThanOrEqual(meshopt.total + meshopt.categories.length);
    expect(meshopt.gpuMemory.geometry).toBeGreaterThan(byCategory(meshopt).vertices);

    const draco = await analyse('draco.glb');
    expect(draco.compression).toMatchObject({ draco: 1, primitives: 1 });
    expect(draco.largest).toEqual([{ key: 'mesh:0', bytes: byCategory(draco).vertices }]);
    expect(draco.gpuMemory.geometry).toBeGreaterThan(byCategory(draco).vertices);

    const ktx2 = await analyse('ktx2.glb');
    expect(ktx2.compression.textures).toEqual({ ktx2: 2 });
    expect(ktx2.suggestions).toEqual([]);
  });

  it('sorts out animation, skin and morph target data', async () => {
    const categories = byCategory(await analyse('animated.glb'));
    expect(categories.animation).toBeGreaterThan(0);
    expect(categories.skins).toBeGreaterThan(0);
    expect(categories.morphTargets).toBeGreaterThan(0);
  });

  it('finds unused data and images that need attention, and suggests what to do', () => {
    const model = new GltfModel({
      asset: { version: '2.0' },
      buffers: [{ byteLength: 4_500_000 }],
      bufferViews: [
        { buffer: 0, byteLength: 2_000_000 },
        { buffer: 0, byteOffset: 2_000_000, byteLength: 1_500_000 },
        { buffer: 0, byteOffset: 3_500_000, byteLength: 600_000 },
        { buffer: 0, byteOffset: 4_100_000, byteLength: 400_000 },
      ],
      accessors: [{ bufferView: 0, componentType: 5126, count: 166_667, type: 'VEC3' }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      images: [
        { bufferView: 1, mimeType: 'image/png' },
        { bufferView: 2, mimeType: 'image/jpeg' },
      ],
      textures: [{ source: 0 }, { source: 1 }],
    });
    const images: ImageInfo[] = [
      { format: 'png', width: 8192, height: 4096 },
      { format: 'jpeg', width: 1000, height: 1000 },
    ];
    const analysis = sizeAnalysis(model, new ModelUsage(model), {
      fileName: 'robot.glb',
      fileSize: 4_501_000,
      chunks: { json: 900, bin: 4_500_000 },
      images,
    });
    expect(byCategory(analysis)).toEqual({
      vertices: 2_000_000,
      textures: 2_100_000,
      unused: 400_000,
      json: 900,
      other: 100,
    });
    expect(analysis.images.map((image) => image.warnings)).toEqual([['large'], ['notPowerOfTwo']]);
    expect(analysis.suggestions.map((suggestion) => suggestion.kind)).toEqual([
      'geometry',
      'textureMemory',
      'textureDownload',
      'textureSize',
      'unused',
    ]);
    expect(analysis.suggestions[0]).toEqual({
      kind: 'geometry',
      bytes: 2_000_000,
      command: 'npx @gltf-transform/cli meshopt "robot.glb" "robot-meshopt.glb"',
    });
    expect(analysis.suggestions[3].command).toBe(
      'npx @gltf-transform/cli resize "robot.glb" "robot-resize.glb" --width 4096 --height 4096',
    );
  });
});
