import type { Inspection, Row } from './details';
import type { EntryKey } from './outline';

/** A texture's image to preview, `compressed` when it can't be read back, or nothing yet. */
export type TexturePreview =
  { image: CanvasImageSource; width: number; height: number } | 'compressed' | undefined;

/** The largest side of a texture preview, in CSS pixels. */
const PREVIEW_SIZE = 256;

/**
 * The inspector's content: a heading for the selected entry, then its sections as label and
 * value pairs. Values can be selected and copied; links select what they name.
 */
export class InspectorView {
  readonly element: HTMLElement;
  private readonly heading: HTMLElement;
  private readonly title: HTMLElement;
  private readonly kind: HTMLElement;
  private readonly body: HTMLElement;

  private previewToken = 0;

  constructor(
    private readonly onLink: (key: EntryKey) => void,
    private readonly loadPreview: (texture: number) => Promise<TexturePreview>,
    private readonly noPreview: string,
  ) {
    this.element = document.createElement('div');
    this.element.className = 'nm-inspector-content';
    this.element.innerHTML = `
      <div class="nm-inspector-heading">
        <span class="nm-inspector-title"></span>
        <span class="nm-inspector-kind"></span>
      </div>
      <div class="nm-inspector-body" tabindex="0"></div>`;
    this.heading = this.element.querySelector('.nm-inspector-heading') as HTMLElement;
    this.title = this.element.querySelector('.nm-inspector-title') as HTMLElement;
    this.kind = this.element.querySelector('.nm-inspector-kind') as HTMLElement;
    this.body = this.element.querySelector('.nm-inspector-body') as HTMLElement;
    this.body.addEventListener('click', (event) => {
      const key = (event.target as HTMLElement).closest<HTMLElement>('[data-key]')?.dataset.key;
      if (key !== undefined) this.onLink(key);
    });
  }

  /** Shows `inspection`, keeping the scroll position when it is the same entry again. */
  show(inspection: Inspection | undefined, sameEntry = false): void {
    const scroll = sameEntry ? this.body.scrollTop : 0;
    this.heading.hidden = !inspection;
    this.title.textContent = inspection?.title ?? '';
    this.title.title = inspection?.title ?? '';
    this.kind.textContent = inspection?.kind === inspection?.title ? '' : (inspection?.kind ?? '');
    this.body.replaceChildren(
      ...(inspection?.sections ?? []).map((section) => {
        const element = document.createElement('section');
        element.className = 'nm-section';
        if (section.title) {
          const title = document.createElement('h3');
          title.className = 'nm-section-title';
          title.textContent = section.title;
          element.append(title);
        }
        const list = document.createElement('dl');
        list.className = 'nm-props';
        for (const row of section.rows) list.append(...rowElements(row));
        element.append(list);
        return element;
      }),
    );
    this.body.scrollTop = scroll;
    const token = ++this.previewToken;
    if (inspection?.preview !== undefined) {
      void this.loadPreview(inspection.preview).then((preview) => {
        if (token === this.previewToken) this.showPreview(preview);
      });
    }
  }

  /** Draws a texture's image above its details, scaled down to fit, on a checkerboard for alpha. */
  private showPreview(preview: TexturePreview): void {
    if (!preview) return;
    const figure = document.createElement('figure');
    figure.className = 'nm-preview';
    if (preview === 'compressed') {
      const caption = document.createElement('figcaption');
      caption.textContent = this.noPreview;
      figure.append(caption);
    } else {
      const scale = Math.min(1, PREVIEW_SIZE / Math.max(preview.width, preview.height, 1));
      const width = Math.max(1, Math.round(preview.width * scale));
      const height = Math.max(1, Math.round(preview.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * devicePixelRatio);
      canvas.height = Math.round(height * devicePixelRatio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.imageSmoothingQuality = 'high';
      context.drawImage(preview.image, 0, 0, canvas.width, canvas.height);
      figure.append(canvas);
    }
    this.body.prepend(figure);
  }
}

function rowElements(row: Row): HTMLElement[] {
  const label = document.createElement('dt');
  label.textContent = row.label;
  label.title = row.label;
  const value = document.createElement('dd');
  if (row.json !== undefined) {
    // JSON takes the full width, below its label.
    label.className = 'nm-prop-wide';
    value.className = 'nm-prop-wide';
    const pre = document.createElement('pre');
    pre.className = 'nm-json';
    pre.textContent = row.json;
    value.append(pre);
    return row.label ? [label, value] : [value];
  }
  if (row.swatch) {
    const swatch = document.createElement('span');
    swatch.className = 'nm-swatch';
    swatch.style.setProperty('--nm-swatch', row.swatch);
    value.append(swatch);
  }
  row.links?.forEach((link, index) => {
    if (index > 0) value.append(', ');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nm-link';
    button.dataset.key = link.key;
    button.textContent = link.text;
    value.append(button);
  });
  if (row.text !== undefined) {
    const text = document.createElement('span');
    text.className = row.mono ? 'nm-mono' : '';
    text.textContent = row.links?.length ? ` ${row.text}` : row.text;
    value.append(text);
  }
  if (row.note !== undefined) {
    const note = document.createElement('span');
    note.className = 'nm-note';
    note.textContent = row.note;
    value.append(note);
  }
  if (row.wide) {
    value.classList.add('nm-prop-wide');
    return [value];
  }
  return [label, value];
}
