import { isGltfFormat } from '../shared/formats';
import type { ModelFormat, PanelLayout, ViewerStrings } from '../shared/protocol';
import { icons } from './icons';
import { SidePanel } from './panel';

/** What the corner of the view shows of a measurement, written out. */
export interface MeasurementBadge {
  /** What it is, as a tooltip. */
  title: string;
  /** All of it, for screen readers: the hint, or the distance with X, Y and Z. */
  description: string;
  /** Once both points are placed: the distance, and along X, Y and Z. */
  total?: string;
  axes?: readonly string[];
}

/** Loading that takes longer than this, in milliseconds, is said in the view. */
const LOADING_DELAY = 250;

/**
 * The static frame around a model: toolbar, progress, the viewport and its overlays, and the
 * structure and inspector panels on either side once there is a structure to show.
 */
export class Shell {
  readonly viewport: HTMLElement;
  /** Open the Shading and View menus, once there is a 3D view. */
  readonly shadingButton: HTMLButtonElement;
  readonly viewButton: HTMLButtonElement;
  /** Opens the Export menu. */
  readonly exportButton: HTMLButtonElement;
  /** Starts and stops measuring, once there is a 3D view. */
  readonly measureButton: HTMLButtonElement;
  readonly structurePanel: SidePanel;
  readonly inspectorPanel: SidePanel;
  private readonly root: HTMLElement;
  private readonly toggles: HTMLElement;
  /** The viewport, and below it the bar for a model's animations. */
  private readonly center: HTMLElement;
  private readonly measureBadge: HTMLElement;
  /** The size last given, shown again once a measurement no longer takes its place. */
  private lastSize: Parameters<Shell['setSize']> | undefined;
  private measurement: MeasurementBadge | undefined;
  private strings: ViewerStrings | undefined;
  private readonly fileName: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly error: HTMLElement;
  private readonly notice: HTMLElement;
  private readonly loading: HTMLElement;
  private readonly large: HTMLElement;
  private loadingTimer: ReturnType<typeof setTimeout> | undefined;
  private onDraw: (() => void) | undefined;

  private panelsAvailable = false;
  /**
   * The structure panel starts closed in a viewer too narrow for both panels and the view, such
   * as each side of a comparison; the user's layout stays as it is. Undefined until decided.
   */
  private narrowed: boolean | undefined;

