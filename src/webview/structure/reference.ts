import type { StructureGroup, StructureKind } from '../../shared/protocol';
import { inspect, type InspectContext, type Inspection, type Link, type Row } from './details';
import { fill } from './format';
import type { Collection } from './gltf';
import { parseKey, type EntryKey } from './outline';

/** A place in the model, and what the inspector says about it, for the host to copy. */
export interface Reference {
  /** Left out for the model itself: the file's path says it all. */
  location?: string;
  details?: string;
}

/** Where each kind of thing is in a glTF file's JSON. */
const PATHS: Partial<Record<StructureKind, string>> = {
  scene: 'scenes',
  node: 'nodes',
  mesh: 'meshes',
  material: 'materials',
  texture: 'textures',
  image: 'images',
  sampler: 'samplers',
  animation: 'animations',
  skin: 'skins',
  camera: 'cameras',
  light: 'extensions.KHR_lights_punctual.lights',
};

/** Nodes named above a node, at most; deeper hierarchies keep the top and the nearest ones. */
const ANCESTORS = 8;

/**
 * A reference to an entry, such as `node "Arm" (nodes[12]), under Root › Body`: its kind and
 * name for people, its place in the JSON for tools, and for a node the nodes above it. With
 * `details`, the inspector's sections as a plain list. Undefined when the model has no such entry.
 */
export function referenceOf(
  context: InspectContext,
  key: EntryKey,
  locale: string,
  details: boolean,
): Reference | undefined {
  const location = locationOf(context, key, locale);
  if (location === undefined) return undefined;
  const inspection = details ? inspect(context, key) : undefined;
  return {
    location: location || undefined,
    details: inspection && detailsOf(inspection),
  };
}

function locationOf(context: InspectContext, key: EntryKey, locale: string): string | undefined {
  const { model, strings } = context;
  if (key === 'model') return '';
  const group = /^group:(\w+)$/.exec(key)?.[1] as StructureGroup | undefined;
  if (group) return strings.groups[group]?.toLocaleLowerCase(locale);

  const parsed = parseKey(key);
  const path = parsed && PATHS[parsed.kind];
  if (!parsed || !path) return undefined;
  const collection = parsed.kind === 'light' ? 'lights' : (path as Collection);
  const size = collection === 'lights' ? model.lights().length : model.items(collection).length;
  if (parsed.index >= size) return undefined;

  const kind = strings.kinds[parsed.kind].toLocaleLowerCase(locale);
  const name = model.displayName(collection, parsed.index);
  const place = `${path}[${parsed.index}]`;
  const location =
    name === undefined
      ? `${kind} ${parsed.index} (${place})`
      : `${kind} ${JSON.stringify(name)} (${place})`;
  if (parsed.kind !== 'node') return location;

  const above: string[] = [];
  for (let node = model.parent(parsed.index); node !== undefined; node = model.parent(node)) {
    above.unshift(model.displayName('nodes', node) ?? `${strings.kinds.node} ${node}`);
    // A cycle in a damaged file would never end.
    if (above.length > model.items('nodes').length) break;
  }
  if (above.length === 0) return location;
  const shown =
    above.length > ANCESTORS ? [above[0], '…', ...above.slice(-(ANCESTORS - 2))] : above;
  return `${location}, ${fill(strings.labels.under, shown.join(' › '))}`;
}

/** The inspector's sections, each a title and its rows as `- label: value`. */
function detailsOf(inspection: Inspection): string {
  return inspection.sections
    .filter((section) => section.rows.length > 0)
    .map((section) => [section.title, ...section.rows.map((row) => `- ${rowText(row)}`)].join('\n'))
    .join('\n');
}

function rowText(row: Row): string {
  const value = [
    row.links?.map(linkText).join(', '),
    row.text,
    row.json !== undefined ? oneLine(row.json) : undefined,
    row.note !== undefined ? `(${row.note})` : undefined,
  ]
    .filter(Boolean)
    .join(' ');
  return row.label ? `${row.label}: ${value}` : value;
}

/** A link by its text, and where the JSON has what it names, for tools to follow. */
function linkText(link: Link): string {
  const parsed = parseKey(link.key);
  const path = parsed && PATHS[parsed.kind];
  return path ? `${link.text} (${path}[${parsed.index}])` : link.text;
}

/** JSON on one line: the inspector indents it, and may have cut it short. */
function oneLine(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json));
  } catch {
    return json.replace(/\s+/g, ' ').trim();
  }
}
