// Implicit tiling, as 3DTilesRendererJS reads it, with what it leaves out:
// - subtrees written as JSON rather than binary, which it reads as JSON and can't parse further:
//   they go to its loader as a binary subtree with no binary chunk;
// - 3D Tiles 1.0's `3DTILES_implicit_tiling` extension, read as 1.1's `implicitTiling`;
// - several contents for each tile: its loader gives a tile the first content available there,
//   so each tile also gets the indices of all its contents available, for the plugin that reads
//   several contents (multipleContents.ts).
import { ImplicitTilingPlugin } from '3d-tiles-renderer/core/plugins';
import { SUBTREELoader } from '3d-tiles-renderer/src/core/plugins/SUBTREELoader.js';
import type { TilesRenderer } from '3d-tiles-renderer/three';
import type { PropertyTables } from '../structure/propertyTable';
import { severalContents } from '../structure/tileContents';

interface BufferViewHeader {
  isActive: boolean;
  bufferHeader: { isActive: boolean };
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const LEGACY = '3DTILES_implicit_tiling';

export interface ImplicitTile {
  implicitTiling?: Json;
  implicitTilingData?: { root: ImplicitTile; level: number; x: number; y: number; z: number };
  /** The indices of the implicit root's contents available at this tile. */
  availableContents?: number[];
  /** Where its subtree's property tables have its metadata, and each of its contents'. */
  tileRow?: TableRow;
  contentRows?: (TableRow | undefined)[];
  /** The metadata of the subtree it is the first tile of. */
  subtreeMetadata?: Json;
  /** An implicit root without content, given its subtree's address as one. */
  withoutContent?: boolean;
  extensions?: Json;
  content?: { uri?: unknown };
  children: object[];
  internal: { basePath: string; hasContent?: boolean };
}

/** The renderer's plugin, as this one uses it: its types say nothing of it. */
interface ImplicitBase {
  tiles: TilesRenderer & { fetchOptions: object };
  preprocessNode(tile: ImplicitTile, tilesetDir: string, parent: ImplicitTile | null): void;
  disposeTile(tile: ImplicitTile): void;
}
const Base = ImplicitTilingPlugin as unknown as new () => ImplicitBase;

const isJson = (uri: unknown) =>
  typeof uri === 'string' && /\.json$/i.test(uri.replace(/[?#].*$/, ''));

/** Whether the tile leads to a JSON subtree: an implicit root, or a tile standing for a subtree. */
const leadsToJsonSubtree = (tile: ImplicitTile) =>
  tile.implicitTilingData !== undefined &&
  (tile.implicitTiling
    ? isJson(isObject(tile.implicitTiling.subtrees) ? tile.implicitTiling.subtrees.uri : undefined)
    : isJson(tile.content?.uri));

/** A subtree's JSON as a binary subtree: the header, then the JSON padded to 8 bytes. */
export function binarySubtree(json: object): ArrayBuffer {
  let text = JSON.stringify(json);
  text += ' '.repeat((8 - (text.length % 8)) % 8);
  const body = new TextEncoder().encode(text);
  const bytes = new Uint8Array(24 + body.length);
  const view = new DataView(bytes.buffer);
  bytes.set([0x73, 0x75, 0x62, 0x74]); // "subt"
  view.setUint32(4, 1, true);
  view.setBigUint64(8, BigInt(body.length), true);
  view.setBigUint64(16, 0n, true);
  bytes.set(body, 24);
  return bytes.buffer;
}

/** 1.0's extension as 1.1's `implicitTiling`: it gave the deepest level, not the level count. */
export function fromLegacy(legacy: Json): Json {
  const { maximumLevel, availableLevels, ...rest } = legacy;
  return {
    ...rest,
    availableLevels:
      typeof availableLevels === 'number'
        ? availableLevels
        : typeof maximumLevel === 'number'
          ? maximumLevel + 1
          : undefined,
  };
}

/** Where a tile's or content's metadata is: a row of one of its subtree's property tables. */
export interface TableRow {
  tables: PropertyTables;
  table: number;
  row: number;
}

/**
 * The renderer's subtree loader, noting on each tile it makes the contents available there and
 * where its subtree's property tables have its metadata and its contents'; on the subtree's
 * first tile, the subtree's own metadata.
 */
class ContentsSubtreeLoader extends SUBTREELoader {
  private json: Json = {};
  private tables: PropertyTables | undefined;
  /** How many bits are set before each, by bitstream, counted as far as asked. */
  private readonly ranks = new Map<unknown, number[]>();

  /**
   * The subtree's JSON as the renderer reads it: 1.0's contents' availability, which
   * `3DTILES_multiple_contents` gave, where 1.1 has it; none at all when the implicit root has no
   * content, which the renderer would otherwise look for.
   */
  override parseBuffer(buffer: ArrayBuffer): { subtreeJson: Json } {
    const parsed = super.parseBuffer(buffer);
    const json = parsed.subtreeJson;
    const legacy = isObject(json.extensions)
      ? json.extensions['3DTILES_multiple_contents']
      : undefined;
    if (json.contentAvailability === undefined && isObject(legacy)) {
      json.contentAvailability = legacy.contentAvailability;
    }
    if (json.contentAvailability === undefined || this.rootTile.withoutContent) {
      json.contentAvailability = [];
    }
    return parsed;
  }

  /** Loads the buffer views of the property tables too, which the renderer leaves out. */
  override markActiveBufferViews(json: Json, headers: BufferViewHeader[]): void {
    super.markActiveBufferViews(json, headers);
    this.json = json;
    const tables = Array.isArray(json.propertyTables) ? (json.propertyTables as unknown[]) : [];
    for (const table of tables) {
      const columns = isObject(table) && isObject(table.properties) ? table.properties : {};
      for (const column of Object.values(columns)) {
        if (!isObject(column)) continue;
        for (const key of ['values', 'arrayOffsets', 'stringOffsets']) {
          const header = typeof column[key] === 'number' ? headers[column[key]] : undefined;
          if (!header) continue;
          header.isActive = true;
          header.bufferHeader.isActive = true;
        }
      }
    }
  }

  override parseActiveBufferViews(
    headers: BufferViewHeader[],
    buffers: unknown,
  ): Record<number, Uint8Array> {
    const views = super.parseActiveBufferViews(headers, buffers);
    const tables = this.json.propertyTables;
    if (Array.isArray(tables) && tables.length > 0) this.tables = { tables, views };
    return views;
  }

  override expandSubtree(subtreeRoot: { children: object[] }, subtree: unknown): void {
    const before = subtreeRoot.children.length;
    super.expandSubtree(subtreeRoot, subtree);
    // The subtree's root, made first: bit 0 of each availability.
    const first = subtreeRoot.children[before] as ImplicitTile | undefined;
    if (!first) return;
    this.note(first, subtree, 0);
    if (isObject(this.json.subtreeMetadata)) first.subtreeMetadata = this.json.subtreeMetadata;
  }

  override deriveChildTile(
    subtree: unknown,
    parentTile: object,
    childBitIndex: number | null,
    childMortonIndex: number,
  ): object {
    const tile = super.deriveChildTile(subtree, parentTile, childBitIndex, childMortonIndex);
    if (subtree && childBitIndex !== null) this.note(tile as ImplicitTile, subtree, childBitIndex);
    return tile;
  }

  private note(tile: ImplicitTile, subtree: unknown, bit: number): void {
    const { _tileAvailability: tiles, _contentAvailabilityBitstreams: streams = [] } = subtree as {
      _tileAvailability?: unknown;
      _contentAvailabilityBitstreams?: unknown[];
    };
    tile.availableContents = streams.flatMap((stream, i) => (this.getBit(stream, bit) ? [i] : []));
    const tables = this.tables;
    if (!tables) return;
    // A table has a row for each tile, or content, that is there, in the order of their bits.
    const at = (table: unknown, stream: unknown): TableRow | undefined =>
      typeof table === 'number' && this.getBit(stream, bit)
        ? { tables, table, row: this.rank(stream, bit) }
        : undefined;
    tile.tileRow = at(this.json.tileMetadata, tiles);
    const contents = Array.isArray(this.json.contentMetadata) ? this.json.contentMetadata : [];
    tile.contentRows = streams.map((stream, i) => at(contents[i], stream));
  }

  /** How many bits of `stream` are set before `bit`. */
  private rank(stream: unknown, bit: number): number {
    if (isObject(stream) && stream.constant !== undefined) return stream.constant ? bit : 0;
    let counts = this.ranks.get(stream);
    if (!counts) this.ranks.set(stream, (counts = [0]));
    for (let i = counts.length; i <= bit; i++) {
      counts.push(counts[i - 1] + (this.getBit(stream, i - 1) ? 1 : 0));
    }
    return counts[bit];
  }
}

export class NightmeshImplicitTilingPlugin extends Base {
  override preprocessNode(
    tile: ImplicitTile,
    tilesetDir: string,
    parent: ImplicitTile | null,
  ): void {
    const legacy = tile.extensions?.[LEGACY];
    if (!tile.implicitTiling && isObject(legacy)) tile.implicitTiling = fromLegacy(legacy);
    super.preprocessNode(tile, tilesetDir, parent);
    // A root of metadata alone: the renderer reads its subtree only through its content, which
    // is that subtree's address until it reads it as a subtree (`preprocessURL`).
    const subtrees = tile.implicitTiling?.subtrees;
    if (
      tile.implicitTiling &&
      !tile.content &&
      severalContents(tile as unknown as Json).length === 0
    ) {
      tile.content = { uri: isObject(subtrees) ? subtrees.uri : undefined };
      tile.withoutContent = true;
      tile.internal.hasContent = true;
    }
  }

  parseTile(content: unknown, tile: ImplicitTile, extension: string): Promise<void> | null {
    let buffer: ArrayBuffer;
    if (/^subtree$/i.test(extension) && content instanceof ArrayBuffer) {
      buffer = content;
    } else if (
      // A JSON file with a root is an external tileset, which the renderer reads itself.
      extension === 'json' &&
      isObject(content) &&
      !('root' in content) &&
      leadsToJsonSubtree(tile)
    ) {
      buffer = binarySubtree(content);
    } else {
      return null;
    }
    const loader = new ContentsSubtreeLoader(tile);
    loader.workingPath = tile.internal.basePath;
    loader.fetchOptions = this.tiles.fetchOptions;
    return loader.parse(buffer);
  }

  /** Lets a JSON subtree's tiles go with it, as the renderer's plugin does for binary ones. */
  override disposeTile(tile: ImplicitTile): void {
    super.disposeTile(tile);
    if (!leadsToJsonSubtree(tile)) return;
    const queue = (this.tiles as unknown as { processNodeQueue?: { remove(item: object): void } })
      .processNodeQueue;
    for (const child of tile.children) queue?.remove(child);
    tile.children.length = 0;
  }
}
