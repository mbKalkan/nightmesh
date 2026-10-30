// 3D Tiles metadata in a tileset's JSON (D-058): the schema, and the entities of the tileset, its
// groups, tiles and contents, with values read as their class says: no-data values, defaults,
// normalized integers, offset and scale, enums. 3D Tiles 1.1 and 1.0's 3DTILES_metadata alike.

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === 'string' ? value : undefined);

/** Entities and properties past these aren't read: nothing real comes close. */
const MAX_ENTRIES = 10_000;

export interface MetadataEntity {
  className?: string;
  properties: Json;
}

export interface SchemaProperty {
  type?: string;
  componentType?: string;
  enumType?: string;
  normalized: boolean;
  offset?: unknown;
  scale?: unknown;
  noData?: unknown;
  default?: unknown;
  semantic?: string;
}

export interface SchemaClass {
  name?: string;
  description?: string;
  properties: Map<string, SchemaProperty>;
}

export interface MetadataSchema {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  classes: Map<string, SchemaClass>;
  /** Each enum's names by their value. */
  enums: Map<string, Map<number, string>>;
}

/** A property of an entity as shown: given, taken from the class's default, or no data. */
export interface MetadataValue {
  name: string;
  value: unknown;
  /** `default`: not given, the class's default; `noData`: the class's no-data value. */
  note?: 'default' | 'noData';
  semantic?: string;
}

export interface ClassStatistics {
  className: string;
  count?: number;
  properties: {
    name: string;
    /** Statistics by their name in the file (`min`, `mean`…), numbers or vectors. */
    values: [string, unknown][];
    /** How often each value occurs, for enums and the like. */
    occurrences?: [string, number][];
  }[];
}

const entries = (value: unknown): [string, unknown][] =>
  isObject(value) ? Object.entries(value).slice(0, MAX_ENTRIES) : [];

export function readSchema(value: unknown): MetadataSchema | undefined {
  if (!isObject(value)) return undefined;
  const classes = new Map<string, SchemaClass>();
  for (const [id, json] of entries(value.classes)) {
    if (!isObject(json)) continue;
    const properties = new Map<string, SchemaProperty>();
    for (const [name, property] of entries(json.properties)) {
      if (!isObject(property)) continue;
      properties.set(name, {
        type: text(property.type),
        componentType: text(property.componentType),
        enumType: text(property.enumType),
        normalized: property.normalized === true,
        offset: property.offset,
        scale: property.scale,
        noData: property.noData,
        default: property.default,
        semantic: text(property.semantic),
      });
    }
    classes.set(id, { name: text(json.name), description: text(json.description), properties });
  }
  const enums = new Map<string, Map<number, string>>();
  for (const [id, json] of entries(value.enums)) {
    if (!isObject(json) || !Array.isArray(json.values)) continue;
    const names = new Map<number, string>();
    for (const item of json.values.slice(0, MAX_ENTRIES)) {
      if (isObject(item) && typeof item.value === 'number' && typeof item.name === 'string')
        names.set(item.value, item.name);
    }
    enums.set(id, names);
  }
  return {
    id: text(value.id),
    name: text(value.name),
    description: text(value.description),
    version: text(value.version),
    classes,
    enums,
  };
}

export function readEntity(value: unknown): MetadataEntity | undefined {
  if (!isObject(value)) return undefined;
  const className = text(value.class);
  const properties = isObject(value.properties) ? value.properties : {};
  if (className === undefined && Object.keys(properties).length === 0) return undefined;
  return { className, properties };
}

/**
 * An entity's properties: those of its class in the class's order, then any the class doesn't
 * have, as written. Without a schema, all of them as written.
 */
export function entityValues(
  entity: MetadataEntity,
  schema: MetadataSchema | undefined,
): MetadataValue[] {
  const definition =
    entity.className === undefined ? undefined : schema?.classes.get(entity.className);
  const given = entries(entity.properties);
  if (!definition) return given.map(([name, value]) => ({ name, value }));
  const values: MetadataValue[] = [];
  for (const [name, property] of definition.properties) {
    const value = valueOf(entity.properties[name], property, schema!);
    if (value) values.push({ name, ...value, semantic: property.semantic });
  }
  for (const [name, value] of given) {
    if (!definition.properties.has(name)) values.push({ name, value });
  }
  return values;
}

