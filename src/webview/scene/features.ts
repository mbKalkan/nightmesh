// A clicked feature of a 3D Tiles tile, read from the tile's feature and batch tables with the
// 3D Tiles renderer's own readers: binary properties and the batch table hierarchy included. Also
// what a glTF primitive's EXT_mesh_features and EXT_structural_metadata say at the point clicked,
// and a node's EXT_instance_features for the GPU instance clicked.
import { BatchTable } from '3d-tiles-renderer/src/core/renderer/utilities/BatchTable.js';
import { FeatureTable } from '3d-tiles-renderer/src/core/renderer/utilities/FeatureTable.js';
import type { BufferGeometry, Mesh, Object3D, Points } from 'three';
import type { TileTablesBytes } from '../../shared/protocol';
import { probedNumber, type FeatureKind, type Probe, type ProbeHit } from './picking';
import {
  featureProbe,
  propertyProbe,
  surfaceMetadata,
  VERTEX,
  type FeatureIdSet,
  type MetadataProperty,
  type StructuralMetadata,
} from './surface';

/** A tile's tables, as the renderer's loaders attach them to a tile they load. */
export interface TileTables {
  feature: FeatureTable;
  batch: BatchTable;
}

/**
 * What the metadata says about a point clicked, property by property: a feature of a batch table
 * (`batch`, by batch id) or of a primitive's feature ID set (`feature`), the texels of a property
 * texture (`texture`), or the vertex or point of property attributes.
 */
