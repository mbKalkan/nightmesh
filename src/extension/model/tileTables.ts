// A tile's feature and batch tables, as bytes, for the webview to read a clicked feature from:
// the tile file itself, or a tile inside a composite.
import type { TileTablesBytes } from '../../shared/protocol';
import { readCmpt } from './cmpt';
import { readI3dm } from './i3dm';
import type { ByteSource } from './sources';
import { readB3dm } from './tileFile';

/** Tables past this aren't sent: they describe features, not geometry. */
const MAX_TABLES = 256 * 1024 * 1024;
/** pnts's header, which only gives the four tables' lengths after its own. */
const PNTS_HEADER = 28;

/**
 * The tables of the b3dm, i3dm or pnts tile in `source`, or of the tile at `part` in a composite
 * (`2`, or `3/1` in an inner one). Undefined when there is no such tile or it can't be read.
 */
export async function readTileTables(
  source: ByteSource,
  part?: string,
): Promise<TileTablesBytes | undefined> {
  if (part !== undefined) {
    const cmpt = await readCmpt(source);
    if ('failure' in cmpt) return undefined;
    const inner = cmpt.tiles.find((tile) => tile.path === part);
    return inner && readTileTables(inner.source);
  }
  const head = await source.read(0, Math.min(PNTS_HEADER, source.size));
  const magic = new TextDecoder('latin1').decode(head.subarray(0, 4));
  let layout: { header: number; feature: TableSize; batch: TableSize } | undefined;
  let batchLength: number | undefined;
  if (magic === 'b3dm' || magic === 'i3dm') {
    const tile = magic === 'b3dm' ? await readB3dm(source) : await readI3dm(source);
    if ('failure' in tile) return undefined;
    const { header, featureTable, batchTable } = tile.facts;
    layout = { header, feature: featureTable, batch: batchTable };
    if (header < 28) batchLength = tile.facts.batchLength;
  } else if (magic === 'pnts' && head.length === PNTS_HEADER) {
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    const [json, binary, batchJson, batchBinary] = [12, 16, 20, 24].map((at) =>
      view.getUint32(at, true),
    );
    layout = {
      header: PNTS_HEADER,
      feature: { json, binary },
      batch: { json: batchJson, binary: batchBinary },
    };
  }
  if (!layout) return undefined;
  const { header, feature, batch } = layout;
  const featureBytes = feature.json + feature.binary;
  const batchBytes = batch.json + batch.binary;
  if (featureBytes + batchBytes > MAX_TABLES || header + featureBytes + batchBytes > source.size) {
    return undefined;
  }
  return {
    format: magic as TileTablesBytes['format'],
    feature: { bytes: await source.read(header, featureBytes), json: feature.json },
    batch: { bytes: await source.read(header + featureBytes, batchBytes), json: batch.json },
    ...(batchLength !== undefined && { batchLength }),
  };
}

interface TableSize {
  json: number;
  binary: number;
}
