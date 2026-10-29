// A clicked feature of a 3D Tiles tile, read from the tile's feature and batch tables with the
// 3D Tiles renderer's own readers: binary properties and the batch table hierarchy included.
import { BatchTable } from '3d-tiles-renderer/src/core/renderer/utilities/BatchTable.js';
import { FeatureTable } from '3d-tiles-renderer/src/core/renderer/utilities/FeatureTable.js';
import type { TileTablesBytes } from '../../shared/protocol';
import type { FeatureKind } from './picking';

/** A tile's tables, as the renderer's loaders attach them to a tile they load. */
export interface TileTables {
  feature: FeatureTable;
  batch: BatchTable;
}

/** A feature and what the batch table says about it, property by property. */
export interface Feature {
  /** Its batch id, which numbers the batch table's rows. */
  id: number;
  /** How many features the tile has. */
  count: number;
  properties: FeatureProperty[];
}

export interface FeatureProperty {
  name: string;
  value: unknown;
  /** The class of the batch table hierarchy the property comes from, if it does. */
  className?: string;
}

const HIERARCHY = '3DTILES_batch_table_hierarchy';

/** The tables of a tile file, from the bytes the host sent. */
export function tablesFromBytes({ feature, batch }: TileTablesBytes): TileTables {
  const own = (bytes: Uint8Array) =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const featureTable = new FeatureTable(
    own(feature.bytes),
    0,
    feature.json,
    feature.bytes.length - feature.json,
  );
  return {
    feature: featureTable,
    batch: new BatchTable(
      own(batch.bytes),
      batchLength(featureTable),
      0,
      batch.json,
      batch.bytes.length - batch.json,
    ),
  };
}

/**
 * How many features a tile has: one for each instance of an i3dm tile, whose BATCH_IDs number
 * rows below INSTANCES_LENGTH (as CesiumJS reads them); BATCH_LENGTH for a pnts tile whose points
 * name their feature by BATCH_ID, else one for each point; BATCH_LENGTH for b3dm.
 */
function batchLength(table: FeatureTable): number {
  const header = table.header as Record<string, unknown>;
  const name =
    header.INSTANCES_LENGTH !== undefined
      ? 'INSTANCES_LENGTH'
      : header.POINTS_LENGTH !== undefined && header.BATCH_ID === undefined
        ? 'POINTS_LENGTH'
        : 'BATCH_LENGTH';
  return count(table.getData(name, 1));
}

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;

/**
 * The feature an instance, point or batch id names, as the tile's tables say; undefined when
 * the tables don't have it.
 */
export function featureOf(
  tables: TileTables,
  kind: FeatureKind,
  index: number,
): Feature | undefined {
  const id = batchId(tables.feature, kind, index);
  const total = tables.batch.count;
  if (id === undefined || !(id >= 0 && id < total)) return undefined;
  const properties: FeatureProperty[] = [];
  const header = tables.batch.header as Record<string, unknown>;
  let classes: unknown;
  try {
    for (const name of tables.batch.getKeys()) {
      if (name !== 'extras')
        properties.push({ name, value: valueOf(tables.batch, header[name], name, id) });
    }
    // The hierarchy gives each class the feature is, or is under, its own properties.
    const hierarchy = (tables.batch as unknown as { extensions: Record<string, unknown> })
      .extensions[HIERARCHY] as { getDataFromId(id: number, target: object): unknown } | undefined;
    classes = hierarchy?.getDataFromId(id, {});
  } catch {
    return undefined;
  }
  if (classes && typeof classes === 'object') {
    for (const [className, values] of Object.entries(classes as Record<string, unknown>)) {
      if (!values || typeof values !== 'object') continue;
      for (const [name, value] of Object.entries(values as Record<string, unknown>)) {
        properties.push({ name, value, className });
      }
    }
  }
  return { id, count: total, properties };
}

/** Components of each value of a binary property, by its type. */
const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/**
 * A property's value for feature `id`: its place in a JSON array, or its components in the binary
 * body, which the renderer reads as one flat array for all features.
 */
function valueOf(batch: BatchTable, definition: unknown, name: string, id: number): unknown {
  const values = batch.getPropertyArray(name) as unknown;
  if (Array.isArray(values)) return values[id];
  if (!ArrayBuffer.isView(values)) return values;
  const type = (definition as { type?: string } | undefined)?.type ?? 'SCALAR';
  const size = COMPONENTS[type] ?? 1;
  const array = values as unknown as ArrayLike<number> & {
    subarray(a: number, b: number): unknown;
  };
  return size === 1
    ? array[id]
    : Array.from(array.subarray(id * size, id * size + size) as ArrayLike<number>);
}

/** The batch id of an instance or point: its BATCH_ID if the tile gives them, else itself. */
function batchId(table: FeatureTable, kind: FeatureKind, index: number): number | undefined {
  if (kind === 'batch') return index;
  const header = table.header as Record<string, unknown>;
  if (header.BATCH_ID === undefined) return index;
  const length = count(
    table.getData(kind === 'instance' ? 'INSTANCES_LENGTH' : 'POINTS_LENGTH', 1),
  );
  if (!(index < length)) return undefined;
  try {
    const ids = table.getData(
      'BATCH_ID',
      length,
      'UNSIGNED_SHORT',
      'SCALAR',
    ) as unknown as ArrayLike<number> | null;
    return ids?.[index];
  } catch {
    return undefined;
  }
}
