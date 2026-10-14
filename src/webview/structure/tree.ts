import { icons } from '../icons';
import type { EntryKey, OutlineEntry } from './outline';

/** Matches VS Code's own lists. */
const ROW_HEIGHT = 22;
/** Rows drawn beyond each edge of the visible area, so fast scrolling doesn't show gaps. */
const OVERSCAN = 10;

interface VisibleRow {
  entry: OutlineEntry;
  level: number;
  /** Index of the row above it in the hierarchy, or -1 at the top. */
  parent: number;
  setSize: number;
  posInSet: number;
}

/**
 * The structure tree: a tree in the ARIA sense, styled like VS Code's. Only the rows in view
 * exist in the page, so a model with a hundred thousand nodes scrolls as freely as a small one.
 * The tree takes focus as a whole and points `aria-activedescendant` at the focused row; arrow
 * keys move and select, Left and Right fold, typing jumps to a name.
 */
export class StructureTree {
  readonly element: HTMLElement;
  private readonly rows: HTMLElement;
  private entries: OutlineEntry[] = [];
  private readonly childCache = new Map<EntryKey, OutlineEntry[]>();
  private expanded = new Set<EntryKey>();
  private visible: VisibleRow[] = [];
  private readonly rendered = new Map<EntryKey, HTMLElement>();
  private readonly ids = new Map<EntryKey, string>();
  private focused = 0;
  private selected: EntryKey | undefined;
  private frame = 0;
  private typed = '';
  private typedAt = 0;

  constructor(
    label: string,
    private readonly onSelect: (key: EntryKey) => void,
  ) {
    this.element = document.createElement('div');
    this.element.className = 'nm-tree';
    this.element.tabIndex = 0;
    this.element.setAttribute('role', 'tree');
    this.element.setAttribute('aria-label', label);
    this.rows = document.createElement('div');
    this.rows.className = 'nm-tree-rows';
    this.element.append(this.rows);
    this.element.addEventListener('scroll', () => this.requestRender());
    this.element.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.element.addEventListener('click', (event) => this.onClick(event));
    this.element.addEventListener('dblclick', (event) => this.onDoubleClick(event));
    this.element.addEventListener('focus', () => this.render());
    new ResizeObserver(() => this.requestRender()).observe(this.element);
  }

  /** Shows `entries`, with `expanded` open and `selected` marked; scrolled to the top unless kept. */
  setEntries(
    entries: OutlineEntry[],
    expanded: Iterable<EntryKey>,
    selected: EntryKey,
    keepScroll = false,
  ): void {
    this.entries = entries;
    this.childCache.clear();
    // Keys can name something else in a new model; rows are made afresh.
    this.rows.replaceChildren();
    this.rendered.clear();
    this.ids.clear();
    this.expanded = new Set(expanded);
    this.selected = selected;
    this.layout();
    this.focused = Math.max(0, this.indexOf(selected));
    if (!keepScroll) this.element.scrollTop = 0;
    this.revealFocused();
    this.render();
  }

  expandedKeys(): EntryKey[] {
    return [...this.expanded];
  }

  /** Marks `key` as selected, opening `ancestors` (top first) so it shows, and scrolls to it. */
  select(key: EntryKey, ancestors: readonly EntryKey[] = []): void {
    let opened = false;
    for (const ancestor of ancestors) {
      if (!this.expanded.has(ancestor)) {
        this.expanded.add(ancestor);
        opened = true;
      }
    }
    if (opened) this.layout();
    this.selected = key;
    const index = this.indexOf(key);
    if (index >= 0) this.focused = index;
    this.revealFocused();
    this.render();
  }

  focus(): void {
    this.element.focus();
  }

  private indexOf(key: EntryKey): number {
    return this.visible.findIndex((row) => row.entry.key === key);
  }

  private childrenOf(entry: OutlineEntry): OutlineEntry[] {
    if (!entry.children) return [];
    let children = this.childCache.get(entry.key);
    if (!children) {
      children = entry.children();
      this.childCache.set(entry.key, children);
    }
    return children;
  }

