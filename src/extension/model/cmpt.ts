// A Composite (cmpt) tile from 3D Tiles: a header and the tiles it holds, one after another,
// each a b3dm, i3dm, pnts or cmpt of its own.
import type { CmptFacts } from '../../shared/protocol';
import { sliceSource, type ByteSource } from './sources';

/** A tile inside a composite: where it is among the others (`2/1`), its kind, and its bytes. */
export interface InnerTile {
  path: string;
  format: string;
  source: ByteSource;
}

export type Cmpt =
  | { facts: CmptFacts; tiles: InnerTile[] }
  | { failure: 'notTile' | 'damaged' }
  | { failure: 'version'; version: number };

const HEADER = 16;
/** Composites inside composites deeper than this aren't read. */
const MAX_DEPTH = 8;
/** Tiles past this many aren't read: a damaged count would have the reader go on and on. */
const MAX_TILES = 100_000;

export function isCmpt(head: Uint8Array): boolean {
  return new TextDecoder().decode(head.subarray(0, 4)) === 'cmpt';
}

/** Reads a composite's header and finds the tiles in it, those in inner composites too. */
export async function readCmpt(source: ByteSource): Promise<Cmpt> {
  const head = await source.read(0, Math.min(HEADER, source.size));
  if (!isCmpt(head)) return { failure: 'notTile' };
  if (head.length < HEADER) return { failure: 'damaged' };
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const version = view.getUint32(4, true);
  if (version !== 1)
    return version < 256 ? { failure: 'version', version } : { failure: 'damaged' };

  const facts: CmptFacts = { format: 'cmpt', version, header: HEADER, tiles: [] };
  const tiles: InnerTile[] = [];
  const walk = async (start: number, end: number, prefix: string, depth: number) => {
    const header = new DataView((await source.read(start, HEADER)).buffer);
    const count = header.getUint32(12, true);
    let at = start + HEADER;
    for (let i = 0; i < count && tiles.length < MAX_TILES; i++) {
      if (at + 12 > end) return;
      const inner = await source.read(at, 12);
      const length = new DataView(inner.buffer).getUint32(8, true);
      if (length < 12 || at + length > end) return;
      const format = new TextDecoder('latin1').decode(inner.subarray(0, 4));
      const path = `${prefix}${i + 1}`;
      facts.tiles.push({ path, format, bytes: length });
      if (format === 'cmpt' && depth < MAX_DEPTH && length >= HEADER) {
        await walk(at, at + length, `${path}/`, depth + 1);
      } else {
        // A composite too deep or too short to read is a tile like the others, named if not drawn.
        tiles.push({ path, format, source: sliceSource(source, at, length) });
      }
      at += length;
    }
  };
  await walk(0, source.size, '', 0);
  return { facts, tiles };
}
