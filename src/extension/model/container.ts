import type { ByteSource } from './sources';

/** What the first bytes of a file say it holds, whatever its extension claims. */
export type ContentKind = 'empty' | 'glb' | 'json' | 'lfsPointer' | 'unknown';

const LFS_POINTER = 'version https://git-lfs.github.com/spec/';

export function sniff(head: Uint8Array): ContentKind {
  if (head.length === 0) return 'empty';
  const text = new TextDecoder().decode(head.subarray(0, 64));
  if (text.startsWith('glTF')) return 'glb';
  if (text.startsWith(LFS_POINTER)) return 'lfsPointer';
  // JSON may start with a byte order mark or whitespace.
  if (/^\s*\{/.test(withoutByteOrderMark(text))) return 'json';
  return 'unknown';
}

export function withoutByteOrderMark(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Where a GLB's chunks are; `bin.available` is less than `bin.length` when the file is cut off. */
export interface GlbLayout {
  version: number;
  json: { offset: number; length: number };
  bin?: { offset: number; length: number; available: number };
  truncated: boolean;
}

export type GlbFailure = { failure: 'version'; version: number } | { failure: 'damaged' };

/** The JSON chunk is read into memory whole; nothing real comes close to this. */
export const MAX_JSON_BYTES = 512 * 1024 * 1024;

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

/** Reads the 12-byte header and the chunk headers of a GLB, without its contents. */
export async function readGlbLayout(source: ByteSource): Promise<GlbLayout | GlbFailure> {
  if (source.size < 20) return { failure: 'damaged' };
  const head = await source.read(0, 20);
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const version = view.getUint32(4, true);
  if (version !== 2) return { failure: 'version', version };
  const declaredLength = view.getUint32(8, true);
  const jsonLength = view.getUint32(12, true);
  if (
    view.getUint32(16, true) !== JSON_CHUNK ||
    jsonLength > MAX_JSON_BYTES ||
    20 + jsonLength > source.size
  ) {
    return { failure: 'damaged' };
  }

  const layout: GlbLayout = {
    version,
    json: { offset: 20, length: jsonLength },
    truncated: declaredLength > source.size,
  };
  const binHeader = 20 + jsonLength;
  if (binHeader + 8 <= source.size && binHeader < declaredLength) {
    const chunk = await source.read(binHeader, 8);
    const chunkView = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    if (chunkView.getUint32(4, true) === BIN_CHUNK) {
      const length = chunkView.getUint32(0, true);
      const offset = binHeader + 8;
      const available = Math.min(length, source.size - offset);
      layout.bin = { offset, length, available };
      layout.truncated ||= available < length;
    }
  } else if (declaredLength > binHeader) {
    layout.truncated = true;
  }
  return layout;
}
