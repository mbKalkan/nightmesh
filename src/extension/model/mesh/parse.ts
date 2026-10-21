// Reading an OBJ, STL or PLY file into geometry, a piece at a time: in this thread for the tests,
// in a worker thread in the extension (workerMesh.ts), which runs the same readers.
import type { MeshFormat, SourceFacts } from '../../../shared/protocol';
import type { ByteSource } from '../sources';
import { MeshFormatError, type MeshReader, type ParsedMesh } from './geometry';
import { ObjReader } from './obj';
import { PlyReader, plyHeaderFacts } from './ply';
import { StlReader, stlEncoding } from './stl';
import { utf16 } from './text';

/** Pieces of this size are read and handed to the reader in turn. */
export const CHUNK = 4 * 1024 * 1024;

/** How far reading has come, then what was read. */
export type MeshEvent = { type: 'progress'; done: number } | { type: 'done'; mesh: ParsedMesh };

/**
 * Reads a file of a format into geometry, saying how far it has come. Throws `MeshFormatError`
 * when the file isn't one of its format; stopping the iteration stops the reading.
 */
export type MeshParser = (format: MeshFormat, source: ByteSource) => AsyncIterable<MeshEvent>;

export function createReader(format: MeshFormat, size: number): MeshReader {
  switch (format) {
    case 'obj':
      return new ObjReader();
    case 'stl':
      return new StlReader(size);
    case 'ply':
      return new PlyReader(size);
  }
}

/** Reads in the calling thread. */
export const parseInThread: MeshParser = async function* (format, source) {
  const reader = createReader(format, source.size);
  for (let offset = 0; offset < source.size;) {
    const length = Math.min(CHUNK, source.size - offset);
    reader.push(await source.read(offset, length));
    offset += length;
    yield { type: 'progress', done: offset };
  }
  yield { type: 'done', mesh: reader.finish() };
};

/** Bytes from the start of a file that `looksLike` and `headerFacts` look at. */
export const HEAD_BYTES = 64 * 1024;

/**
 * Whether the start of a file (`head`, up to 64 KB) looks like its format, before it is read:
 * PLY's signature, STL's size or keyword, OBJ being text. `objectFile` when an `.obj` is binary,
 * as the object files compilers write are.
 */
export function looksLike(
  format: MeshFormat,
  head: Uint8Array,
  size: number,
): 'yes' | 'no' | 'objectFile' {
  switch (format) {
    case 'ply':
      return /^ply\r?\n/.test(new TextDecoder('latin1').decode(head.subarray(0, 5))) ? 'yes' : 'no';
    case 'stl':
      return stlEncoding(head, size) ? 'yes' : 'no';
    case 'obj':
      // UTF-16 text has zeros too, after its byte order mark.
      return utf16(head) || !head.subarray(0, 1024).includes(0) ? 'yes' : 'objectFile';
  }
}

/**
 * What a file's header says, for the inspector while a large file waits to be read: PLY's
 * elements and binary STL's facet count. Undefined for OBJ, which has no header.
 */
export function headerFacts(
  format: MeshFormat,
  head: Uint8Array,
  size: number,
): SourceFacts | undefined {
  if (format === 'ply') return plyHeaderFacts(head);
  if (format !== 'stl') return undefined;
  // ASCII STL has no count up front.
  const encoding = stlEncoding(head, size);
  if (encoding !== 'binary') return undefined;
  const triangles = new DataView(head.buffer, head.byteOffset + 80, 4).getUint32(0, true);
  return { format: 'stl', encoding, triangles };
}

/** Every buffer under a parsed mesh's arrays, to hand to another thread without copying. */
export function meshBuffers(mesh: ParsedMesh): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  const visit = (objects: ParsedMesh['objects']) => {
    for (const object of objects) {
      for (const part of object.parts) {
        for (const array of [part.positions, part.normals, part.uvs, part.colors, part.indices]) {
          if (array && array.buffer instanceof ArrayBuffer) buffers.add(array.buffer);
        }
      }
      visit(object.children);
    }
  };
  visit(mesh.objects);
  return [...buffers];
}

export { MeshFormatError };
