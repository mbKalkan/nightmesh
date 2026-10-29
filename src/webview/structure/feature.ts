// The inspector's section for a 3D Tiles feature clicked in the view: its batch id and what the
// tile's batch table says about it.
import type { TileFileStrings } from '../../shared/protocol';
import type { Feature } from '../scene/features';
import type { Inspection, Row, Section } from './details';
import { fill, type Formatter } from './format';

/** Properties past this are left out: a batch table can have hundreds of columns. */
const PROPERTY_LIMIT = 200;
/** Text values longer than this are cut: the inspector is a column, not a document. */
const TEXT_LIMIT = 500;
/** Arrays of numbers up to this long show on one line, as a vector or a matrix does. */
const VECTOR_LIMIT = 16;

export function featureSection(
  feature: Feature,
  words: TileFileStrings,
  format: Formatter,
): Section {
  const rows: Row[] = [
    {
      label: words.featureId,
      text: String(feature.id),
      mono: true,
      note: fill(words.featureOf, format.count(feature.count)),
    },
  ];
  for (const property of feature.properties.slice(0, PROPERTY_LIMIT)) {
    const note = property.className ? fill(words.featureClass, property.className) : undefined;
    rows.push({ label: property.name, ...valueRow(property.value, format), note });
  }
  return { title: words.feature, rows };
}

/** A value as the inspector shows it: numbers in the locale, text as it is, the rest as JSON. */
function valueRow(value: unknown, format: Formatter): Pick<Row, 'text' | 'mono' | 'json'> {
  if (typeof value === 'number') return { text: format.value(value), mono: true };
  if (typeof value === 'string') return { text: cut(value) };
  if (typeof value === 'boolean' || value === null || value === undefined) {
    return { text: String(value), mono: true };
  }
  // Vectors, from the binary body or JSON, on one line.
  const numbers = ArrayBuffer.isView(value)
    ? Array.from(value as unknown as ArrayLike<number>)
    : Array.isArray(value) &&
        value.length <= VECTOR_LIMIT &&
        value.every((n) => typeof n === 'number')
      ? (value as number[])
      : undefined;
  if (numbers) return { text: format.vector(numbers), mono: true };
  return { json: cut(JSON.stringify(value, null, 2)) };
}

const cut = (text: string): string =>
  text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}…` : text;

/** An inspection with the clicked feature's section first, when there is one. */
export function withFeature(
  inspection: Inspection | undefined,
  feature: Section | undefined,
): Inspection | undefined {
  return inspection && feature
    ? { ...inspection, sections: [feature, ...inspection.sections] }
    : inspection;
}
