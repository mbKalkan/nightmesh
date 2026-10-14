import type { StructureStrings } from '../../shared/protocol';
import { fill, type Formatter } from './format';
import type { GltfModel } from './gltf';
import { entryKey, type EntryKey } from './outline';
import type { AnimationStatistics, MeshStatistics, Statistics } from './statistics';

/** Rows past this are summed up in a line, not listed. */
const ROW_LIMIT = 1000;

type Column = 'name' | 'instances' | 'triangles' | 'total';

/**
 * The statistics tab: totals for the scene shown, then its meshes in a table sorted by how many
 * triangles they put on screen. Mesh names are links: they select the mesh, which highlights
 * every place it is drawn.
 */
export class StatisticsView {
  readonly element: HTMLElement;
  private sort: { column: Column; descending: boolean } = { column: 'total', descending: true };
  private shown: { statistics: Statistics; model: GltfModel } | undefined;

  constructor(
    private readonly strings: StructureStrings,
    private readonly format: Formatter,
    private readonly onLink: (key: EntryKey) => void,
  ) {
    this.element = document.createElement('div');
    this.element.className = 'nm-statistics';
    this.element.tabIndex = 0;
    this.element.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const key = target.closest<HTMLElement>('[data-key]')?.dataset.key;
      if (key !== undefined) return this.onLink(key);
      const column = target.closest<HTMLElement>('[data-column]')?.dataset.column as
        Column | undefined;
      if (column === undefined) return;
      this.sort =
        this.sort.column === column
          ? { column, descending: !this.sort.descending }
          : { column, descending: column !== 'name' };
      this.render();
    });
  }

  show(statistics: Statistics, model: GltfModel): void {
    this.shown = { statistics, model };
    this.render();
  }

  private render(): void {
    if (!this.shown) return;
    const { statistics, model } = this.shown;
    const { strings, format } = this;
    const labels = strings.labels;

    const note = element('p', 'nm-note-line', strings.statisticsNote);
    const totals = document.createElement('dl');
    totals.className = 'nm-props';
    const add = (label: string, value: string | HTMLElement) => {
      const term = element('dt', '', label);
      const definition = document.createElement('dd');
      if (typeof value === 'string') definition.append(element('span', 'nm-mono', value));
      else definition.append(value);
      totals.append(term, definition);
    };
    if (statistics.scene !== undefined) {
      add(
        strings.kinds.scene,
        link(this.name(model, 'scene', statistics.scene), entryKey('scene', statistics.scene)),
      );
    }
    add(labels.nodes, format.count(statistics.nodes));
    add(labels.instances, format.count(statistics.instances));
    add(labels.drawCalls, format.count(statistics.drawCalls));
    add(labels.vertices, format.count(statistics.vertices));
    for (const shape of ['triangles', 'lines', 'points'] as const) {
      if (statistics[shape] > 0 || shape === 'triangles')
        add(labels[shape], format.count(statistics[shape]));
    }
    add(strings.groups.materials, format.count(statistics.materials));
    add(strings.groups.textures, format.count(statistics.textures));
    if (statistics.textureMemory !== undefined) {
      add(labels.textureMemory, `≈ ${format.bytes(statistics.textureMemory)}`);
    }
    if (statistics.bounds) {
      const { min, max } = statistics.bounds;
      add(labels.dimensions, format.dimensions(max.map((value, axis) => value - min[axis])));
    }

    const parts: HTMLElement[] = [note, totals];
    if (statistics.animations) parts.push(...this.animations(statistics.animations));
    if (statistics.meshes.length > 0) {
      parts.push(
        element('h3', 'nm-section-title', strings.groups.meshes),
        this.table(statistics.meshes, model),
      );
    }
    this.element.replaceChildren(...parts);
  }

  /** How many clips, how long the longest, and how much they move. */
  private animations(animations: AnimationStatistics): HTMLElement[] {
    const { strings, format } = this;
    const labels = strings.labels;
    const list = document.createElement('dl');
    list.className = 'nm-props';
    const add = (label: string, value: string) =>
      list.append(element('dt', '', label), element('dd', '', value));
    add(strings.groups.animations, format.count(animations.clips));
    if (animations.longest !== undefined) add(labels.longest, format.seconds(animations.longest));
    add(strings.sections.channels, format.count(animations.channels));
    add(labels.keyframes, format.count(animations.keyframes));
    add(labels.animatedNodes, format.count(animations.nodes));
    if (animations.still) add(labels.stillClips, format.count(animations.still));
    for (const value of list.querySelectorAll('dd')) value.classList.add('nm-mono');
    return [element('h3', 'nm-section-title', strings.groups.animations), list];
  }

  private table(meshes: readonly MeshStatistics[], model: GltfModel): HTMLElement {
    const { strings, format } = this;
    const value = (row: MeshStatistics, column: Column): number | string =>
      column === 'name'
        ? this.name(model, 'mesh', row.mesh).toLowerCase()
        : column === 'instances'
          ? row.instances
          : column === 'triangles'
            ? row.triangles
            : row.triangles * row.instances;
    const { column, descending } = this.sort;
    const sorted = [...meshes].sort((a, b) => {
      const [x, y] = [value(a, column), value(b, column)];
      const order = x < y ? -1 : x > y ? 1 : 0;
      // Ties keep the file's order whichever way the column sorts.
      return order === 0 ? a.mesh - b.mesh : descending ? -order : order;
    });

    const table = document.createElement('table');
    table.className = 'nm-table';
    const head = table.createTHead().insertRow();
    const columns: [Column, string][] = [
      ['name', strings.kinds.mesh],
      ['instances', strings.labels.instances],
      ['triangles', strings.labels.triangles],
      ['total', strings.labels.total],
    ];
    for (const [id, label] of columns) {
      const cell = document.createElement('th');
      cell.scope = 'col';
      if (id !== 'name') cell.className = 'nm-number';
      if (id === column) cell.setAttribute('aria-sort', descending ? 'descending' : 'ascending');
      const button = element('button', 'nm-sort', label);
      button.setAttribute('type', 'button');
      button.dataset.column = id;
      cell.append(button);
      head.append(cell);
    }
    const body = table.createTBody();
    for (const row of sorted.slice(0, ROW_LIMIT)) {
      const line = body.insertRow();
      const name = line.insertCell();
      name.append(link(this.name(model, 'mesh', row.mesh), entryKey('mesh', row.mesh)));
      // Meshes of lines or points draw no triangles: a dash says so better than a zero.
      const triangles = (count: number) => (row.triangles > 0 ? format.count(count) : '—');
      for (const text of [
        format.count(row.instances),
        triangles(row.triangles),
        triangles(row.triangles * row.instances),
      ]) {
        const cell = line.insertCell();
        cell.className = 'nm-number nm-mono';
        cell.textContent = text;
      }
    }
    if (sorted.length > ROW_LIMIT) {
      const more = body.insertRow().insertCell();
      more.colSpan = columns.length;
      more.className = 'nm-note';
      more.textContent = fill(strings.labels.more, format.count(sorted.length - ROW_LIMIT));
    }
    return table;
  }

  private name(model: GltfModel, kind: 'scene' | 'mesh', index: number): string {
    return (
      model.displayName(kind === 'scene' ? 'scenes' : 'meshes', index) ??
      `${this.strings.kinds[kind]} ${index}`
    );
  }
}

function element(tag: string, className: string, text: string): HTMLElement {
  const created = document.createElement(tag);
  if (className) created.className = className;
  created.textContent = text;
  return created;
}

function link(text: string, key: EntryKey): HTMLElement {
  const button = element('button', 'nm-link', text);
  button.setAttribute('type', 'button');
  button.dataset.key = key;
  return button;
}