  /** Lists the rows that show: every entry whose ancestors are all expanded. */
  private layout(): void {
    const focusedKey = this.visible[this.focused]?.entry.key;
    const visible: VisibleRow[] = [];
    const add = (entries: OutlineEntry[], level: number, parent: number) => {
      entries.forEach((entry, index) => {
        const row = visible.push({
          entry,
          level,
          parent,
          setSize: entries.length,
          posInSet: index + 1,
        });
        if (this.expanded.has(entry.key)) add(this.childrenOf(entry), level + 1, row - 1);
      });
    };
    add(this.entries, 1, -1);
    this.visible = visible;
    this.rows.style.height = `${visible.length * ROW_HEIGHT}px`;
    if (focusedKey !== undefined) {
      const index = this.indexOf(focusedKey);
      this.focused = index >= 0 ? index : Math.min(this.focused, visible.length - 1);
    }
  }

  private toggle(index: number, expand?: boolean): void {
    const { entry } = this.visible[index];
    if (!entry.children) return;
    const open = expand ?? !this.expanded.has(entry.key);
    if (open === this.expanded.has(entry.key)) return;
    if (open) this.expanded.add(entry.key);
    else this.expanded.delete(entry.key);
    this.focused = index;
    this.layout();
    this.render();
  }

  private requestRender(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  /** Draws the rows in view (and the focused one, which assistive tech points at). */
  private render(): void {
    const first = Math.max(0, Math.floor(this.element.scrollTop / ROW_HEIGHT) - OVERSCAN);
    const last = Math.min(
      this.visible.length - 1,
      Math.ceil((this.element.scrollTop + this.element.clientHeight) / ROW_HEIGHT) + OVERSCAN,
    );
    const wanted = new Set<number>();
    for (let index = first; index <= last; index++) wanted.add(index);
    if (this.visible[this.focused]) wanted.add(this.focused);

    const keep = new Set<EntryKey>();
    for (const index of wanted) {
      const row = this.visible[index];
      keep.add(row.entry.key);
      let element = this.rendered.get(row.entry.key);
      if (!element) {
        element = this.createRow(row);
        this.rendered.set(row.entry.key, element);
        this.rows.append(element);
      }
      this.updateRow(element, row, index);
    }
    for (const [key, element] of this.rendered) {
      if (keep.has(key)) continue;
      element.remove();
      this.rendered.delete(key);
    }
    const focusedKey = this.visible[this.focused]?.entry.key;
    if (focusedKey !== undefined) {
      this.element.setAttribute('aria-activedescendant', this.idOf(focusedKey));
    } else {
      this.element.removeAttribute('aria-activedescendant');
    }
  }

  private idOf(key: EntryKey): string {
    let id = this.ids.get(key);
    if (!id) {
      id = `nm-tree-row-${this.ids.size}`;
      this.ids.set(key, id);
    }
    return id;
  }

  private createRow({ entry }: VisibleRow): HTMLElement {
    const element = document.createElement('div');
    element.className = 'nm-tree-row';
    element.id = this.idOf(entry.key);
    element.setAttribute('role', 'treeitem');
    element.dataset.key = entry.key;
    element.title = entry.description ? `${entry.label} — ${entry.description}` : entry.label;

    const twistie = document.createElement('span');
    twistie.className = 'nm-twistie';
    if (entry.children) twistie.innerHTML = icons.chevron;
    const icon = document.createElement('span');
    icon.className = `nm-tree-icon nm-icon-${entry.icon}`;
    icon.innerHTML = icons[entry.icon];
    const label = document.createElement('span');
    label.className = 'nm-tree-label';
    label.textContent = entry.label;
    element.append(twistie, icon, label);
    if (entry.description) {
      const description = document.createElement('span');
      description.className = 'nm-tree-description';
      description.textContent = entry.description;
      element.append(description);
    }
    if (entry.count !== undefined) {
      const count = document.createElement('span');
      count.className = 'nm-badge';
      count.textContent = String(entry.count);
      element.append(count);
    }
    return element;
  }

  private updateRow(element: HTMLElement, row: VisibleRow, index: number): void {
    element.style.transform = `translateY(${index * ROW_HEIGHT}px)`;
    element.style.setProperty('--nm-level', String(row.level - 1));
    element.setAttribute('aria-level', String(row.level));
    element.setAttribute('aria-setsize', String(row.setSize));
    element.setAttribute('aria-posinset', String(row.posInSet));
    if (row.entry.children) {
      element.setAttribute('aria-expanded', String(this.expanded.has(row.entry.key)));
    }
    if (row.entry.count === undefined) {
      element.setAttribute('aria-selected', String(row.entry.key === this.selected));
    }
    element.classList.toggle('nm-focused', index === this.focused);
  }

  private revealFocused(): void {
    const top = this.focused * ROW_HEIGHT;
    const height = this.element.clientHeight;
    if (top < this.element.scrollTop) this.element.scrollTop = top;
    else if (top + ROW_HEIGHT > this.element.scrollTop + height) {
      this.element.scrollTop = top + ROW_HEIGHT - height;
    }
  }

  /** Moves the focus to row `index`, and selects what's there unless it is a group. */
  private moveTo(index: number): void {
    const row = this.visible[index];
    if (!row) return;
    this.focused = index;
    if (row.entry.count === undefined && row.entry.key !== this.selected) {
      this.selected = row.entry.key;
      this.onSelect(row.entry.key);
    }
    this.revealFocused();
    this.render();
  }

  private rowIndexAt(event: MouseEvent): number {
    const key = (event.target as HTMLElement).closest<HTMLElement>('.nm-tree-row')?.dataset.key;
    return key === undefined ? -1 : this.indexOf(key);
  }

  private onClick(event: MouseEvent): void {
    const index = this.rowIndexAt(event);
    if (index < 0) return;
    const { entry } = this.visible[index];
    const onTwistie = (event.target as HTMLElement).closest('.nm-twistie');
    if (onTwistie || entry.count !== undefined) {
      this.toggle(index);
      return;
    }
    this.moveTo(index);
  }

  private onDoubleClick(event: MouseEvent): void {
    const index = this.rowIndexAt(event);
    if (index < 0 || (event.target as HTMLElement).closest('.nm-twistie')) return;
    if (this.visible[index].entry.count === undefined) this.toggle(index);
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (this.visible.length === 0) return;
    const row = this.visible[this.focused];
    const page = Math.max(1, Math.floor(this.element.clientHeight / ROW_HEIGHT) - 1);
    let target: number | undefined;
    switch (event.key) {
      case 'ArrowDown':
        target = Math.min(this.focused + 1, this.visible.length - 1);
        break;
      case 'ArrowUp':
        target = Math.max(this.focused - 1, 0);
        break;
      case 'PageDown':
        target = Math.min(this.focused + page, this.visible.length - 1);
        break;
      case 'PageUp':
        target = Math.max(this.focused - page, 0);
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = this.visible.length - 1;
        break;
      case 'ArrowRight':
        if (row.entry.children && !this.expanded.has(row.entry.key))
          this.toggle(this.focused, true);
        else if (row.entry.children) target = this.focused + 1;
        break;
      case 'ArrowLeft':
        if (row.entry.children && this.expanded.has(row.entry.key))
          this.toggle(this.focused, false);
        else if (row.parent >= 0) target = row.parent;
        break;
      case 'Enter':
      case ' ':
        if (row.entry.children) this.toggle(this.focused);
        break;
      default:
        if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
        target = this.findTyped(event.key);
        if (target === undefined) return;
    }
    event.preventDefault();
    if (target !== undefined) this.moveTo(target);
  }

  /** Type-ahead: the next row whose label starts with what was typed in the last second. */
  private findTyped(key: string): number | undefined {
    const now = Date.now();
    this.typed = now - this.typedAt < 1000 ? this.typed + key.toLowerCase() : key.toLowerCase();
    this.typedAt = now;
    const start = this.typed.length > 1 ? this.focused : this.focused + 1;
    for (let offset = 0; offset < this.visible.length; offset++) {
      const index = (start + offset) % this.visible.length;
      if (this.visible[index].entry.label.toLowerCase().startsWith(this.typed)) return index;
    }
    return undefined;
  }
}
