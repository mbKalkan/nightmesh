// Writes the sample models in test/fixtures from code, so they are small, deterministic and free
// to share. Run `npm run fixtures` after changing this file and commit the results.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'test/fixtures';
const GENERATOR = 'Nightmesh fixture generator';

const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;

const pad4 = (length) => (length + 3) & ~3;

/** One triangle in the XY plane, one metre on each side. */
function triangle() {
  const indices = new Uint16Array([0, 1, 2]);
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const positionsOffset = pad4(indices.byteLength);
  const bin = Buffer.alloc(positionsOffset + positions.byteLength);
  Buffer.from(indices.buffer).copy(bin, 0);
  Buffer.from(positions.buffer).copy(bin, positionsOffset);

  const json = {
    asset: { version: '2.0', generator: GENERATOR },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Triangle', mesh: 0 }],
    meshes: [{ name: 'Triangle', primitives: [{ attributes: { POSITION: 1 }, indices: 0 }] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: indices.byteLength, target: ELEMENT_ARRAY_BUFFER },
      {
        buffer: 0,
        byteOffset: positionsOffset,
        byteLength: positions.byteLength,
        target: ARRAY_BUFFER,
      },
    ],
    accessors: [
      { bufferView: 0, componentType: UNSIGNED_SHORT, count: 3, type: 'SCALAR' },
      {
        bufferView: 1,
        componentType: FLOAT,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
    ],
  };
  return { json, bin };
}

/** A GLB container: 12-byte header, then a JSON chunk padded with spaces and a BIN chunk. */
function glb(json, bin) {
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const jsonChunk = Buffer.alloc(pad4(jsonBytes.length), 0x20);
  jsonBytes.copy(jsonChunk);
  const binChunk = Buffer.alloc(pad4(bin.length));
  bin.copy(binChunk);

  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
  const chunkHeader = (length, type) => {
    const bytes = Buffer.alloc(8);
    bytes.writeUInt32LE(length, 0);
    bytes.write(type, 4, 'ascii');
    return bytes;
  };
  return Buffer.concat([
    header,
    chunkHeader(jsonChunk.length, 'JSON'),
    jsonChunk,
    chunkHeader(binChunk.length, 'BIN\0'),
    binChunk,
  ]);
}

function write(name, bytes) {
  writeFileSync(join(OUT, name), bytes);
  console.log(`wrote ${join(OUT, name)} (${bytes.length} bytes)`);
}

mkdirSync(OUT, { recursive: true });

const { json, bin } = triangle();
write('triangle.glb', glb(json, bin));
const separate = { ...json, buffers: [{ uri: 'triangle.bin', byteLength: bin.length }] };
write('triangle.gltf', Buffer.from(`${JSON.stringify(separate, null, 2)}\n`));
write('triangle.bin', bin);
