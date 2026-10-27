import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateBytes } from 'gltf-validator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const FIXTURES = 'test/fixtures';

/** Models the viewer should open; the rest of the fixtures are broken on purpose. */
const VALID = [
  'triangle.glb',
  'triangle.gltf',
  'scene.glb',
  'scene-edited.glb',
  'materials.glb',
  'instanced.glb',
  'animated.glb',
  'variants.glb',
  'textured.gltf',
  'embedded.gltf',
  'dense.glb',
  'draco.glb',
  'meshopt.glb',
  'quantized.glb',
  'ktx2.glb',
];

// Small files come back as views into Node's shared buffer pool; the validator needs their own bytes.
/** The files in a folder and its subfolders, by their paths in it with `/` between names. */
const files = (folder: string) =>
  readdirSync(folder, { recursive: true, encoding: 'utf8' })
    .map((name) => name.replace(/\\/g, '/'))
    .filter((name) => statSync(join(folder, name)).isFile());

const read = (name: string) => new Uint8Array(readFileSync(join(FIXTURES, name)));

const validate = (name: string) =>
  validateBytes(read(name), {
    uri: name,
    externalResourceFunction: async (uri) => read(decodeURIComponent(uri)),
  });

describe('test fixtures', () => {
  let fresh: string;

  beforeAll(() => {
    fresh = mkdtempSync(join(tmpdir(), 'nightmesh-fixtures-'));
    execFileSync(process.execPath, ['scripts/gen-fixtures.mjs', '--out', fresh]);
  }, 60_000);

  afterAll(() => rmSync(fresh, { recursive: true, force: true }));

  it('match what the generator writes, byte for byte', () => {
    const generated = files(fresh).filter((name) => !name.startsWith('generated/'));
    const committed = files(FIXTURES).filter(
      (name) => !name.startsWith('private/') && !name.startsWith('generated/'),
    );
    expect(committed.sort()).toEqual(generated.sort());
    for (const name of generated) {
      expect(readFileSync(join(FIXTURES, name)).equals(readFileSync(join(fresh, name))), name).toBe(
        true,
      );
    }
  });

  it.each(VALID)('%s passes the glTF Validator without errors', async (name) => {
    const report = await validate(name);
    const errors = report.issues.messages.filter((message) => message.severity === 0);
    expect(errors).toEqual([]);
  });

  it('makes the compressed models use the extension their names say', async () => {
    const used = async (name: string) => (await validate(name)).info?.extensionsRequired ?? [];
    expect(await used('draco.glb')).toContain('KHR_draco_mesh_compression');
    expect(await used('meshopt.glb')).toContain('EXT_meshopt_compression');
    expect(await used('quantized.glb')).toContain('KHR_mesh_quantization');
    expect(await used('ktx2.glb')).toContain('KHR_texture_basisu');
  });

  it('breaks the broken models the way their names say', async () => {
    expect(readFileSync(join(FIXTURES, 'empty.glb')).length).toBe(0);
    expect(readFileSync(join(FIXTURES, 'lfs-pointer.glb'), 'utf8')).toMatch(
      /^version https:\/\/git-lfs\.github\.com\/spec\/v1\noid sha256:[0-9a-f]{64}\nsize \d+\n$/,
    );
    const truncated = readFileSync(join(FIXTURES, 'truncated.glb'));
    expect(truncated.readUInt32LE(8)).toBeGreaterThan(truncated.length);
    expect((await validate('unsupported-extension.glb')).info?.extensionsRequired).toEqual([
      'EXT_nightmesh_unknown',
    ]);
    const bufferUri = (name: string) =>
      (JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as { buffers: { uri: string }[] })
        .buffers[0].uri;
    expect(bufferUri('missing-resource.gltf')).toBe('missing.bin');
    expect(bufferUri('network-resource.gltf')).toMatch(/^https:/);
    expect(bufferUri('outside-folder.gltf')).toMatch(/^\.\.\//);
    expect(bufferUri('absolute-path.gltf')).toMatch(/^\//);
  });
});
