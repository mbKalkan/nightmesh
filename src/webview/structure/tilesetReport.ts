// A tileset's reference for a chat with an AI assistant, and its report: what the inspector says
// about the tileset, then its tiles, the way a glTF model's are made (D-013, D-030).
import type { ViewerStrings } from '../../shared/protocol';
import { fill } from './format';
import type { EntryKey } from './outline';
import { detailsOf, type Reference } from './reference';
import { cell, code, escape, rowText } from './report';
import {
  inspectTileset,
  tilePath,
  type TileInfo,
  type TilesetContext,
  type TilesetModel,
} from './tileset';

/** Tiles listed in a report, from the root down: past these, a tileset is better read in its JSON. */
const REPORT_TILES = 1000;

/**
 * A reference to `key`: a tile by its path and first content, with where the tileset's JSON has
 * it, such as `tile 0/3 "east/tileset.json" (root.children[3])`; nothing more for the tileset
 * itself, whose file says it all. With `details`, the inspector's sections as a plain list.
 */
export function tilesetReference(
  context: TilesetContext,
  key: EntryKey,
  locale: string,
  details: boolean,
): Reference | undefined {
  const inspection = inspectTileset(context, key);
  if (!inspection) return undefined;
  const tile = context.model.tiles.get(tilePath(key) ?? '');
  let location: string | undefined;
  if (tile) {
    const content = tile.contents[0]?.uri;
    location = `${context.strings.tile.toLocaleLowerCase(locale)} ${tile.path}`;
    if (content !== undefined) location += ` ${JSON.stringify(content)}`;
    // Tiles of external tilesets and implicit tiling aren't in this file's JSON.
    if (!tile.found) location += ` (${jsonPath(tile.path)})`;
  }
  return { location, details: details ? detailsOf(inspection, false) : undefined };
}

/** Where the tileset's JSON has the tile at `path`: `0/3/1` is `root.children[3].children[1]`. */
export function jsonPath(path: string): string {
  return [
    'root',
    ...path
      .split('/')
      .slice(1)
      .map((index) => `children[${index}]`),
  ].join('.');
}

/** The tiles from the root down, each before those below it, up to `limit`. */
function tilesInOrder(model: TilesetModel, limit: number): TileInfo[] {
  const ordered: TileInfo[] = [];
  const stack = model.root ? [model.root] : [];
  while (stack.length > 0 && ordered.length < limit) {
    const tile = stack.pop()!;
    ordered.push(tile);
    for (let i = tile.children.length - 1; i >= 0; i--) {
      const child = model.tiles.get(tile.children[i]);
      if (child) stack.push(child);
    }
  }
  return ordered;
}

/**
 * A report on the tileset, to save next to it or share: what the inspector says about it, then
 * its tiles from the root down, with those the renderer had found in external tilesets and
 * implicit tiling by then. Markdown for people, in the user's language; JSON for tools.
 */
export function tilesetReport(
  context: TilesetContext,
  strings: ViewerStrings,
): { markdown: string; json: string } {
  const { model, format } = context;
  const words = context.strings;
  const { labels } = words;
  const tiles = tilesInOrder(model, REPORT_TILES);
  const more = model.tiles.size - tiles.length;

  const lines = [`# ${escape(context.fileName)}`, '', `_${strings.report.generated}_`];
  for (const section of inspectTileset(context, 'model')?.sections ?? []) {
    lines.push('', `## ${escape(section.title)}`, '');
    for (const row of section.rows) lines.push(`- ${rowText(row)}`);
  }
  lines.push('', `## ${words.tree}`, '');
  const head = [labels.path, words.sections.content, labels.geometricError, labels.refine];
  lines.push(`| ${head.join(' | ')} |`, '| --- | --- | ---: | --- |');
  for (const tile of tiles) {
    const row = [
      code(tile.path),
      tile.contents.map((content) => escape(content.uri)).join(', '),
      tile.geometricError === undefined ? '' : format.value(tile.geometricError),
      tile.refine ?? '',
    ];
    lines.push(`| ${row.map(cell).join(' | ')} |`);
  }
  if (more > 0) lines.push('', fill(strings.structure.labels.more, format.count(more)));

  const counts = model.counts();
  const json = {
    file: { name: context.fileName, bytes: context.fileSize },
    asset: {
      version: model.version ?? null,
      tilesetVersion: model.tilesetVersion ?? null,
      generator: model.generator ?? null,
    },
    geometricError: model.geometricError ?? null,
    extensionsUsed: model.extensionsUsed,
    extensionsRequired: model.extensionsRequired,
    tiles: { ...counts, depth: model.depth + (counts.tiles > 0 ? 1 : 0) },
    live: context.live?.stats() ?? null,
    tileList: tiles.map((tile) => ({
      path: tile.path,
      contents: tile.contents.map((content) => ({ uri: content.uri, kind: content.kind })),
      geometricError: tile.geometricError ?? null,
      refine: tile.refine ?? null,
      found: tile.found,
      ...(tile.coordinates ? { coordinates: tile.coordinates } : {}),
    })),
    tilesLeftOut: more,
  };
  return {
    markdown: `${lines.join('\n')}\n`,
    json: `${JSON.stringify(json, null, 2)}\n`,
  };
}
