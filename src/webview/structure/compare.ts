// What changed from one version of a model to another, from the summaries of the two: things
// matched by name, added, removed, or with facets that differ.
import type {
  ModelSummary,
  SummaryCollection,
  SummaryEntry,
  SummaryTotals,
} from '../../shared/protocol';

export type ChangeKind = 'added' | 'removed' | 'changed';

export interface Change {
  collection: SummaryCollection;
  key: string;
  kind: ChangeKind;
  /** Its index in the original and the modified version, where it is. */
  original?: number;
  modified?: number;
  /** What differs, for a changed thing: the names of its facets, or `geometry`. */
  facets: string[];
}

/** A total in both versions. */
export interface TotalChange {
  name: keyof SummaryTotals | 'dimensions' | 'area' | 'volume';
  original: number | readonly number[] | undefined;
  modified: number | readonly number[] | undefined;
  changed: boolean;
}

export interface Comparison {
  changes: Change[];
  totals: TotalChange[];
}

export const COLLECTIONS: readonly SummaryCollection[] = [
  'nodes',
  'meshes',
  'materials',
  'textures',
  'animations',
];

export function compare(original: ModelSummary, modified: ModelSummary): Comparison {
  const meshes = compareEntries('meshes', original.meshes, modified.meshes);
  // A node whose mesh changed is drawn differently even if the node itself didn't change.
  const changedMeshes = new Set(
    meshes.filter((change) => change.kind === 'changed').map((change) => change.key),
  );
  const geometry = (was: SummaryEntry, entry: SummaryEntry) =>
    entry.facets.mesh === was.facets.mesh && changedMeshes.has(entry.facets.mesh)
      ? ['geometry']
      : [];
  const changes: Change[] = [];
  for (const collection of COLLECTIONS) {
    changes.push(
      ...(collection === 'meshes'
        ? meshes
        : compareEntries(
            collection,
            original[collection],
            modified[collection],
            collection === 'nodes' ? geometry : undefined,
          )),
    );
  }
  return { changes, totals: totals(original, modified) };
}

/**
 * What differs between two lists of things, in the modified version's order, with what was
 * removed after what came before it in the original.
 */
function compareEntries(
  collection: SummaryCollection,
  original: readonly SummaryEntry[],
  modified: readonly SummaryEntry[],
  more?: (was: SummaryEntry, entry: SummaryEntry) => string[],
): Change[] {
  const before = new Map(original.map((entry) => [entry.key, entry]));
  const after = new Map(modified.map((entry) => [entry.key, entry]));
  const removed = new Map<string | undefined, Change[]>();
  let kept: string | undefined;
  for (const entry of original) {
    if (after.has(entry.key)) {
      kept = entry.key;
      continue;
    }
    const list = removed.get(kept) ?? [];
    list.push({ collection, key: entry.key, kind: 'removed', original: entry.index, facets: [] });
    removed.set(kept, list);
  }
  const changes: Change[] = [...(removed.get(undefined) ?? [])];
  for (const entry of modified) {
    const was = before.get(entry.key);
    if (!was) {
      changes.push({
        collection,
        key: entry.key,
        kind: 'added',
        modified: entry.index,
        facets: [],
      });
      continue;
    }
    const facets = [...new Set([...Object.keys(was.facets), ...Object.keys(entry.facets)])].filter(
      (facet) => (was.facets[facet] ?? '') !== (entry.facets[facet] ?? ''),
    );
    facets.push(...(more?.(was, entry) ?? []));
    if (facets.length > 0) {
      changes.push({
        collection,
        key: entry.key,
        kind: 'changed',
        original: was.index,
        modified: entry.index,
        facets,
      });
    }
    changes.push(...(removed.get(entry.key) ?? []));
  }
  return changes;
}

function totals(original: ModelSummary, modified: ModelSummary): TotalChange[] {
  const names = Object.keys(modified.totals) as (keyof SummaryTotals)[];
  const result: TotalChange[] = names.map((name) => ({
    name,
    original: original.totals[name],
    modified: modified.totals[name],
    changed: original.totals[name] !== modified.totals[name],
  }));
  result.push({
    name: 'dimensions',
    original: original.dimensions,
    modified: modified.dimensions,
    changed: !sameNumbers(original.dimensions, modified.dimensions),
  });
  if (original.check && modified.check) {
    for (const name of ['area', 'volume'] as const) {
      const [a, b] = [original.check[name], modified.check[name]];
      if (a === undefined && b === undefined) continue;
      result.push({ name, original: a, modified: b, changed: !sameNumber(a, b) });
    }
  }
  return result;
}

/** Equal to six significant digits, as the summaries write numbers. */
function sameNumber(a: number | undefined, b: number | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return Number(a.toPrecision(6)) === Number(b.toPrecision(6));
}

function sameNumbers(a: readonly number[] | undefined, b: readonly number[] | undefined): boolean {
  if (!a || !b) return a === b;
  return a.length === b.length && a.every((value, axis) => sameNumber(value, b[axis]));
}