export interface Feature {
  source: 'batch' | 'feature' | 'texture' | 'vertex' | 'point';
  /** Its number: the batch id or feature ID, or the vertex's. */
  id?: number;
  /** How many features, vertices or points there are. */
  count?: number;
  /** A feature ID set's label, or its number when a primitive has several. */
  label?: string;
  /** The metadata class the properties are of. */
  className?: string;
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
export function tablesFromBytes({
  feature,
  batch,
  batchLength: stated,
}: TileTablesBytes): TileTables {
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
      stated ?? batchLength(featureTable),
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
  return { source: 'batch', id, count: total, properties };
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

/** The renderer's reading of a property, on the properties of its property sets. */
interface ReadableProperty extends MetadataProperty {
  valueLength: number;
  default: unknown;
  shapeToProperty(target: unknown): unknown;
  readDataFromBuffer(buffer: ArrayLike<unknown>, index: number, target: unknown): unknown;
  adjustValueScaleOffset(target: unknown): unknown;
  resolveEnumsToStrings(target: unknown): unknown;
  resolveNoData(target: unknown): unknown;
  resolveDefault(target: unknown): unknown;
}

/**
 * What a primitive's EXT_mesh_features and EXT_structural_metadata say at the point the picker
 * probed: each feature ID set's feature, with its property table row; each property texture's
 * values; the property attributes of the vertex or point.
 */
export function surfaceFeatures(hit: ProbeHit): Feature[] {
  const surface = surfaceMetadata(hit.object);
  if (!surface) return [];
  const { features, metadata } = surface;
  const result: Feature[] = [];
  const sets = features?.featureIds ?? [];
  sets.forEach((set, index) => {
    const id = featureId(set, featureProbe(set, features!.textures), hit.bytes);
    if (id === undefined) return;
    const label = set.label ?? (sets.length > 1 ? String(index + 1) : undefined);
    result.push(tableFeature(metadata, set.propertyTable, id, set.featureCount, label));
  });
  for (const set of metadata?.textureAccessors ?? []) {
    const properties: FeatureProperty[] = [];
    for (const [name, property] of readable(set.properties)) {
      const given = name in set.definition.properties;
      const texel = given ? hit.bytes.get(propertyProbe(set, property)?.key ?? '') : undefined;
      const value = given ? texel && texelValue(property, texel) : defaultValue(property);
      if (value !== undefined) properties.push({ name, value: plain(value) });
    }
    if (properties.length > 0) {
      result.push({ source: 'texture', className: set.definition.class, properties });
    }
  }
  const vertex = probedNumber(hit.bytes.get(VERTEX.key));
  const geometry = (hit.object as Partial<Mesh>).geometry;
  if (vertex !== undefined && geometry && metadata?.attributeAccessors.length) {
    const count = geometry.getAttribute('position')?.count;
    const source = (hit.object as Partial<Points>).isPoints ? 'point' : 'vertex';
    for (const set of metadata.attributeAccessors) {
      const properties: FeatureProperty[] = [];
      for (const [name, property] of readable(set.properties)) {
        const given = name in set.definition.properties;
        const value = given ? attributeValue(property, geometry, vertex) : defaultValue(property);
        if (value !== undefined) properties.push({ name, value: plain(value) });
      }
      result.push({ source, id: vertex, count, className: set.definition.class, properties });
    }
  }
  return result;
}

/**
 * Feature `id` of a feature ID set, with its row of the property table the set names, if the
 * table has it.
 */
function tableFeature(
  metadata: StructuralMetadata | undefined,
  tableIndex: number | null | undefined,
  id: number,
  count: number | undefined,
  label: string | undefined,
): Feature {
  const feature: Feature = { source: 'feature', id, count, label, properties: [] };
  const table = tableIndex == null ? undefined : metadata?.tableAccessors[tableIndex];
  if (table && id < (table.count ?? 0)) {
    feature.className = table.definition.class;
    for (const name of Object.keys(table.properties)) {
      try {
        feature.properties.push({ name, value: plain(table.getPropertyValue(name, id)) });
      } catch {
        // A value the renderer can't read, such as a number its enum doesn't name, is left out.
      }
    }
  }
  return feature;
}

/**
 * What a node's EXT_instance_features says of GPU instance `instance` of `object`: each feature
 * ID set's feature, from the set's `_FEATURE_ID_n` instance attribute or else the instance's
 * own number, with its property table row.
 */
export function instanceFeatures(object: Object3D, instance: number): Feature[] {
  const sets = object.userData.instanceFeatures as unknown;
  if (!Array.isArray(sets)) return [];
  // The renderer's metadata plugin gives it to each primitive's mesh, and to the scene.
  let metadata: StructuralMetadata | undefined;
  for (let above: Object3D | null = object; above && !metadata; above = above.parent) {
    metadata = above.userData.structuralMetadata as StructuralMetadata | undefined;
  }
  const result: Feature[] = [];
  sets.forEach((set: unknown, index) => {
    if (!set || typeof set !== 'object') return;
    const { featureCount, attribute, propertyTable, label, nullFeatureId } = set as Record<
      string,
      unknown
    >;
    const values = Number.isInteger(attribute)
      ? (object as Partial<Mesh>).geometry?.getAttribute(`_FEATURE_ID_${attribute as number}`)
      : undefined;
    if (attribute !== undefined && !values) return;
    const value = values ? values.getX(instance) : instance;
    if (!Number.isFinite(value) || value < 0 || value === nullFeatureId) return;
    const name =
      typeof label === 'string' ? label : sets.length > 1 ? String(index + 1) : undefined;
    const count = Number.isInteger(featureCount) ? (featureCount as number) : undefined;
    const table = Number.isInteger(propertyTable) ? (propertyTable as number) : undefined;
    result.push(tableFeature(metadata, table, Math.round(value), count, name));
  });
  return result;
}

const readable = (properties: Record<string, MetadataProperty>) =>
  Object.entries(properties) as [string, ReadableProperty][];

/** A feature ID set's feature at the point, unless it is the set's null feature ID. */
function featureId(
  set: FeatureIdSet,
  probe: Probe | undefined,
  bytes: Map<string, Uint8Array>,
): number | undefined {
  const read = probe && bytes.get(probe.key);
  if (!read) return undefined;
  // A texture's channels hold the ID's bytes, low byte first.
  const id = set.texture
    ? set.texture.channels.reduce((sum, channel, i) => sum + (read[channel] ?? 0) * 256 ** i, 0)
    : probedNumber(read);
  return id === undefined || id === set.nullFeatureId ? undefined : id;
}

/** A property's value from the texel it is stored in, as the renderer reads it. */
function texelValue(property: ReadableProperty, texel: Uint8Array): unknown {
  const Typed = typedArray(property.componentType);
  if (!Typed) return undefined;
  try {
    const read = new Typed(property.valueLength * (property.count || 1));
    const bytes = new Uint8Array(read.buffer);
    (property.channels ?? [0]).forEach((channel, i) => {
      if (i < bytes.length) bytes[i] = texel[channel] ?? 0;
    });
    const shaped = property.shapeToProperty(null);
    const value = Array.isArray(shaped)
      ? shaped.map((element, i) => property.readDataFromBuffer(read, i, element))
      : property.readDataFromBuffer(read, 0, shaped);
    return finish(property, value);
  } catch {
    return undefined;
  }
}

/**
 * A property's value at a vertex, from its attribute. Matrices are read here: the renderer's
 * reader of them never ends.
 */
function attributeValue(property: ReadableProperty, geometry: BufferGeometry, vertex: number) {
  try {
    const name = property.attribute?.toLowerCase();
    const attribute = name ? geometry.getAttribute(name) : undefined;
    if (!attribute?.array || vertex >= attribute.count) return undefined;
    const components = Array.from({ length: attribute.itemSize }, (_, i) =>
      attribute.getComponent(vertex, i),
    );
    const { type } = property;
    if (type.startsWith('MAT') || type.startsWith('VEC')) {
      const shaped = property.shapeToProperty(null) as { fromArray(array: number[]): unknown };
      return finish(property, shaped.fromArray(components));
    }
    return type === 'SCALAR' || type === 'ENUM' ? finish(property, components[0]) : undefined;
  } catch {
    return undefined;
  }
}

/** A property the set doesn't give: its class's default, if it has one. */
function defaultValue(property: ReadableProperty): unknown {
  if (property.default === null || property.default === undefined) return undefined;
  try {
    return property.resolveDefault(property.shapeToProperty(null));
  } catch {
    return undefined;
  }
}

/** Offset and scale, enum names and no-data values, as the renderer applies them. */
function finish(property: ReadableProperty, value: unknown): unknown {
  return property.resolveNoData(
    property.resolveEnumsToStrings(property.adjustValueScaleOffset(value)),
  );
}

function typedArray(componentType: string | null) {
  switch (componentType) {
    case 'INT8':
      return Int8Array;
    case 'UINT8':
      return Uint8Array;
    case 'INT16':
      return Int16Array;
    case 'UINT16':
      return Uint16Array;
    case 'INT32':
      return Int32Array;
    case 'UINT32':
      return Uint32Array;
    case 'INT64':
      return BigInt64Array;
    case 'UINT64':
      return BigUint64Array;
    case 'FLOAT32':
      return Float32Array;
    case 'FLOAT64':
      return Float64Array;
    default:
      return undefined;
  }
}

/**
 * A value as the inspector shows it: vectors and matrices as their numbers, 64-bit integers as
 * numbers while they are exact, else as text.
 */
function plain(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  if (Array.isArray(value)) return value.map(plain);
  if (!value || typeof value !== 'object') return value;
  const math = value as { toArray?(): number[]; elements?: ArrayLike<number> };
  if (typeof math.toArray === 'function') return math.toArray();
  return math.elements ? Array.from(math.elements) : value;
}
