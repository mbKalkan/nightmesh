import type { ModelFormat, ViewerStrings } from '../shared/protocol';
import { icons } from './icons';
import { SidePanel } from './panel';

/** Which side panels show and how wide they are; kept with the webview's state. */
export interface PanelLayout {
  structure: boolean;
  inspector: boolean;
  structureWidth: number;
  inspectorWidth: number;
}

/**
 * The static frame around a model: toolbar, progress, the viewport and its overlays, and the
 * structure and inspector panels on either side once there is a structure to show.
 */
export class Shell {
  readonly viewport: HTMLElement;
  readonly structurePanel: SidePanel;
  readonly inspectorPanel: SidePanel;
  private readonly root: HTMLElement;
  private readonly toggles: HTMLElement;
  private readonly fileName: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly error: HTMLElement;
  private readonly notice: HTMLElement;

  private panelsAvailable = false;

  constructor(
    container: HTMLElement,
    private readonly layout: PanelLayout,
    private readonly onLayout: (layout: PanelLayout) => void,
  ) {
    container.innerHTML = `
      <div class="nm-shell">
        <header class="nm-toolbar">
          <div class="nm-title">
            <span class="nm-file-icon">${icons.model}</span>
            <span class="nm-file-name"></span>
          </div>
          <div class="nm-actions" hidden>
            <button class="nm-icon-button" data-panel="structure" type="button">${icons.panelLeft}</button>
            <button class="nm-icon-button" data-panel="inspector" type="button">${icons.panelRight}</button>
          </div>
        </header>
        <div class="nm-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" hidden>
          <div class="nm-progress-bar"></div>
        </div>
        <div class="nm-body">
          <main class="nm-viewport" tabindex="0">
            <section class="nm-notice" role="status" hidden>
              <div class="nm-notice-header">
                <span class="nm-notice-icon">${icons.warning}</span>
                <h2 class="nm-notice-title"></h2>
                <button class="nm-icon-button" data-action="close-notice" type="button">${icons.close}</button>
              </div>
              <ul class="nm-notice-list"></ul>
            </section>
            <div class="nm-error" role="alert" hidden>
              <div class="nm-error-icon">${icons.error}</div>
              <h1 class="nm-error-title"></h1>
              <p class="nm-error-message"></p>
              <ul class="nm-error-details"></ul>
            </div>
          </main>
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
    find('[data-action="close-notice"]').addEventListener('click', () => {
      this.notice.hidden = true;
      this.viewport.focus();
    });

    const saveWidths = () => {
      this.layout.structureWidth = this.structurePanel.width;
      this.layout.inspectorWidth = this.inspectorPanel.width;
      this.onLayout(this.layout);
    };
    this.structurePanel = new SidePanel('left', layout.structureWidth, saveWidths);
    this.inspectorPanel = new SidePanel('right', layout.inspectorWidth, saveWidths);
    this.viewport.before(this.structurePanel.element);
    this.viewport.after(this.inspectorPanel.element);
    this.toggles.addEventListener('click', (event) => {
      const panel = (event.target as HTMLElement).closest<HTMLElement>('[data-panel]')?.dataset
        .panel as 'structure' | 'inspector' | undefined;
      if (!panel) return;
      this.layout[panel] = !this.layout[panel];
      this.onLayout(this.layout);
      this.showPanels();
    });
  }

  setDocument(fileName: string, format: ModelFormat, strings: ViewerStrings): void {
    this.root.dataset.format = format;
    this.fileName.textContent = fileName;
    this.fileName.title = fileName;
    document.title = fileName;
    this.viewport.setAttribute('aria-label', fileName);
    this.progress.setAttribute('aria-label', strings.loading);
    const close = this.notice.querySelector('[data-action="close-notice"]') as HTMLElement;
    close.title = strings.close;
    close.setAttribute('aria-label', strings.close);
    const { structure } = strings;
    this.structurePanel.setLabels(structure.structure, structure.structureWidth);
    this.inspectorPanel.setLabels(structure.inspector, structure.inspectorWidth);
    for (const button of this.toggles.querySelectorAll<HTMLElement>('[data-panel]')) {
      const label =
        button.dataset.panel === 'structure' ? structure.structure : structure.inspector;
      button.title = label;
      button.setAttribute('aria-label', label);
    }
  }

  /** Shows the side panels, as the layout has them, once there is a structure to put in them. */
  setPanelsAvailable(available: boolean): void {
    this.panelsAvailable = available;
    this.showPanels();
  }

  private showPanels(): void {
    this.toggles.hidden = !this.panelsAvailable;
    this.structurePanel.element.hidden = !(this.panelsAvailable && this.layout.structure);
    this.inspectorPanel.element.hidden = !(this.panelsAvailable && this.layout.inspector);
    for (const button of this.toggles.querySelectorAll<HTMLElement>('[data-panel]')) {
      const panel = button.dataset.panel as 'structure' | 'inspector';
      button.setAttribute('aria-pressed', String(this.layout[panel]));
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
