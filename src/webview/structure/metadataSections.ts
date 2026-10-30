// The inspector's sections for a tileset's metadata (D-058): an entity's class and properties,
// the schema, the statistics, and 1.0's ranges of batch table properties.
import type { TilesetMetadataStrings } from '../../shared/protocol';
import type { Row, Section } from './details';
import { valueRow } from './feature';
import { fill, type Formatter } from './format';
import {
  entityValues,
  type ClassStatistics,
  type MetadataEntity,
  type MetadataSchema,
} from './tilesetMetadata';

/** Properties past this are left out, as for a feature's. */
const PROPERTY_LIMIT = 200;
/** Names of classes or enums listed in one row before the rest are only counted. */
const NAME_LIMIT = 20;

export function entitySection(
  title: string,
  entity: MetadataEntity,
  schema: MetadataSchema | undefined,
  words: TilesetMetadataStrings,
  format: Formatter,
): Section {
  const rows: Row[] = [];
  if (entity.className !== undefined) {
    const name = schema?.classes.get(entity.className)?.name;
    rows.push({ label: words.className, text: entity.className, mono: true, note: name });
  }
  for (const property of entityValues(entity, schema).slice(0, PROPERTY_LIMIT)) {
    const notes = [
      property.note && { default: words.defaultValue, noData: words.noData }[property.note],
      property.semantic,
    ].filter(Boolean);
    rows.push({
      label: property.name,
      ...valueRow(property.value, format),
      note: notes.join(', ') || undefined,
    });
  }
  return { title, rows };
}

export function schemaSection(
  schema: MetadataSchema | undefined,
  schemaUri: string | undefined,
  groups: number,
  words: TilesetMetadataStrings,
  format: Formatter,
): Section {
  const rows: Row[] = [];
  if (schemaUri !== undefined) rows.push({ label: words.file, text: schemaUri, mono: true });
  if (schema) {
    const names = (ids: string[]): string =>
      ids.length > NAME_LIMIT
        ? `${ids.slice(0, NAME_LIMIT).join(', ')} +${format.count(ids.length - NAME_LIMIT)}`
        : ids.join(', ');
    const pairs: [string, string | undefined, boolean?][] = [
      [words.id, schema.id, true],
      [words.name, schema.name],
      [words.version, schema.version, true],
      [words.description, schema.description],
      [words.classes, schema.classes.size ? names([...schema.classes.keys()]) : undefined, true],
      [words.enums, schema.enums.size ? names([...schema.enums.keys()]) : undefined, true],
    ];
    for (const [label, text, mono] of pairs) {
      if (text !== undefined) rows.push({ label, text, mono });
    }
  }
  if (groups > 0) rows.push({ label: words.groups, text: format.count(groups) });
  return { title: words.schema, rows };
}

export function statisticsSection(
  statistics: ClassStatistics[],
  words: TilesetMetadataStrings,
  format: Formatter,
): Section {
  const rows: Row[] = [];
  const shown = (value: unknown) =>
    typeof value === 'number' ? format.value(value) : format.vector((value as number[]).flat(3));
  for (const { className, count, properties } of statistics) {
    rows.push({
      label: words.className,
      text: className,
      mono: true,
      note: count === undefined ? undefined : fill(words.entities, format.count(count)),
    });
    for (const property of properties.slice(0, PROPERTY_LIMIT)) {
      const parts = property.values.map(
        ([key, value]) =>
          `${words.statistics[key as keyof typeof words.statistics]} ${shown(value)}`,
      );
      const occurrences = property.occurrences
        ?.slice(0, NAME_LIMIT)
        .map(([name, times]) => `${name} ${format.count(times)}`);
      rows.push({
        label: property.name,
        text: [...parts, ...(occurrences ?? [])].join(' · '),
        mono: true,
      });
    }
  }
  return { title: words.statisticsTitle, rows };
}

export function featurePropertiesSection(
  properties: { name: string; minimum?: number; maximum?: number }[],
  words: TilesetMetadataStrings,
  format: Formatter,
): Section {
  const shown = (value: number | undefined) => (value === undefined ? '?' : format.value(value));
  return {
    title: words.featureProperties,
    rows: properties.map(({ name, minimum, maximum }) => ({
      label: name,
      text: fill(words.range, shown(minimum), shown(maximum)),
      mono: true,
    })),
  };
}
