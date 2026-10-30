// A 3D Tiles tileset as its JSON says (D-046): the tile tree, read once, for the tree and the
// inspector; what the renderer has of each tile comes from the view, when asked.
import type { TileContentKind, TileState, TilesetStrings } from '../../shared/protocol';
import { fill, type Formatter } from './format';
import type { Inspection, Row, Section } from './details';
import { tableRow, type PropertyTables } from './propertyTable';
import { implicitContents, severalContents, uriOf } from './tileContents';
import type { EntryKey, OutlineEntry } from './outline';
import {
  entitySection,
  featurePropertiesSection,
  schemaSection,
  statisticsSection,
} from './metadataSections';
import {
  readEntity,
  readGroups,
  readSchema,
  readStatistics,
  type ClassStatistics,
  type MetadataEntity,
  type MetadataSchema,
} from './tilesetMetadata';

/** Tiles in a tileset's own JSON past which the rest aren't listed: nothing real has them. */
const MAX_TILES = 1_000_000;

export type TileVolume =
  | { kind: 'box'; values: number[] }
  | { kind: 'region'; values: number[] }
  | { kind: 'sphere'; values: number[] };

export interface TileInfo {
  /** The indices from the root down, `0` for the root: `0/2/1`. */
  path: string;
  parent?: string;
  children: string[];
  depth: number;
  geometricError?: number;
  refine?: 'ADD' | 'REPLACE';
  /** The refinement is the parent's: the tile says none of its own. */
  inherited: boolean;
  contents: TileContent[];
  metadata?: MetadataEntity;
  /** The metadata of the implicit subtree it is the first tile of. */
  subtreeMetadata?: MetadataEntity;
  volume?: TileVolume;
  transform?: number[];
  requestVolume: boolean;
  implicit?: {
    scheme?: string;
    subtreeLevels?: number;
    availableLevels?: number;
    subtrees?: string;
  };
  /** Not in the tileset's own JSON: from an external tileset or implicit tiling, as read. */
  found: boolean;
  /** Where an implicit tile is in its tree; `z` in an octree only. */
  coordinates?: { level: number; x: number; y: number; z?: number };
}

export interface TileContent {
  uri: string;
  kind: TileContentKind;
  metadata?: MetadataEntity;
  /** The metadata group it is in: its index in 1.1, its ID in 1.0. */
  group?: string;
}

