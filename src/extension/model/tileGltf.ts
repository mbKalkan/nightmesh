// The glTF a file holds, for the glTF Validator: a tile's GLB, the file an i3dm tile names, or the
// file itself.
import type { ModelFormat } from '../../shared/protocol';
import { readI3dm } from './i3dm';
import type { ResourceOpener } from './load';
import { linkedOpener } from './resources';
import type { ByteSource } from './sources';
import { readB3dm } from './tileFile';

/** A file's glTF, what opens the resources it names, and what to close once it is read. */
export interface GltfFile {
  source: ByteSource;
  open: ResourceOpener;
  close(): Promise<void>;
}

/**
 * The glTF in a file: a b3dm or i3dm tile's GLB, the file an i3dm tile names (opened by `open`,
 * as its resources are, from its own folder), or the file itself. Rejects a tile it can't read
 * and a named file that can't be opened.
 */
export async function gltfFile(
  source: ByteSource,
  format: ModelFormat,
  open: ResourceOpener,
): Promise<GltfFile> {
  const kept = { source, open, close: async () => {} };
  if (format !== 'b3dm' && format !== 'i3dm') return kept;
  const tile = format === 'b3dm' ? await readB3dm(source) : await readI3dm(source);
  if ('failure' in tile) throw new Error(`The ${format} tile can't be read: ${tile.failure}`);
  if ('glb' in tile) return { ...kept, source: tile.glb };
  const linked = await open(tile.uri);
  if (typeof linked === 'string') throw new Error(`The tile's glTF can't be opened: ${linked}`);
  return { source: linked, open: linkedOpener(open, tile.uri), close: () => linked.close() };
}
