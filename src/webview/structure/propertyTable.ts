// A row of a binary property table, as implicit tiling's subtrees hold the metadata of their
// tiles and contents (3D Tiles 1.1), read as an entity of its class: the values as stored, which
// the inspector then reads as the class says (no data, defaults, normalized, offset and scale,
// enum names), as it does an entity written in a tileset's JSON (D-058).
import type { MetadataEntity, MetadataSchema, SchemaProperty } from './tilesetMetadata';

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Elements of one value past which an array isn't read: nothing real has them. */
const MAX_ELEMENTS = 10_000;

const SIZES: Record<string, number> = {
  INT8: 1,
  UINT8: 1,
  INT16: 2,
  UINT16: 2,
  INT32: 4,
  UINT32: 4,
  INT64: 8,
  UINT64: 8,
  FLOAT32: 4,
  FLOAT64: 8,
};

const COMPONENTS: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

/** A subtree's property tables, and its buffer views by their index. */
export interface PropertyTables {
  tables: unknown[];
  views: Readonly<Record<number, Uint8Array | undefined>>;
}

/** One number of `type` at byte `at` of `view`; 64-bit integers as the nearest double. */
function readNumber(view: Uint8Array, type: string, at: number): number | undefined {
  if (at < 0 || at + (SIZES[type] ?? Infinity) > view.byteLength) return undefined;
  const data = new DataView(view.buffer, view.byteOffset, view.byteLength);
  switch (type) {
    case 'INT8':
      return data.getInt8(at);
    case 'UINT8':
      return data.getUint8(at);
    case 'INT16':
      return data.getInt16(at, true);
    case 'UINT16':
      return data.getUint16(at, true);
    case 'INT32':
      return data.getInt32(at, true);
    case 'UINT32':
      return data.getUint32(at, true);
    case 'INT64':
      return Number(data.getBigInt64(at, true));
    case 'UINT64':
      return Number(data.getBigUint64(at, true));
    case 'FLOAT32':
      return data.getFloat32(at, true);
    case 'FLOAT64':
      return data.getFloat64(at, true);
    default:
      return undefined;
  }
}

/**
 * Row `row` of `table` as an entity of its class; undefined when the table or its class can't be
 * read. Properties the table leaves out are left out, for the class's defaults to show.
 */
export function tableRow(
  tables: PropertyTables,
  table: number,
  row: number,
  schema: MetadataSchema | undefined,
): MetadataEntity | undefined {
  const definition = tables.tables[table];
  if (!isObject(definition) || typeof definition.class !== 'string') return undefined;
  const className = definition.class;
  const count = typeof definition.count === 'number' ? definition.count : 0;
  const type = schema?.classes.get(className);
  if (!type || row < 0 || row >= count) return { className, properties: {} };
  const properties: Json = {};
  const columns = isObject(definition.properties) ? definition.properties : {};
  for (const [name, column] of Object.entries(columns)) {
    const property = type.properties.get(name);
    if (!property || !isObject(column)) continue;
    const value = readValue(tables, column, property, schema!, row);
    if (value !== undefined) properties[name] = value;
  }
  return { className, properties };
}

function readValue(
  { views }: PropertyTables,
  column: Json,
  property: SchemaProperty,
  schema: MetadataSchema,
  row: number,
): unknown {
  const view = (key: string) =>
    typeof column[key] === 'number' ? views[column[key] as number] : undefined;
  const values = view('values');
  if (!values) return undefined;
  const offsetType = (key: string) =>
    typeof column[key] === 'string' ? (column[key] as string) : 'UINT32';

  // Where the row's elements are: by the fixed count, or by the array offsets.
  let first = row;
  let length = 1;
  if (property.array) {
    if (property.count !== undefined) {
      first = row * property.count;
      length = property.count;
    } else {
      const offsets = view('arrayOffsets');
      const type = offsetType('arrayOffsetType');
      const size = SIZES[type] ?? 4;
      const start = offsets && readNumber(offsets, type, row * size);
      const end = offsets && readNumber(offsets, type, (row + 1) * size);
      if (start === undefined || end === undefined || end < start) return undefined;
      first = start;
      length = end - start;
    }
  }
  length = Math.min(length, MAX_ELEMENTS);

  const elements: unknown[] = [];
  if (property.type === 'STRING') {
    const offsets = view('stringOffsets');
    const type = offsetType('stringOffsetType');
    const size = SIZES[type] ?? 4;
    const decoder = new TextDecoder();
    for (let i = first; i < first + length; i++) {
      const start = offsets && readNumber(offsets, type, i * size);
      const end = offsets && readNumber(offsets, type, (i + 1) * size);
      if (start === undefined || end === undefined || end < start || end > values.byteLength)
        return undefined;
      elements.push(decoder.decode(values.subarray(start, end)));
    }
  } else if (property.type === 'BOOLEAN') {
    for (let i = first; i < first + length; i++) {
      const byte = values[i >> 3];
      if (byte === undefined) return undefined;
      elements.push(((byte >> (i & 7)) & 1) === 1);
    }
  } else {
    const component =
      property.type === 'ENUM'
        ? (schema.enumValueTypes.get(property.enumType ?? '') ?? 'UINT16')
        : property.componentType;
    const size = component === undefined ? undefined : SIZES[component];
    const per = property.type === 'ENUM' ? 1 : COMPONENTS[property.type ?? ''];
    if (size === undefined || per === undefined) return undefined;
    for (let i = first; i < first + length; i++) {
      const parts: number[] = [];
      for (let c = 0; c < per; c++) {
        const value = readNumber(values, component!, (i * per + c) * size);
        if (value === undefined) return undefined;
        parts.push(value);
      }
      elements.push(per === 1 ? parts[0] : parts);
    }
  }
  return property.array ? elements : elements[0];
}
