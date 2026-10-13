import type { ModelFormat } from '../shared/protocol';
import { icons } from './icons';

/** The static frame around a model: toolbar, viewport and status overlays. */
export class Shell {
  readonly viewport: HTMLElement;
  private readonly root: HTMLElement;
  private readonly fileName: HTMLElement;
  private readonly error: HTMLElement;

  constructor(container: HTMLElement) {
    container.innerHTML = `
      <div class="nm-shell">
        <header class="nm-toolbar">
          <div class="nm-title">
            <span class="nm-file-icon">${icons.model}</span>
            <span class="nm-file-name"></span>
          </div>
        </header>
        <main class="nm-viewport" tabindex="0">
          <div class="nm-error" role="alert" hidden>
            <div class="nm-error-icon">${icons.error}</div>
            <h1 class="nm-error-title"></h1>
            <p class="nm-error-message"></p>
          </div>
        </main>
      </div>`;

    const find = <T extends HTMLElement>(selector: string) =>
      container.querySelector(selector) as T;
    this.root = find('.nm-shell');
    this.fileName = find('.nm-file-name');
    this.viewport = find('.nm-viewport');
    this.error = find('.nm-error');
  }

  setDocument(fileName: string, format: ModelFormat): void {
    this.root.dataset.format = format;
    this.fileName.textContent = fileName;
    this.fileName.title = fileName;
    document.title = fileName;
    this.viewport.setAttribute('aria-label', fileName);
  }

  /** Shows a message over the viewport, in place of the model. */
  showError(title: string, message: string): void {
    (this.error.querySelector('.nm-error-title') as HTMLElement).textContent = title;
    (this.error.querySelector('.nm-error-message') as HTMLElement).textContent = message;
    this.error.hidden = false;
  }

  hideError(): void {
    this.error.hidden = true;
  }
}