/** What the renderer has of a tile, and of the whole tileset, at the moment. */
export interface TilesLive {
  tile(path: string): { state: TileState; drawn: boolean; error?: number } | undefined;
  stats():
    | { loaded: number; drawn: number; downloading: number; failed: number; bytes: number }
    | undefined;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const num = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const LEGACY = '3DTILES_metadata';
/** 1.0's extension for what 1.1 writes on the tileset, a tile or a content itself. */
const legacy = (json: Json): Json | undefined => {
  const extension = isObject(json.extensions) ? json.extensions[LEGACY] : undefined;
  return isObject(extension) ? extension : undefined;
};
const numbers = (value: unknown, length: number) =>
  Array.isArray(value) && value.length === length && value.every((n) => num(n) !== undefined)
    ? (value as number[])
    : undefined;

export function contentKind(uri: string): TileContentKind {
  const extension = /\.([a-z0-9]+)$/i.exec(uri.replace(/[?#].*$/, ''))?.[1].toLowerCase();
  switch (extension) {
    case 'b3dm':
    case 'i3dm':
    case 'pnts':
    case 'cmpt':
    case 'glb':
    case 'gltf':
      return extension;
    case 'json':
      return 'tileset';
    case 'subtree':
      return 'subtree';
    default:
      return 'other';
  }
}

export class TilesetModel {
  readonly tiles = new Map<string, TileInfo>();
  readonly version?: string;
  readonly tilesetVersion?: string;
  readonly generator?: string;
  readonly geometricError?: number;
  readonly extensionsUsed: string[];
  readonly extensionsRequired: string[];
  private deepest = 0;
  /** The metadata schema: written in the tileset, or read by the host from its own file. */
  readonly schema?: MetadataSchema;
  readonly schemaUri?: string;
  readonly metadata?: MetadataEntity;
  readonly groups: Map<string, MetadataEntity>;
  readonly statistics: ClassStatistics[];
  /** 1.0's ranges of the tiles' batch table properties, by name. */
  readonly featureProperties: { name: string; minimum?: number; maximum?: number }[];

  constructor(json: string, schema?: object) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      parsed = {};
    }
    const tileset = isObject(parsed) ? parsed : {};
    const asset = isObject(tileset.asset) ? tileset.asset : {};
    this.version = typeof asset.version === 'string' ? asset.version : undefined;
    this.tilesetVersion =
      typeof asset.tilesetVersion === 'string' ? asset.tilesetVersion : undefined;
    this.generator = typeof asset.generator === 'string' ? asset.generator : undefined;
    this.geometricError = num(tileset.geometricError);
    const names = (value: unknown) =>
      Array.isArray(value) ? value.filter((name): name is string => typeof name === 'string') : [];
    this.extensionsUsed = names(tileset.extensionsUsed);
    this.extensionsRequired = names(tileset.extensionsRequired);
    const metadata = legacy(tileset) ?? tileset;
    this.schemaUri = typeof metadata.schemaUri === 'string' ? metadata.schemaUri : undefined;
    this.schema = readSchema(metadata.schema ?? schema);
    this.metadata = readEntity(metadata === tileset ? tileset.metadata : metadata.tileset);
    this.groups = readGroups(metadata.groups);
    this.statistics = readStatistics(metadata.statistics);
    this.featureProperties = (
      isObject(tileset.properties) ? Object.entries(tileset.properties) : []
    )
      .filter((entry): entry is [string, Json] => isObject(entry[1]))
      .slice(0, 1000)
      .map(([name, range]) => ({ name, minimum: num(range.minimum), maximum: num(range.maximum) }));
    if (isObject(tileset.root)) this.walk([{ json: tileset.root, path: '0' }], false);
  }

  get root(): TileInfo | undefined {
    return this.tiles.get('0');
  }

  /** Levels of tiles in the tileset's own JSON. */
  get depth(): number {
    return this.deepest;
  }

  /**
   * Lists the tiles the renderer found under the tile at `path`: an external tileset's root, or
   * an implicit subtree. They are its `children` past those the JSON gives it, by their index
   * there, as the renderer's own paths are. What it had found there before goes first: read
   * again, a subtree's tiles are new objects in the same places. False when `path` isn't known.
   */
  addFound(path: string, children: readonly unknown[]): boolean {
    const parent = this.tiles.get(path);
    if (!parent) return false;
    const stale = parent.children.filter((child) => this.tiles.get(child)?.found);
    for (const child of stale) this.remove(child);
    parent.children = parent.children.filter((child) => !stale.includes(child));
    const own = new Set(parent.children);
    const start: { json: Json; path: string; parent: TileInfo }[] = [];
    children.forEach((child, i) => {
      const at = `${path}/${i}`;
      if (!own.has(at) && isObject(child)) start.push({ json: child, path: at, parent });
    });
    this.walk(start.reverse(), true);
    parent.children.sort(byIndex);
    return true;
  }

  /** Reads the tiles on `stack`, last first, and all below them. */
  private walk(stack: { json: Json; path: string; parent?: TileInfo }[], found: boolean): void {
    const added: TileInfo[] = [];
    // Without recursion: a deep tree mustn't run out of stack.
    while (stack.length > 0 && this.tiles.size < MAX_TILES) {
      const { json, path, parent } = stack.pop()!;
      const info = readTile(json, path, parent, found, this.schema);
      this.tiles.set(path, info);
      added.push(info);
      parent?.children.push(path);
      if (!found) this.deepest = Math.max(this.deepest, info.depth);
      const children = Array.isArray(json.children) ? json.children : [];
      for (let i = children.length - 1; i >= 0; i--) {
        if (isObject(children[i]))
          stack.push({ json: children[i] as Json, path: `${path}/${i}`, parent: info });
      }
    }
    // Pushed in reverse to come off in order; children were added as they came off.
    for (const tile of added) tile.children.sort(byIndex);
  }

  /** Takes the tile at `path` and all below it out of the list. */
  private remove(path: string): void {
    const stack = [path];
    while (stack.length > 0) {
      const tile = this.tiles.get(stack.pop()!);
      if (!tile) continue;
      this.tiles.delete(tile.path);
      stack.push(...tile.children);
    }
  }

  /** How many tiles the JSON has of each sort, and how many more the renderer found. */
  counts(): {
    tiles: number;
    withContent: number;
    external: number;
    implicit: number;
    found: number;
  } {
    let [tiles, withContent, external, implicit, found] = [0, 0, 0, 0, 0];
    for (const tile of this.tiles.values()) {
      if (tile.found) {
        found++;
        continue;
      }
      tiles++;
      if (tile.contents.length > 0) withContent++;
      if (tile.contents.some((content) => content.kind === 'tileset')) external++;
      if (tile.implicit) implicit++;
    }
    return { tiles, withContent, external, implicit, found };
  }
}

const byIndex = (a: string, b: string) =>
  Number(a.slice(a.lastIndexOf('/') + 1)) - Number(b.slice(b.lastIndexOf('/') + 1));

function readTile(
  json: Json,
  path: string,
  parent: TileInfo | undefined,
  found: boolean,
  schema: MetadataSchema | undefined,
): TileInfo {
  // A tile of implicit tiling has its metadata, and its contents', in its subtree's tables.
  const fromTable = (at: unknown) =>
    isObject(at) &&
    isObject(at.tables) &&
    typeof at.table === 'number' &&
    typeof at.row === 'number'
      ? tableRow(at.tables as unknown as PropertyTables, at.table, at.row, schema)
      : undefined;
  const contentRows = found && Array.isArray(json.contentRows) ? json.contentRows : [];
  const refine = json.refine === 'ADD' || json.refine === 'REPLACE' ? json.refine : undefined;
  const several = severalContents(json);
  // A tile has one or the other; the renderer gives one with several a `content` of its own,
  // and a tile of implicit tiling it made the first available of its root's.
  const contents = (
    (found ? implicitContents(json) : undefined) ?? (several.length > 0 ? several : [json.content])
  )
    .filter(isObject)
    .flatMap((content): TileContent[] => {
      const uri = uriOf(content);
      if (uri === undefined) return [];
      const old = legacy(content);
      const group = old ? old.group : content.group;
      return [
        {
          uri,
          kind: contentKind(uri),
          metadata:
            readEntity(old ?? content.metadata) ??
            (typeof content.index === 'number' ? fromTable(contentRows[content.index]) : undefined),
          group:
            typeof group === 'string' || (typeof group === 'number' && Number.isInteger(group))
              ? String(group)
              : undefined,
        },
      ];
    });
  const legacyTiling = isObject(json.extensions)
    ? json.extensions['3DTILES_implicit_tiling']
    : undefined;
  // 1.0's extension, which gave the deepest level rather than how many there are.
  const implicit = isObject(json.implicitTiling)
    ? json.implicitTiling
    : isObject(legacyTiling)
      ? { availableLevels: (num(legacyTiling.maximumLevel) ?? NaN) + 1, ...legacyTiling }
      : undefined;
  const subtrees = implicit && isObject(implicit.subtrees) ? implicit.subtrees.uri : undefined;
  return {
    path,
    parent: parent?.path,
    children: [],
    depth: parent ? parent.depth + 1 : 0,
    geometricError: num(json.geometricError),
    refine: refine ?? parent?.refine,
    inherited: refine === undefined && parent?.refine !== undefined,
    contents,
    metadata:
      readEntity(legacy(json) ?? json.metadata) ?? (found ? fromTable(json.tileRow) : undefined),
    subtreeMetadata: found ? readEntity(json.subtreeMetadata) : undefined,
    volume: volumeOf(json.boundingVolume),
    transform: numbers(json.transform, 16),
    requestVolume: isObject(json.viewerRequestVolume),
    implicit: implicit && {
      scheme:
        typeof implicit.subdivisionScheme === 'string' ? implicit.subdivisionScheme : undefined,
      subtreeLevels: num(implicit.subtreeLevels),
      availableLevels: num(implicit.availableLevels),
      subtrees: typeof subtrees === 'string' ? subtrees : undefined,
    },
    found,
    coordinates: found ? implicitCoordinates(json) : undefined,
  };
}

/** Where the renderer put a tile it made for implicit tiling, in its tree. */
function implicitCoordinates(json: Json): TileInfo['coordinates'] {
  const data = isObject(json.implicitTilingData) ? json.implicitTilingData : undefined;
  if (!data) return undefined;
  const [level, x, y, z] = [num(data.level), num(data.x), num(data.y), num(data.z)];
  if (level === undefined || x === undefined || y === undefined) return undefined;
  const root = isObject(data.root) ? data.root : {};
  const tiling = isObject(root.implicitTiling) ? root.implicitTiling : {};
  return { level, x, y, z: tiling.subdivisionScheme === 'OCTREE' ? z : undefined };
}

function volumeOf(value: unknown): TileVolume | undefined {
  if (!isObject(value)) return undefined;
  const box = numbers(value.box, 12);
  if (box) return { kind: 'box', values: box };
  const region = numbers(value.region, 6);
  if (region) return { kind: 'region', values: region };
  const sphere = numbers(value.sphere, 4);
  if (sphere) return { kind: 'sphere', values: sphere };
  return undefined;
}

export const tileKey = (path: string): EntryKey => `tile:${path}`;
export const tilePath = (key: EntryKey): string | undefined =>
  key.startsWith('tile:') ? key.slice(5) : undefined;

/** What a tile is called in the tree: its content, or `Tile 0/2` without any. */
export function tileLabel(tile: TileInfo, strings: TilesetStrings): string {
  const first = tile.contents[0];
  if (!first) return `${strings.tile} ${tile.path}`;
  let uri = first.uri;
  try {
    uri = decodeURIComponent(uri);
  } catch {
    // Shown as written.
  }
  return tile.contents.length > 1 ? `${uri} +${tile.contents.length - 1}` : uri;
}

/** The tree: the tileset itself, then its tiles from the root down. */
export function tilesetOutline(
  model: TilesetModel,
  fileName: string,
  strings: TilesetStrings,
): OutlineEntry[] {
  const entry = (tile: TileInfo): OutlineEntry => ({
    key: tileKey(tile.path),
    label: tileLabel(tile, strings),
    description: tile.contents.length > 0 ? tile.path : undefined,
    icon: 'tile',
    children:
      tile.children.length > 0
        ? () => tile.children.map((path) => entry(model.tiles.get(path)!))
        : undefined,
  });
  const root = model.root;
  return [{ key: 'model', label: fileName, icon: 'model' }, ...(root ? [entry(root)] : [])];
}

/** The tiles above `key`, from the root down, to open in the tree. */
export function tileAncestors(model: TilesetModel, key: EntryKey): EntryKey[] {
  const above: EntryKey[] = [];
  for (let tile = model.tiles.get(tilePath(key) ?? ''); tile?.parent !== undefined;) {
    above.unshift(tileKey(tile.parent));
    tile = model.tiles.get(tile.parent);
  }
  return above;
}

export interface TilesetContext {
  model: TilesetModel;
  fileName: string;
  fileSize: number;
  strings: TilesetStrings;
  fileSizeLabel: string;
  format: Formatter;
  live?: TilesLive;
}

/** What the inspector shows for the tileset or one of its tiles. */
export function inspectTileset(context: TilesetContext, key: EntryKey): Inspection | undefined {
  if (key === 'model') return inspectModel(context);
  const tile = context.model.tiles.get(tilePath(key) ?? '');
  return tile && inspectTile(context, tile);
}

function inspectModel(context: TilesetContext): Inspection {
  const { model, strings, format } = context;
  const { labels } = strings;
  const counts = model.counts();
  const rows = (pairs: [string, string | undefined][]): Row[] =>
    pairs.flatMap(([label, text]) => (text === undefined ? [] : [{ label, text }]));
  const sections: Section[] = [
    {
      title: strings.sections.tileset,
      rows: rows([
        [context.fileSizeLabel, format.bytes(context.fileSize)],
        [labels.version, model.version],
        [labels.tilesetVersion, model.tilesetVersion],
        [labels.generator, model.generator],
        [
          labels.geometricError,
          model.geometricError === undefined ? undefined : format.value(model.geometricError),
        ],
        [labels.extensionsUsed, model.extensionsUsed.join(', ') || undefined],
        [labels.extensionsRequired, model.extensionsRequired.join(', ') || undefined],
      ]),
    },
    ...(model.metadata
      ? [
          entitySection(
            strings.metadata.section,
            model.metadata,
            model.schema,
            strings.metadata,
            format,
          ),
        ]
      : []),
    {
      title: strings.sections.tiles,
      rows: rows([
        [labels.tiles, format.count(counts.tiles)],
        [labels.depth, format.count(model.depth + (counts.tiles > 0 ? 1 : 0))],
        [labels.withContent, format.count(counts.withContent)],
        [labels.externalTilesets, counts.external ? format.count(counts.external) : undefined],
        [labels.implicitRoots, counts.implicit ? format.count(counts.implicit) : undefined],
        [labels.found, counts.found ? format.count(counts.found) : undefined],
      ]),
    },
  ];
  const stats = context.live?.stats();
  if (stats) {
    sections.push({
      title: strings.sections.live,
      rows: rows([
        [labels.loaded, format.count(stats.loaded)],
        [labels.drawnTiles, format.count(stats.drawn)],
        [labels.downloading, stats.downloading ? format.count(stats.downloading) : undefined],
        [labels.failed, stats.failed ? format.count(stats.failed) : undefined],
        [labels.memory, format.bytes(stats.bytes)],
      ]),
    });
  }
  const words = strings.metadata;
  if (model.featureProperties.length > 0)
    sections.push(featurePropertiesSection(model.featureProperties, words, format));
  if (model.statistics.length > 0)
    sections.push(statisticsSection(model.statistics, words, format));
  if (model.schema || model.schemaUri !== undefined || model.groups.size > 0) {
    sections.push(schemaSection(model.schema, model.schemaUri, model.groups.size, words, format));
  }
  return { title: context.fileName, kind: strings.tileset, sections };
}

function inspectTile(context: TilesetContext, tile: TileInfo): Inspection {
  const { strings, format } = context;
  const { labels } = strings;
  const sections: Section[] = [];
  const tileRows: Row[] = [{ label: labels.path, text: tile.path, mono: true }];
  if (tile.geometricError !== undefined) {
    tileRows.push({
      label: labels.geometricError,
      text: format.value(tile.geometricError),
      mono: true,
    });
  }
  if (tile.refine) {
    tileRows.push({
      label: labels.refine,
      text: tile.refine,
      mono: true,
      note: tile.inherited ? labels.inherited : undefined,
    });
  }
  if (tile.children.length > 0) {
    tileRows.push({ label: labels.children, text: format.count(tile.children.length) });
  }
  if (tile.requestVolume) tileRows.push({ label: labels.requestVolume, text: labels.yes });
  sections.push({ title: strings.sections.tile, rows: tileRows });
  const { model } = context;
  const words = strings.metadata;
  if (tile.metadata) {
    sections.push(entitySection(words.section, tile.metadata, model.schema, words, format));
  }
  if (tile.subtreeMetadata) {
    sections.push(entitySection(words.subtree, tile.subtreeMetadata, model.schema, words, format));
  }

  if (tile.contents.length > 0) {
    sections.push({
      title: strings.sections.content,
      rows: tile.contents.flatMap((content): Row[] => [
        { label: '', text: content.uri, mono: true, wide: true },
        { label: labels.volumeType, text: strings.contents[content.kind] },
        ...(content.group === undefined
          ? []
          : [{ label: words.groupLabel, text: content.group, mono: true }]),
      ]),
    });
  }
  // Each content's metadata, then the groups they are in, each group once.
  const several = tile.contents.length > 1;
  for (const content of tile.contents) {
    if (!content.metadata) continue;
    const title = several ? fill(words.contentOf, content.uri) : words.content;
    sections.push(entitySection(title, content.metadata, model.schema, words, format));
  }
  for (const id of new Set(tile.contents.map((content) => content.group))) {
    const group = id === undefined ? undefined : model.groups.get(id);
    if (group) {
      sections.push(entitySection(fill(words.group, id!), group, model.schema, words, format));
    }
  }

  if (tile.volume) sections.push(volumeSection(tile.volume, tile.transform, context));

  if (tile.coordinates) {
    const { level, x, y, z } = tile.coordinates;
    sections.push({
      title: strings.sections.implicit,
      rows: [
        { label: labels.level, text: format.count(level), mono: true },
        {
          label: labels.coordinates,
          text: (z === undefined ? [x, y] : [x, y, z]).join(', '),
          mono: true,
        },
      ],
    });
  }
  if (tile.implicit) {
    const { scheme, subtreeLevels, availableLevels, subtrees } = tile.implicit;
    const rows: Row[] = [];
    if (scheme) rows.push({ label: labels.scheme, text: scheme, mono: true });
    if (availableLevels !== undefined)
      rows.push({ label: labels.availableLevels, text: format.count(availableLevels) });
    if (subtreeLevels !== undefined)
      rows.push({ label: labels.subtreeLevels, text: format.count(subtreeLevels) });
    if (subtrees) rows.push({ label: labels.subtrees, text: subtrees, mono: true });
    sections.push({ title: strings.sections.implicit, rows });
  }

  const live = context.live?.tile(tile.path);
  if (live) {
    const rows: Row[] = [
      { label: labels.state, text: strings.states[live.state] },
      { label: labels.drawn, text: live.drawn ? labels.yes : labels.no },
    ];
    if (live.error !== undefined && Number.isFinite(live.error)) {
      rows.push({
        label: labels.screenError,
        text: fill(strings.pixels, format.value(live.error)),
        mono: true,
      });
    }
    sections.push({ title: strings.sections.live, rows });
  }
  return { title: tileLabel(tile, strings), kind: `${strings.tile} ${tile.path}`, sections };
}

function volumeSection(
  volume: TileVolume,
  transform: number[] | undefined,
  context: TilesetContext,
): Section {
  const { strings, format } = context;
  const { labels } = strings;
  const rows: Row[] = [{ label: labels.volumeType, text: strings.volumes[volume.kind] }];
  const v = volume.values;
  if (volume.kind === 'box') {
    rows.push({ label: labels.center, text: format.vector(v.slice(0, 3)), mono: true });
    const half = [0, 3, 6].map((i) => Math.hypot(v[3 + i], v[4 + i], v[5 + i]));
    rows.push({ label: labels.halfAxes, text: format.dimensions(half), mono: true });
  } else if (volume.kind === 'sphere') {
    rows.push({ label: labels.center, text: format.vector(v.slice(0, 3)), mono: true });
    rows.push({ label: labels.radius, text: format.metres(v[3]), mono: true });
  } else {
    const degrees = (radians: number) => format.degrees(radians);
    rows.push(
      { label: labels.west, text: degrees(v[0]), mono: true },
      { label: labels.south, text: degrees(v[1]), mono: true },
      { label: labels.east, text: degrees(v[2]), mono: true },
      { label: labels.north, text: degrees(v[3]), mono: true },
      { label: labels.minHeight, text: format.metres(v[4]), mono: true },
      { label: labels.maxHeight, text: format.metres(v[5]), mono: true },
    );
  }
  if (transform) {
    rows.push({ label: labels.transform, json: JSON.stringify(transform) });
  }
  return { title: strings.sections.volume, rows };
}
