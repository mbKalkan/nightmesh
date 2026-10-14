/** One line of a menu: an action, or a choice shown checked or not. */
export interface MenuAction {
  label: string;
  /** The key that does the same, shown at the right. */
  shortcut?: string;
  /** `radio` picks one of a group, `check` turns something on or off. */
  kind?: 'action' | 'radio' | 'check';
  checked?: boolean;
  run(): void;
}

export type MenuItem = MenuAction | 'separator';

/**
 * A toolbar button that opens a menu below it, worked like VS Code's own: arrow keys, Home and
 * End move, Enter or Space runs, Escape closes, a click outside closes. The items are asked for
 * each time it opens, so checks show what is true then.
 */
export class MenuButton {
  private menu: HTMLElement | undefined;
  private readonly closeOutside = (event: PointerEvent) => {
    const target = event.target as Node;
    if (!this.menu?.contains(target) && !this.button.contains(target)) this.close(false);
  };
  private readonly closeOnBlur = () => this.close(false);

  constructor(
    private readonly button: HTMLButtonElement,
    /** Where the menu goes: it floats over the page, so no toolbar clips it. */
    private readonly host: HTMLElement,
    private readonly items: () => MenuItem[],
  ) {
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', () => (this.menu ? this.close(false) : this.open('first')));
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      this.open(event.key === 'ArrowDown' ? 'first' : 'last');
    });
  }

  get isOpen(): boolean {
    return this.menu !== undefined;
  }

  open(focus: 'first' | 'last'): void {
    this.close(false);
    const menu = document.createElement('div');
    menu.className = 'nm-menu';
    menu.setAttribute('role', 'menu');
    const label = this.button.getAttribute('aria-label');
    if (label) menu.setAttribute('aria-label', label);
    for (const item of this.items()) menu.append(itemElement(item));
    menu.addEventListener('click', (event) => {
      const element = (event.target as HTMLElement).closest<HTMLElement>('.nm-menu-item');
      if (element) this.run(element);
    });
    menu.addEventListener('keydown', (event) => this.onKeyDown(event));
    menu.addEventListener('pointermove', (event) => {
      (event.target as HTMLElement).closest<HTMLElement>('.nm-menu-item')?.focus();
    });
    this.host.append(menu);
    this.menu = menu;
    this.place(menu);
    this.button.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', this.closeOutside, true);
    window.addEventListener('blur', this.closeOnBlur);
    window.addEventListener('resize', this.closeOnBlur);
    const entries = this.entries();
    (focus === 'first' ? entries[0] : entries.at(-1))?.focus();
  }

  /** Closes the menu; `refocus` puts the focus back on the button, as after a keyboard choice. */
  close(refocus: boolean): void {
    if (!this.menu) return;
    this.menu.remove();
    this.menu = undefined;
    this.button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', this.closeOutside, true);
    window.removeEventListener('blur', this.closeOnBlur);
    window.removeEventListener('resize', this.closeOnBlur);
    if (refocus) this.button.focus();
  }

  /** Below the button, its right edge under the button's, inside the window. */
  private place(menu: HTMLElement): void {
    const anchor = this.button.getBoundingClientRect();
    const width = menu.offsetWidth;
    const left = Math.max(4, Math.min(anchor.right - width, window.innerWidth - width - 4));
    menu.style.left = `${left}px`;
    menu.style.top = `${anchor.bottom + 2}px`;
    menu.style.maxHeight = `${Math.max(80, window.innerHeight - anchor.bottom - 8)}px`;
  }

  private entries(): HTMLElement[] {
    return [...(this.menu?.querySelectorAll<HTMLElement>('.nm-menu-item') ?? [])];
  }

  private run(element: HTMLElement): void {
    const action = actions.get(element);
    this.close(true);
    action?.run();
  }

  private onKeyDown(event: KeyboardEvent): void {
    const entries = this.entries();
    const current = entries.indexOf(document.activeElement as HTMLElement);
    let next: number | undefined;
    switch (event.key) {
      case 'ArrowDown':
        next = (current + 1) % entries.length;
        break;
      case 'ArrowUp':
        next = (current - 1 + entries.length) % entries.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = entries.length - 1;
        break;
      case 'Enter':
      case ' ':
        if (entries[current]) this.run(entries[current]);
        break;
      case 'Escape':
        this.close(true);
        break;
      case 'Tab':
        this.close(true);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (next !== undefined) entries[next]?.focus();
  }
}

/** What each item element runs, kept off the DOM. */
const actions = new WeakMap<HTMLElement, MenuAction>();

function itemElement(item: MenuItem): HTMLElement {
  if (item === 'separator') {
    const separator = document.createElement('div');
    separator.className = 'nm-menu-separator';
    separator.setAttribute('role', 'separator');
    return separator;
  }
  const element = document.createElement('div');
  element.className = 'nm-menu-item';
  element.tabIndex = -1;
  const kind = item.kind ?? 'action';
  element.setAttribute(
    'role',
    kind === 'radio' ? 'menuitemradio' : kind === 'check' ? 'menuitemcheckbox' : 'menuitem',
  );
  if (kind !== 'action') element.setAttribute('aria-checked', String(Boolean(item.checked)));
  const check = document.createElement('span');
  check.className = 'nm-menu-check';
  check.setAttribute('aria-hidden', 'true');
  if (item.checked) check.textContent = '✓';
  const label = document.createElement('span');
  label.className = 'nm-menu-label';
  label.textContent = item.label;
  element.append(check, label);
  if (item.shortcut) {
    const shortcut = document.createElement('span');
    shortcut.className = 'nm-menu-shortcut';
    shortcut.textContent = item.shortcut;
    element.append(shortcut);
    element.setAttribute('aria-keyshortcuts', item.shortcut);
  }
  actions.set(element, item);
  return element;
}