function valueOf(
  raw: unknown,
  property: SchemaProperty,
  schema: MetadataSchema,
): Pick<MetadataValue, 'value' | 'note'> | undefined {
  if (raw === undefined) {
    return property.default === undefined
      ? undefined
      : { value: property.default, note: 'default' };
  }
  if (property.noData !== undefined && sameValue(raw, property.noData)) {
    return property.default === undefined
      ? { value: raw, note: 'noData' }
      : { value: property.default, note: 'noData' };
  }
  if (property.type === 'ENUM') {
    const names = property.enumType === undefined ? undefined : schema.enums.get(property.enumType);
    return { value: names ? enumNames(raw, names) : raw };
  }
  return { value: transformed(raw, property) };
}

/** Enum values written as numbers, which 3D Tiles writes by name in JSON, named after all. */
function enumNames(value: unknown, names: Map<number, string>): unknown {
  if (typeof value === 'number') return names.get(value) ?? value;
  return Array.isArray(value) ? value.map((item) => enumNames(item, names)) : value;
}

const NUMERIC = /^(SCALAR|VEC[234]|MAT[234])$/;
/** What a normalized integer's largest value is, for each component type. */
const NORMALIZED: Record<string, number> = {
  INT8: 127,
  UINT8: 255,
  INT16: 32767,
  UINT16: 65535,
  INT32: 2147483647,
  UINT32: 4294967295,
  // As doubles: 64-bit values lose their last digits either way.
  INT64: 2 ** 63 - 1,
  UINT64: 2 ** 64 - 1,
};

/**
 * A numeric value as it is meant: a normalized integer in [0, 1] or [-1, 1], then scaled and
 * offset; floats are scaled and offset too. Offset and scale have the value's shape, or apply to
 * each component when they are single numbers.
 */
function transformed(value: unknown, property: SchemaProperty): unknown {
  const { type, componentType = '', normalized, offset, scale } = property;
  if (type === undefined || !NUMERIC.test(type)) return value;
  const largest = normalized ? NORMALIZED[componentType] : undefined;
  if (largest === undefined && !componentType.startsWith('FLOAT')) return value;
  const apply = (item: unknown, add: unknown, times: unknown): unknown => {
    if (typeof item === 'number') {
      const n = largest === undefined ? item : Math.max(item / largest, -1);
      return n * (typeof times === 'number' ? times : 1) + (typeof add === 'number' ? add : 0);
    }
    if (!Array.isArray(item)) return item;
    return item.map((element, i) =>
      apply(element, Array.isArray(add) ? add[i] : add, Array.isArray(times) ? times[i] : times),
    );
  };
  return apply(value, offset, scale);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  return a === b;
}

/** A tileset's groups by how contents name them: their index in 1.1, their ID in 1.0. */
export function readGroups(value: unknown): Map<string, MetadataEntity> {
  const groups = new Map<string, MetadataEntity>();
  const list: [string, unknown][] = Array.isArray(value)
    ? value.slice(0, MAX_ENTRIES).map((group, i) => [String(i), group])
    : entries(value);
  for (const [id, json] of list) {
    const entity = readEntity(json) ?? (isObject(json) ? { properties: {} } : undefined);
    if (entity) groups.set(id, entity);
  }
  return groups;
}

export function readStatistics(value: unknown): ClassStatistics[] {
  if (!isObject(value)) return [];
  return entries(value.classes).flatMap(([className, json]): ClassStatistics[] => {
    if (!isObject(json)) return [];
    const count = typeof json.count === 'number' ? json.count : undefined;
    const properties = entries(json.properties).flatMap(([name, stats]) => {
      if (!isObject(stats)) return [];
      const values = STATISTICS.filter((key) => isNumbers(stats[key])).map(
        (key): [string, unknown] => [key, stats[key]],
      );
      const occurrences = entries(stats.occurrences).filter(
        (pair): pair is [string, number] => typeof pair[1] === 'number',
      );
      if (values.length === 0 && occurrences.length === 0) return [];
      return [{ name, values, occurrences: occurrences.length > 0 ? occurrences : undefined }];
    });
    return [{ className, count, properties }];
  });
}

/** The statistics 3D Tiles names, in the order they are shown; others (`_skewness`) aren't. */
export const STATISTICS = ['min', 'max', 'mean', 'median', 'standardDeviation', 'variance', 'sum'];

const isNumbers = (value: unknown): boolean =>
  typeof value === 'number' || (Array.isArray(value) && value.every(isNumbers));
