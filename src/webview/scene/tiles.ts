// 3D Tiles (D-046): 3DTilesRendererJS walks the tile tree, picks the tiles the camera needs by
// their screen-space error and keeps a cache of them in memory. Every tile comes from the host:
// URLs only name tiles, under a made-up origin, so references in a tileset resolve as the
// specification says; nothing is fetched from the network, which the webview may not reach.
import { TilesRenderer } from '3d-tiles-renderer/three';
import { GLTFExtensionsPlugin, ReorientationPlugin } from '3d-tiles-renderer/three/plugins';
import { Matrix4, Sphere } from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { Decoders } from './modelView';
import { instanceFeaturesPlugin } from './gltf';
import { NightmeshImplicitTilingPlugin } from './implicitTiling';
import { MultipleContentsPlugin } from './multipleContents';

/** Asks the host for the tile at `path`; rejects with the reason it can't be had. */
export type TileFetcher = (path: string) => Promise<Uint8Array>;

const ORIGIN = 'nightmesh-tiles://tileset';

/** Tiles kept in memory, whether drawn or not, before the ones least used lately go. */
const CACHE_BYTES = 512 * 1024 * 1024;

/** Asks for the tiles of the tileset shown: a viewer shows one at a time. */
let shownTiles: TileFetcher | undefined;

/**
 * What the loaders of tiles fetch themselves, past the plugin below: the glTF model an i3dm tile
 * names, the buffers and images of a .gltf tile, `data:` URIs. They come from the host, or out
 * of the URI, as tiles do; anything else goes to the page's fetch, which the policy stops.
 */
const pageFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return url.startsWith(ORIGIN) || /^data:/i.test(url)
    ? hostResponse(url, shownTiles)
    : pageFetch(input, init);
};

async function hostResponse(url: string, fetchTile: TileFetcher | undefined): Promise<Response> {
  if (/^data:/i.test(url)) return new Response(dataUriBytes(url));
  if (!fetchTile) throw new Error('No tileset is shown');
  return new Response((await fetchTile(new URL(url).pathname)) as Uint8Array<ArrayBuffer>);
}

/** The bytes of a `data:` URI, which the webview's policy doesn't let it fetch. */
function dataUriBytes(uri: string): Uint8Array<ArrayBuffer> {
  const comma = uri.indexOf(',');
  if (comma < 0) throw new Error('Not a data: URI');
  const data = uri.slice(comma + 1);
  if (!/;base64$/i.test(uri.slice(0, comma)))
    return new TextEncoder().encode(decodeURIComponent(data));
  return Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
}

/**
 * The renderer for the tileset at `url`, a path as the host gave it, whose JSON is `json`. It
 * puts a tileset on the globe at the origin, with up as +Y, east as +X and south as +Z; one in a
 * frame of its own around the origin, with its +Z up (D-046). `failed` hears of one of a tile's
 * several contents that couldn't be read; the renderer's `load-error` tells of whole tiles.
 */
export function createTiles(
  url: string,
  json: string,
  fetchTile: TileFetcher,
  decoders: Decoders,
  failed: (url: string, error: unknown) => void,
): TilesRenderer {
  const rootUrl = `${ORIGIN}${url}`;
  const tiles = new TilesRenderer(rootUrl);
  tiles.lruCache.maxBytesSize = CACHE_BYTES;
  shownTiles = fetchTile;
  // First: the tile it makes for several contents is its own to read, not the host's.
  tiles.registerPlugin(
    new MultipleContentsPlugin(
      async (at) => (await hostResponse(at, fetchTile)).arrayBuffer(),
      failed,
    ),
  );
  tiles.registerPlugin({
    name: 'NIGHTMESH_HOST',
    fetchData: (requested: string) =>
      requested === rootUrl
        ? Promise.resolve(new Response(json))
        : hostResponse(requested, fetchTile),
  });
  tiles.registerPlugin(new NightmeshImplicitTilingPlugin());
  tiles.registerPlugin(
    new GLTFExtensionsPlugin({
      rtc: true,
      metadata: true,
      dracoLoader: decoders.draco ?? null,
      ktxLoader: decoders.ktx2 ?? null,
      meshoptDecoder: MeshoptDecoder,
      plugins: [instanceFeaturesPlugin],
    }),
  );
  tiles.registerPlugin(new ReorientationPlugin({ recenter: true }));
  // The plugin puts a tileset on the globe with west as +X and north as +Z: turned around, it is
  // seen from the south as maps are read, and as a tileset in a frame of its own is.
  tiles.addEventListener('load-root-tileset', () => {
    // As the plugin tells: its bounds are far from the Earth's center.
    const sphere = new Sphere();
    if (!tiles.getBoundingSphere(sphere)) return;
    if (sphere.center.length() <= Math.min(...tiles.ellipsoid.radius.toArray()) / 2) return;
    tiles.group.applyMatrix4(new Matrix4().makeRotationY(Math.PI));
  });
  return tiles;
}
