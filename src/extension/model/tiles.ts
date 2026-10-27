// 3D Tiles (D-046): the tileset's JSON is checked and sent whole; the webview walks the tile tree
// itself and asks for each tile as the camera comes near it, by a path relative to the folder the
// viewer may read. Free of VS Code APIs, so the browser tests answer requests as the host does.
import { posix } from 'node:path';
import type { HostToWebviewMessage } from '../../shared/protocol';
import { MAX_JSON_BYTES, sniff, withoutByteOrderMark } from './container';
import type { LoadTexts, ResourceOpener } from './load';
import { relativeInside, resourceName } from './resources';
import type { ByteSource } from './sources';

/** A tile is read into memory whole, to be posted; nothing real comes close to this. */
export const MAX_TILE_BYTES = 512 * 1024 * 1024;

/**
 * What the webview's tile paths start with. Paths are relative to the folder the viewer may
 * read, under this one made-up folder: a reference that climbs out of it resolves to a path
 * without it, which tells it went outside rather than to some other file inside.
 */
export const TILE_FOLDER = '/_/';

/**
 * The folder whose files a tileset's tiles may be, and the tileset's path in it, from posix paths
 * as in VS Code URIs: its workspace folder, or its own folder outside one (D-005). VS Code can
 * name a drive D: in the one and d: in the other.
 */
export function tilesetPlace(path: string, workspace: string): { root: string; path: string } {
  const inside = relativeInside(path, workspace);
  return inside === undefined
    ? { root: posix.dirname(path), path: posix.basename(path) }
    : { root: workspace, path: inside };
}

interface Tileset {
  asset?: { version?: unknown };
  root?: unknown;
}

/** The message that opens a tileset, or the failure that says why it can't be opened. */
export async function tilesetMessage(
  source: ByteSource,
  options: {
    loadId: number;
    reload: boolean;
    texts: LoadTexts;
    /** The tileset's path relative to the folder the viewer may read, with `/` between names. */
    path: string;
  },
): Promise<HostToWebviewMessage> {
  const { loadId, reload, texts } = options;
  const failed = (message: string): HostToWebviewMessage => ({
    type: 'failed',
    loadId,
    reload,
    message,
    details: [],
  });
  const head = await source.read(0, Math.min(64, source.size));
  const kind = sniff(head);
  if (kind === 'empty') return failed(texts.empty);
  if (kind === 'lfsPointer') return failed(texts.lfsPointer);
  if (kind !== 'json' || source.size > MAX_JSON_BYTES) return failed(texts.notTileset);
  const json = withoutByteOrderMark(new TextDecoder().decode(await source.read(0, source.size)));
  let tileset: Tileset;
  try {
    tileset = JSON.parse(json) as Tileset;
  } catch {
    return failed(texts.notTileset);
  }
  const version = tileset?.asset?.version;
  if (typeof version !== 'string' || typeof tileset.root !== 'object' || !tileset.root) {
    return failed(texts.notTileset);
  }
  if (!/^1\.[01]$/.test(version)) return failed(texts.tilesetVersion(version));
  const url = `${TILE_FOLDER}${options.path.split('/').map(encodeURIComponent).join('/')}`;
  return { type: 'tileset', loadId, reload, url, json, fileSize: source.size };
}

/**
 * Reads the tile at `path`, a path the webview made from a tileset's references, or says in a
 * sentence why it can't be had. `open` opens references relative to the folder the viewer may
 * read.
 */
export async function readTile(
  path: string,
  open: ResourceOpener,
  texts: LoadTexts,
): Promise<{ data: Uint8Array } | { problem: string }> {
  const name = resourceName(path);
  if (!path.startsWith(TILE_FOLDER)) return { problem: texts.resource('outside', name) };
  const source = await open(path.slice(TILE_FOLDER.length));
  if (typeof source === 'string') return { problem: texts.resource(source, name) };
  try {
    if (source.size > MAX_TILE_BYTES) return { problem: texts.resource('unreadable', name) };
    const data = await source.read(0, source.size);
    if (sniff(data.subarray(0, 64)) === 'lfsPointer') return { problem: texts.tileLfs(name) };
    return { data };
  } catch {
    return { problem: texts.resource('unreadable', name) };
  } finally {
    await source.close();
  }
}
