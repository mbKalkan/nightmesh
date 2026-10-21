import type { DiffSide, StructureStrings, SummaryCollection } from '../../shared/protocol';
import { COLLECTIONS, type Change, type Comparison, type TotalChange } from './compare';
import { fill, type Formatter } from './format';
import { entryKey, type EntryKey } from './outline';

/** Rows shown for each kind of thing before the rest are counted. */
const ROW_LIMIT = 200;

/** The tree's kind for each collection compared. */
export const COLLECTION_KINDS = {
  nodes: 'node',
  meshes: 'mesh',
  materials: 'material',
  textures: 'texture',
  animations: 'animation',
} as const satisfies Record<SummaryCollection, string>;

const LETTERS = { added: 'A', removed: 'D', changed: 'M' } as const;

/**
 * The Changes tab, beside the inspector while VS Code compares two versions of a model: the
 * totals of both, then what was added, removed or changed, each a link to it on this side.
 */
export class CompareView {
  readonly element: HTMLElement;
  /** What changed about a thing, in words, where glTF has no property name for it. */
  private readonly facets: Readonly<Record<string, string>>;

  constructor(
    private readonly strings: StructureStrings,
    private readonly format: Formatter,
    private readonly onLink: (key: EntryKey) => void,
  ) {
    const words = strings.compare;
    this.facets = {
      transform: strings.sections.transform,
      mesh: strings.kinds.mesh,
      camera: strings.kinds.camera,
      visible: words.visibility,
      geometry: words.geometry,
      primitives: strings.labels.primitives,
      bounds: words.bounds,
      image: strings.kinds.image,
      sampler: strings.kinds.sampler,
      channels: strings.sections.channels,
      duration: strings.labels.duration,
    };
    this.element = document.createElement('div');
    this.element.className = 'nm-compare';
    this.element.tabIndex = 0;
    this.element.addEventListener('click', (event) => {
      const key = (event.target as HTMLElement).closest<HTMLElement>('[data-key]')?.dataset.key;
      if (key !== undefined) this.onLink(key);
    });
  }

  /** Shows `comparison` as this side sees it; undefined while the other side isn't known yet. */
  show(comparison: Comparison | undefined, side: DiffSide): void {
    const words = this.strings.compare;
    if (!comparison) {
      this.element.replaceChildren(element('p', 'nm-note-line', words.waiting));
      return;
    }
    const parts: HTMLElement[] = [element('p', 'nm-note-line', words.note)];
    parts.push(this.totals(comparison.totals));
    const { changes } = comparison;
    parts.push(
      element(
        'p',
        'nm-compare-count',
        changes.length === 0
          ? words.none
          : changes.length === 1
            ? words.one
            : fill(words.many, this.format.count(changes.length)),
      ),
    );
    for (const collection of COLLECTIONS) {
      const found = changes.filter((change) => change.collection === collection);
      if (found.length > 0) parts.push(...this.list(collection, found, side));
    }
    this.element.replaceChildren(...parts);
  }

  /**
   * The totals of both versions, one per line as the statistics give them: what stayed once,
   * what changed from the original to the modified, with by how much.
   */
  private totals(totals: readonly TotalChange[]): HTMLElement {
    const { strings } = this;
    const labels: Record<TotalChange['name'], string> = {
      fileSize: strings.labels.fileSize,
      nodes: strings.labels.nodes,
      drawCalls: strings.labels.drawCalls,
      vertices: strings.labels.vertices,
      triangles: strings.labels.triangles,
      materials: strings.groups.materials,
      textures: strings.groups.textures,
      dimensions: strings.labels.dimensions,
      area: strings.source.area,
      volume: strings.source.volume,
    };
    const list = document.createElement('dl');
    list.className = 'nm-props nm-compare-totals';
    for (const total of totals) {
      const value = document.createElement('dd');
      const [original, modified] = [total.original, total.modified].map((each) =>
        each === undefined ? '—' : this.value(total.name, each),
      );
      if (!total.changed) {
        value.textContent = modified;
      } else {
        value.className = 'nm-compare-changed';
        value.textContent = `${original} → ${modified}`;
        const difference = this.difference(total);
        if (difference) value.append(' ', element('span', 'nm-compare-delta', difference));
      }
      list.append(element('dt', '', labels[total.name]), value);
    }
    return list;
  }

  private value(name: TotalChange['name'], value: number | readonly number[]): string {
    const { format } = this;
    if (typeof value !== 'number') return format.dimensions(value);
    if (name === 'fileSize') return format.bytes(value);
    if (name === 'area') return format.area(value);
    if (name === 'volume') return format.volume(Math.abs(value));
    return format.count(value);
  }

  /** How much a total grew or shrank, with its sign; nothing for a size along three axes. */
  private difference(total: TotalChange): string | undefined {
    const { original, modified, name } = total;
    if (typeof original !== 'number' || typeof modified !== 'number') return undefined;
    const delta = name === 'volume' ? Math.abs(modified) - Math.abs(original) : modified - original;
    const amount = Math.abs(delta);
    const shown =
      name === 'fileSize'
        ? this.format.bytes(amount)
        : name === 'area'
          ? this.format.area(amount)
          : name === 'volume'
            ? this.format.volume(amount)
            : this.format.count(amount);
    return `(${delta > 0 ? '+' : '−'}${shown})`;
  }

  private list(collection: SummaryCollection, changes: Change[], side: DiffSide): HTMLElement[] {
    const { strings, format } = this;
    const words = strings.compare;
    const heading = element('h3', 'nm-section-title', strings.groups[collection]);
    heading.append(element('span', 'nm-compare-heading-count', ` ${format.count(changes.length)}`));
    const list = document.createElement('ul');
    list.className = 'nm-compare-list';
    for (const change of changes.slice(0, ROW_LIMIT)) {
      const item = document.createElement('li');
      item.className = `nm-change-${change.kind}`;
      const mark = element('span', 'nm-change-mark', LETTERS[change.kind]);
      mark.setAttribute('aria-hidden', 'true');
      const index = side === 'original' ? change.original : change.modified;
      const name =
        index === undefined
          ? element('span', 'nm-compare-name', change.key)
          : link(change.key, entryKey(COLLECTION_KINDS[collection], index));
      // A node's path can be long: all of it shows on hover.
      name.title = change.key;
      const facets = change.facets.map((facet) => this.facets[facet] ?? facet).join(', ');
      // Said as "Root/Box, Changed: Transform".
      const spoken = `, ${words[change.kind]}${facets ? ': ' : ''}`;
      item.append(mark, name, element('span', 'nm-sr-only', spoken));
      if (facets) {
        const shown = element('span', 'nm-compare-facets', facets);
        shown.title = facets;
        item.append(shown);
      }
      list.append(item);
    }
    if (changes.length > ROW_LIMIT) {
      list.append(
        element(
          'li',
          'nm-note',
          fill(strings.labels.more, format.count(changes.length - ROW_LIMIT)),
        ),
      );
    }
    return [heading, list];
  }
}

function element(tag: string, className: string, text: string): HTMLElement {
  const created = document.createElement(tag);
  if (className) created.className = className;
  created.textContent = text;
  return created;
}

function link(text: string, key: EntryKey): HTMLElement {
  const button = element('button', 'nm-link nm-compare-name', text);
  button.setAttribute('type', 'button');
  button.dataset.key = key;
  return button;
}