  constructor(
    container: HTMLElement,
    private readonly layout: PanelLayout,
    private readonly events: {
      layoutChanged(layout: PanelLayout): void;
      frame(): void;
      json(): void;
      measure(): void;
    },
  ) {
    container.innerHTML = `
      <div class="nm-shell">
        <header class="nm-toolbar">
          <div class="nm-title">
            <span class="nm-file-icon">${icons.model}</span>
            <span class="nm-file-name"></span>
          </div>
          <div class="nm-actions" hidden>
            <button class="nm-icon-button nm-menu-button" data-action="shading" type="button" hidden>${icons.shading}${icons.chevronDown}</button>
            <button class="nm-icon-button nm-menu-button" data-action="view" type="button" hidden>${icons.view}${icons.chevronDown}</button>
            <button class="nm-icon-button" data-action="measure" type="button" aria-pressed="false" hidden>${icons.ruler}</button>
            <button class="nm-icon-button" data-action="frame" type="button">${icons.frame}</button>
            <button class="nm-icon-button" data-action="json" type="button">${icons.json}</button>
            <button class="nm-icon-button nm-menu-button" data-action="export" type="button">${icons.export}${icons.chevronDown}</button>
            <span class="nm-separator"></span>
            <button class="nm-icon-button" data-panel="structure" type="button">${icons.panelLeft}</button>
            <button class="nm-icon-button" data-panel="inspector" type="button">${icons.panelRight}</button>
          </div>
        </header>
        <div class="nm-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" hidden>
          <div class="nm-progress-bar"></div>
        </div>
        <div class="nm-body">
          <div class="nm-center">
            <main class="nm-viewport" tabindex="0" aria-describedby="nm-view-keys">
              <section class="nm-notice" role="status" hidden>
                <div class="nm-notice-header">
                  <span class="nm-notice-icon">${icons.warning}</span>
                  <h2 class="nm-notice-title"></h2>
                  <button class="nm-icon-button" data-action="close-notice" type="button">${icons.close}</button>
                </div>
                <ul class="nm-notice-list"></ul>
              </section>
              <div class="nm-measure" role="note" hidden></div>
              <p class="nm-sr-only" id="nm-view-keys"></p>
              <div class="nm-sr-only" role="status" aria-live="polite" data-announcer></div>
              <div class="nm-loading" role="status" hidden>
                <div class="nm-loading-title"></div>
                <div class="nm-loading-detail" aria-hidden="true"></div>
              </div>
              <section class="nm-large" hidden>
                <h2 class="nm-large-title"></h2>
                <p class="nm-large-message"></p>
                <button class="nm-button" data-action="draw" type="button"></button>
              </section>
              <div class="nm-error" role="alert" hidden>
                <div class="nm-error-icon">${icons.error}</div>
                <h1 class="nm-error-title"></h1>
                <p class="nm-error-message"></p>
                <ul class="nm-error-details"></ul>
              </div>
            </main>
          </div>
        </div>
      </div>`;

    const find = <T extends HTMLElement>(selector: string) =>
      container.querySelector(selector) as T;
    this.root = find('.nm-shell');
    this.fileName = find('.nm-file-name');
    this.progress = find('.nm-progress');
    this.viewport = find('.nm-viewport');
    this.error = find('.nm-error');
    this.notice = find('.nm-notice');
    this.toggles = find('.nm-actions');
    this.measureBadge = find('.nm-measure');
    this.loading = find('.nm-loading');
    this.large = find('.nm-large');
    find('[data-action="draw"]').addEventListener('click', () => {
      this.large.hidden = true;
      this.onDraw?.();
    });
    this.viewButton = find('[data-action="view"]');
    this.shadingButton = find('[data-action="shading"]');
    this.exportButton = find('[data-action="export"]');
    this.measureButton = find('[data-action="measure"]');
    find('[data-action="close-notice"]').addEventListener('click', () => {
      this.notice.hidden = true;
      this.viewport.focus();
    });

    const saveWidths = () => {
      this.layout.structureWidth = this.structurePanel.width;
      this.layout.inspectorWidth = this.inspectorPanel.width;
      this.events.layoutChanged(this.layout);
    };
    this.structurePanel = new SidePanel('left', layout.structureWidth, saveWidths);
    this.inspectorPanel = new SidePanel('right', layout.inspectorWidth, saveWidths);
    this.center = find('.nm-center');
    this.center.before(this.structurePanel.element);
    this.center.after(this.inspectorPanel.element);
    this.toggles.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('button');
      if (button?.dataset.action === 'frame') return this.events.frame();
      if (button?.dataset.action === 'json') return this.events.json();
      if (button?.dataset.action === 'measure') return this.events.measure();
      const panel = button?.dataset.panel as 'structure' | 'inspector' | undefined;
      if (!panel) return;
      if (panel === 'structure' && this.narrowed) this.narrowed = false;
      else {
        this.layout[panel] = !this.layout[panel];
        this.events.layoutChanged(this.layout);
      }
      this.showPanels();
    });
    // A viewer given its structure while out of sight decides once it is shown.
    new ResizeObserver(() => {
      if (!this.panelsAvailable || this.narrowed !== undefined) return;
      this.narrowed = this.tooNarrow();
      if (this.narrowed !== undefined) this.showPanels();
    }).observe(this.center.parentElement!);
  }

  setDocument(fileName: string, format: ModelFormat, strings: ViewerStrings): void {
    this.strings = strings;
    this.root.dataset.format = format;
    // OBJ, STL, PLY and tilesets have no glTF JSON of their own to show.
    (this.toggles.querySelector('[data-action="json"]') as HTMLElement).hidden =
      !isGltfFormat(format);
    this.fileName.textContent = fileName;
    this.fileName.title = fileName;
    document.title = fileName;
    this.viewport.setAttribute('aria-label', fileName);
    (this.viewport.querySelector('#nm-view-keys') as HTMLElement).textContent = strings.viewKeys;
    this.progress.setAttribute('aria-label', strings.loading);
    const close = this.notice.querySelector('[data-action="close-notice"]') as HTMLElement;
    close.title = strings.close;
    close.setAttribute('aria-label', strings.close);
    const { structure } = strings;
    this.structurePanel.setLabels(structure.structure, structure.structureWidth);
    this.inspectorPanel.setLabels(structure.inspector, structure.inspectorWidth);
    for (const button of this.toggles.querySelectorAll<HTMLElement>('button')) {
      const label =
        button.dataset.action === 'view'
          ? strings.view.menu
          : button.dataset.action === 'shading'
            ? strings.shading.menu
            : button.dataset.action === 'frame'
              ? strings.frame
              : button.dataset.action === 'measure'
                ? strings.measure.button
                : button.dataset.action === 'json'
                  ? strings.showJson
                  : button.dataset.action === 'export'
                    ? strings.export.menu
                    : button.dataset.panel === 'structure'
                      ? structure.structure
                      : structure.inspector;
      button.title = label;
      button.setAttribute('aria-label', label);
    }
  }

  get inspectorTab(): string {
    return this.layout.inspectorTab;
  }

  set inspectorTab(tab: string) {
    this.layout.inspectorTab = tab;
    this.events.layoutChanged(this.layout);
  }

  /**
   * Shows how big the selection, or the model, is, along X, Y and Z, in the corner of the view;
   * `undefined` hides it. Each axis takes its color from the axes three.js and Blender draw.
   */
  setSize(
    size: readonly number[] | undefined,
    selection: boolean,
    metres: (value: number) => string,
  ): void {
    this.lastSize = [size, selection, metres];
    // While measuring, the measurement has its place.
    if (this.measurement) return;
    this.measureBadge.hidden = size === undefined;
    if (!size || !this.strings) return;
    const label = selection ? this.strings.selectionSize : this.strings.modelSize;
    const description = `${label}: ${size.map(metres).join(' × ')}`;
    // Measured again while a clip plays: leave it be when nothing changed, text selected in it too.
    if (this.measureBadge.getAttribute('aria-label') === description) return;
    this.measureBadge.title = label;
    this.measureBadge.setAttribute('aria-label', description);
    this.measureBadge.replaceChildren(
      ...['X', 'Y', 'Z'].flatMap((axis, index) => {
        const name = document.createElement('span');
        name.className = `nm-axis nm-axis-${axis.toLowerCase()}`;
        name.textContent = axis;
        const value = document.createElement('span');
        value.className = 'nm-measure-value';
        value.textContent = metres(size[index]);
        return [name, value];
      }),
    );
    this.measureBadge.classList.toggle('nm-measure-selection', selection);
  }

  /** Marks the measure button pressed, and the view as taking clicks for a measurement. */
  setMeasuring(measuring: boolean): void {
    this.measureButton.setAttribute('aria-pressed', String(measuring));
    this.viewport.classList.toggle('nm-measuring', measuring);
  }

  /**
   * Shows a measurement in the corner of the view, where the size is: what to click next, or the
   * distance and how far apart the points are along X, Y and Z. Undefined puts the size back.
   */
  setMeasurement(measurement: MeasurementBadge | undefined): void {
    this.measurement = measurement;
    const badge = this.measureBadge;
    badge.classList.toggle('nm-measure-distance', measurement !== undefined);
    if (!measurement) {
      // Said again, as it was before the measurement took its place.
      badge.removeAttribute('aria-label');
      if (this.lastSize) this.setSize(...this.lastSize);
      else badge.hidden = true;
      return;
    }
    badge.hidden = false;
    badge.classList.remove('nm-measure-selection');
    badge.title = measurement.title;
    badge.setAttribute('aria-label', measurement.description);
    const { total, axes } = measurement;
    if (total === undefined || !axes) {
      const hint = document.createElement('span');
      hint.className = 'nm-measure-hint';
      hint.textContent = measurement.description;
      badge.replaceChildren(hint);
      return;
    }
    const icon = document.createElement('span');
    icon.className = 'nm-measure-icon';
    icon.innerHTML = icons.ruler;
    const length = document.createElement('span');
    length.className = 'nm-measure-value nm-measure-total';
    length.textContent = total;
    badge.replaceChildren(
      icon,
      length,
      ...['X', 'Y', 'Z'].flatMap((axis, index) => {
        const name = document.createElement('span');
        name.className = `nm-axis nm-axis-${axis.toLowerCase()}`;
        name.textContent = axis;
        const value = document.createElement('span');
        value.className = 'nm-measure-value';
        value.textContent = axes[index];
        return [name, value];
      }),
    );
  }

  /** Puts a bar below the viewport, the full width of the view. */
  addBelowViewport(element: HTMLElement): void {
    this.center.append(element);
  }

  /** Lays the panels out as the user last left them. */
  setLayout(layout: PanelLayout): void {
    Object.assign(this.layout, layout);
    this.structurePanel.setWidth(layout.structureWidth);
    this.inspectorPanel.setWidth(layout.inspectorWidth);
    this.showPanels();
  }

  /** Shows the side panels, as the layout has them, once there is a structure to put in them. */
  setPanelsAvailable(available: boolean): void {
    this.panelsAvailable = available;
    if (available && this.narrowed === undefined) this.narrowed = this.tooNarrow();
    this.showPanels();
  }

  /** Whether the open panels would leave the view less than half of the viewer's width. */
  private tooNarrow(): boolean | undefined {
    const width = this.center.parentElement?.getBoundingClientRect().width ?? 0;
    // A viewer not shown yet has no width: it decides once it has one.
    if (width === 0) return undefined;
    if (!this.layout.structure) return false;
    const panels =
      this.layout.structureWidth + (this.layout.inspector ? this.layout.inspectorWidth : 0);
    return width - panels < width / 2;
  }

  private showPanels(): void {
    const open = {
      structure: this.layout.structure && !this.narrowed,
      inspector: this.layout.inspector,
    };
    this.toggles.hidden = !this.panelsAvailable;
    this.structurePanel.element.hidden = !(this.panelsAvailable && open.structure);
    this.inspectorPanel.element.hidden = !(this.panelsAvailable && open.inspector);
    for (const button of this.toggles.querySelectorAll<HTMLElement>('[data-panel]')) {
      const panel = button.dataset.panel as 'structure' | 'inspector';
      button.setAttribute('aria-pressed', String(open[panel]));
    }
  }

  /** Shows how much of the model has arrived, from 0 to 1; undefined hides the bar. */
  setProgress(fraction: number | undefined): void {
    this.progress.hidden = fraction === undefined;
    this.viewport.setAttribute('aria-busy', String(fraction !== undefined));
    if (fraction === undefined) return;
    const percent = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
    this.progress.setAttribute('aria-valuenow', String(percent));
    this.progress.style.setProperty('--nm-progress', `${percent}%`);
  }

  /**
   * Says the model is loading, in the middle of the view: only once loading has taken a quarter of
   * a second, so a small model just appears.
   */
  startLoading(title: string): void {
    clearTimeout(this.loadingTimer);
    (this.loading.querySelector('.nm-loading-title') as HTMLElement).textContent = title;
    this.setLoadingDetail('');
    this.loadingTimer = setTimeout(() => (this.loading.hidden = false), LOADING_DELAY);
  }

  /** How far it has come: bytes received, or that the model is being built. */
  setLoadingDetail(detail: string): void {
    (this.loading.querySelector('.nm-loading-detail') as HTMLElement).textContent = detail;
  }

  stopLoading(): void {
    clearTimeout(this.loadingTimer);
    this.loading.hidden = true;
  }

  /** Asks before drawing a large model; `draw` runs when the user agrees. */
  askToDraw(title: string, message: string, button: string, draw: () => void): void {
    this.stopLoading();
    (this.large.querySelector('.nm-large-title') as HTMLElement).textContent = title;
    (this.large.querySelector('.nm-large-message') as HTMLElement).textContent = message;
    (this.large.querySelector('[data-action="draw"]') as HTMLElement).textContent = button;
    this.onDraw = draw;
    this.large.hidden = false;
  }

  /**
   * Tells screen readers what was picked in the view: the tree, which they would read it from,
   * doesn't have the focus then.
   */
  announce(text: string): void {
    const announcer = this.viewport.querySelector('[data-announcer]') as HTMLElement;
    // The same words twice in a row are said again only if the region changes in between.
    announcer.textContent = '';
    requestAnimationFrame(() => (announcer.textContent = text));
  }

  /** Marks whether a model is on screen or an error is, for tests and assistive tech. */
  setState(state: 'shown' | 'failed'): void {
    this.viewport.dataset.state = state;
  }

  /** Shows a message over the viewport, in place of the model. */
  showError(title: string, message: string, details: readonly string[] = []): void {
    (this.error.querySelector('.nm-error-title') as HTMLElement).textContent = title;
    (this.error.querySelector('.nm-error-message') as HTMLElement).textContent = message;
    fillList(this.error.querySelector('.nm-error-details') as HTMLElement, details);
    this.error.hidden = false;
    this.notice.hidden = true;
    this.measureBadge.hidden = true;
    this.large.hidden = true;
    this.stopLoading();
    this.setState('failed');
  }

  hideError(): void {
    this.error.hidden = true;
  }

  /** Lists what couldn't be loaded above the model, or hides the list when it is empty. */
  setNotices(title: string, notices: readonly string[]): void {
    (this.notice.querySelector('.nm-notice-title') as HTMLElement).textContent = title;
    fillList(this.notice.querySelector('.nm-notice-list') as HTMLElement, notices);
    this.notice.hidden = notices.length === 0;
  }
}

function fillList(list: HTMLElement, items: readonly string[]): void {
  list.replaceChildren(
    ...items.map((item) => {
      const element = document.createElement('li');
      element.textContent = item;
      return element;
    }),
  );
  list.hidden = items.length === 0;
}
