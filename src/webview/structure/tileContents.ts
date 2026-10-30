// A tile's contents as written: one `content`, or several (3D Tiles 1.1's `contents`, 1.0's
// 3DTILES_multiple_contents). Read by the tree from the tileset's JSON, and by the renderer's
// plugin for several contents from the renderer's tiles, which are that JSON filled in.

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const list = (value: unknown) => (Array.isArray(value) ? (value as unknown[]) : []);

/** The kind the renderer's plugin gives a tile with several contents: `contents.nmcontents`. */
export const SEVERAL = 'nmcontents';

/** A content's kind by the end of its name, without the query or fragment, in lower case. */
export const extensionOf = (uri: string): string =>
  /\.([a-z0-9]+)$/i.exec(uri.replace(/[?#].*$/, ''))?.[1].toLowerCase() ?? '';

/** A tile's contents past `content`, as written: objects with a `uri` (or an old `url`). */
export function severalContents(tile: Json): Json[] {
  const extension = isObject(tile.extensions)
    ? tile.extensions['3DTILES_multiple_contents']
    : undefined;
  return [
    ...list(tile.contents),
    // Its early drafts named the list `content`.
    ...list(isObject(extension) ? (extension.contents ?? extension.content) : undefined),
  ].filter(isObject);
}

export const uriOf = (content: Json): string | undefined => {
  const uri = content.uri ?? content.url;
  return typeof uri === 'string' ? uri : undefined;
};

/**
 * The contents of a tile of implicit tiling the renderer made: those of the implicit root
 * available there, their templates filled in with where the tile is. Undefined for any other.
 */
export function implicitContents(tile: Json): Json[] | undefined {
  const data = isObject(tile.implicitTilingData) ? tile.implicitTilingData : undefined;
  const root = data && isObject(data.root) ? data.root : undefined;
  // Noted by our subtree loader on the tiles it reads; tiles standing for subtrees have none.
  const available = tile.availableContents;
  if (!data || !root || root === tile || !Array.isArray(available)) return undefined;
  const several = severalContents(root);
  const templates = several.length > 0 ? several : isObject(root.content) ? [root.content] : [];
  const fill = (template: string) =>
    template.replace(/\{(level|x|y|z)\}/g, (_, name: string) => String(data[name]));
  return (available as unknown[]).flatMap((i) => {
    const template = typeof i === 'number' ? templates[i] : undefined;
    const uri = template && uriOf(template);
    return uri === undefined ? [] : [{ ...template, uri: fill(uri) }];
  });
}
