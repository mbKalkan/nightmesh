// The glTF a file holds, for the glTF Validator: a tile's GLB, or the file itself.
import type { ModelFormat } from '../../shared/protocol';
import { readI3dm } from './i3dm';
import type { ByteSource } from './sources';
import { readB3dm } from './tileFile';

/**
 * The glTF in a file: a b3dm or i3dm tile's GLB, or the file itself. Rejects a tile it can't
 * read, and an i3dm tile whose glTF is a file of its own.
 */
export async function gltfSource(source: ByteSource, format: ModelFormat): Promise<ByteSource> {
  if (format !== 'b3dm' && format !== 'i3dm') return source;
  const tile = format === 'b3dm' ? await readB3dm(source) : await readI3dm(source);
  if ('failure' in tile) throw new Error(`The ${format} tile can't be read: ${tile.failure}`);
  if (!('glb' in tile)) throw new Error(`The ${format} tile holds no GLB`);
  return tile.glb;
}
