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

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const LEGACY = '3DTILES_implicit_tiling';

export interface ImplicitTile {
  implicitTiling?: Json;
  implicitTilingData?: { root: ImplicitTile; level: number; x: number; y: number; z: number };
  /** The indices of the implicit root's contents available at this tile. */
  availableContents?: number[];
  extensions?: Json;
  content?: { uri?: unknown };
  children: object[];
  internal: { basePath: string };
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

/** The renderer's subtree loader, noting every content available at each tile it makes. */
class ContentsSubtreeLoader extends SUBTREELoader {
  override expandSubtree(subtreeRoot: { children: object[] }, subtree: unknown): void {
    const before = subtreeRoot.children.length;
    super.expandSubtree(subtreeRoot, subtree);
    // The subtree's root, made first: bit 0 of each content's availability.
    const first = subtreeRoot.children[before] as ImplicitTile | undefined;
    if (first) this.note(first, subtree, 0);
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
    const streams = (subtree as { _contentAvailabilityBitstreams?: unknown[] })
      ._contentAvailabilityBitstreams;
    tile.availableContents = (streams ?? []).flatMap((stream, i) =>
      this.getBit(stream, bit) ? [i] : [],
    );
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
