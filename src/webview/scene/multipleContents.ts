// A tile can have several contents: 3D Tiles 1.1's `contents`, or 1.0's 3DTILES_multiple_contents.
// 3DTilesRendererJS reads `content` alone, so this plugin gives such a tile one content of a kind
// of its own, and reads it by reading each of the tile's contents as the renderer would read a
// tile of that kind, then drawing them together.
import { Group, Matrix4, type Object3D } from 'three';
import type { TilesRenderer } from '3d-tiles-renderer/three';
import {
  SEVERAL,
  extensionOf,
  implicitContents,
  severalContents,
  uriOf,
} from '../structure/tileContents';

type Json = Record<string, unknown>;

/** Contents that draw something: external tilesets and subtrees lead to more tiles instead. */
const drawn = (uri: string) => !['json', 'subtree'].includes(extensionOf(uri));

/** The URIs of the contents to read for a tile: its own, or an implicit tile's available ones. */
const contentsOf = (tile: Json): string[] =>
  (implicitContents(tile) ?? severalContents(tile)).flatMap((content) => {
    const uri = uriOf(content);
    return uri === undefined ? [] : [uri];
  });

interface PluginTile extends Json {
  content?: { uri?: string };
  internal: Record<string, unknown>;
}

/** The part of the renderer the plugin uses: reading one content into a scene. */
interface Parser {
  parseTile(
    buffer: ArrayBuffer,
    tile: object,
    extension: string,
    url: string,
    signal: AbortSignal,
  ): Promise<void>;
}

export class MultipleContentsPlugin {
  readonly name = 'NIGHTMESH_MULTIPLE_CONTENTS';
  private tiles: (TilesRenderer & Parser) | undefined;

  /**
   * `fetchBytes` reads a content by its URL; `failed` hears of one that couldn't be read, whose
   * tile draws the others.
   */
  constructor(
    private readonly fetchBytes: (url: string) => Promise<ArrayBuffer>,
    private readonly failed: (url: string, error: unknown) => void,
  ) {}

  init(tiles: TilesRenderer): void {
    this.tiles = tiles as TilesRenderer & Parser;
  }

  preprocessNode(tile: PluginTile): void {
    if (tile.content || !contentsOf(tile).some(drawn)) return;
    tile.content = { uri: `contents.${SEVERAL}` };
    Object.assign(tile.internal, {
      hasContent: true,
      hasRenderableContent: true,
      hasUnrenderableContent: false,
    });
  }

  /** The tile's own content has nothing in it: the renderer asks the plugin for it below. */
  fetchData(url: string): Promise<Response> | null {
    return extensionOf(url) === SEVERAL ? Promise.resolve(new Response(new ArrayBuffer(0))) : null;
  }

  async parseToMesh(
    _buffer: ArrayBuffer,
    tile: PluginTile,
    extension: string,
    url: string,
    signal: AbortSignal,
  ): Promise<Object3D | null> {
    const tiles = this.tiles;
    if (extension !== SEVERAL || !tiles) return null;
    const base = url.slice(0, url.lastIndexOf('/') + 1);
    const scenes = await Promise.all(
      contentsOf(tile)
        .filter(drawn)
        .map(async (uri) => {
          const at = new URL(uri, base).toString();
          // Read as a tile of its own in the tile's frame: the renderer places the tile after.
          const part = { engineData: { transform: new Matrix4() } as { scene?: Object3D } };
          try {
            await tiles.parseTile(await this.fetchBytes(at), part, extensionOf(uri), at, signal);
          } catch (error) {
            this.failed(at, error);
          }
          return part.engineData.scene;
        }),
    );
    const group = new Group();
    for (const scene of scenes) if (scene) group.add(scene);
    return group;
  }
}
