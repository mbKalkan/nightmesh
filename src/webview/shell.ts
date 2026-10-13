import type { ModelFormat } from '../shared/protocol';
import { icons } from './icons';

/** The static frame around a model: toolbar, progress, viewport and its overlays. */
export class Shell {
  readonly viewport: HTMLElement;
  private readonly root: HTMLElement;
  private readonly fileName: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly error: HTMLElement;
  private readonly notice: HTMLElement;

  constructor(container: HTMLElement) {
    container.innerHTML = `
      <div class="nm-shell">
        <header class="nm-toolbar">
          <div class="nm-title">
            <span class="nm-file-icon">${icons.model}</span>
            <span class="nm-file-name"></span>
          </div>
        </header>
        <div class="nm-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" hidden>
          <div class="nm-progress-bar"></div>
        </div>
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
      </div>`;

    const find = <T extends HTMLElement>(selector: string) =>
      container.querySelector(selector) as T;
    this.root = find('.nm-shell');
    this.fileName = find('.nm-file-name');
    this.progress = find('.nm-progress');
    this.viewport = find('.nm-viewport');
    this.error = find('.nm-error');
    this.notice = find('.nm-notice');
    find('[data-action="close-notice"]').addEventListener('click', () => {
      this.notice.hidden = true;
      this.viewport.focus();
    });
  }

  setDocument(
    fileName: string,
    format: ModelFormat,
    labels: { loading: string; close: string },
  ): void {
    this.root.dataset.format = format;
    this.fileName.textContent = fileName;
    this.fileName.title = fileName;
    document.title = fileName;
    this.viewport.setAttribute('aria-label', fileName);
    this.progress.setAttribute('aria-label', labels.loading);
    const close = this.notice.querySelector('[data-action="close-notice"]') as HTMLElement;
    close.title = labels.close;
    close.setAttribute('aria-label', labels.close);
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
