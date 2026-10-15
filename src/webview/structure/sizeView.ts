import type { SizeStrings, StructureStrings } from '../../shared/protocol';
import { icons } from '../icons';
import { fill, type Formatter } from './format';
import type { GltfModel } from './gltf';
import { entryKey, parseKey, type EntryKey } from './outline';
import type { ImageSize, SizeAnalysis } from './sizes';

const FORMATS: Record<string, string> = {
  png: 'PNG',
  jpeg: 'JPEG',
  webp: 'WebP',
  avif: 'AVIF',
  ktx2: 'KTX2',
  gif: 'GIF',
};

/**
 * The size tab: how big the model is, where its bytes go, how it is compressed, what it takes on
 * the GPU, its largest parts and images, and what could make it smaller. Names link to entries.
 */
export class SizeView {
  readonly element: HTMLElement;

  constructor(
    private readonly strings: SizeStrings,
    private readonly structure: StructureStrings,
    private readonly format: Formatter,
    private readonly onLink: (key: EntryKey) => void,
    /** Puts text on the clipboard, through VS Code. */
    private readonly onCopy: (text: string) => void,
  ) {
    this.element = document.createElement('div');
    this.element.className = 'nm-size';
    this.element.tabIndex = 0;
    this.element.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const key = target.closest<HTMLElement>('[data-key]')?.dataset.key;
      if (key !== undefined) return this.onLink(key);
      const copy = target.closest<HTMLElement>('[data-command]');
      if (copy) this.onCopy(copy.dataset.command ?? '');
    });
  }

  show(analysis: SizeAnalysis, model: GltfModel): void {
    const { strings, format } = this;
    const total = format.bytes(analysis.total);
    const parts: HTMLElement[] = [
      element(
        'p',
        'nm-size-total',
        analysis.files === 1
          ? fill(strings.totalOne, total)
          : fill(strings.totalMany, total, format.count(analysis.files)),
      ),
      title(strings.breakdown),
      this.bars(
        analysis.categories.map(({ category, bytes }) => ({
          label: element('span', '', strings.categories[category]),
          bytes,
        })),
        analysis.total,
      ),
      title(strings.compression),
      this.compression(analysis),
      title(strings.gpuMemory),
      props([
        [strings.geometry, `≈ ${format.bytes(analysis.gpuMemory.geometry)}`],
        [strings.categories.textures, `≈ ${format.bytes(analysis.gpuMemory.textures)}`],
      ]),
    ];
    if (analysis.largest.length > 0) {
      parts.push(
        title(strings.largest),
        this.bars(
          analysis.largest.map(({ key, bytes }) => ({ label: this.link(model, key), bytes })),
          analysis.total,
        ),
      );
    }
    if (analysis.images.length > 0) {
      parts.push(title(strings.images), this.images(analysis.images));
    }
    if (analysis.suggestions.length > 0) {
      parts.push(title(strings.suggestions), this.suggestions(analysis));
    }
    this.element.replaceChildren(...parts);
  }

  /** A row per item: its name, its bytes and share of the whole, and a bar as long as the share. */
  private bars(rows: { label: HTMLElement; bytes: number }[], total: number): HTMLElement {
    const list = document.createElement('ul');
    list.className = 'nm-bars';
    for (const { label, bytes } of rows) {
      const item = document.createElement('li');
      label.classList.add('nm-bar-label');
      const share = total > 0 ? (bytes / total) * 100 : 0;
      const value = element(
        'span',
        'nm-bar-value nm-mono',
        `${this.format.bytes(bytes)} · ${share < 1 && share > 0 ? '<1' : Math.round(share)}%`,
      );
      value.title = `${this.format.count(bytes)} B`;
      const track = element('span', 'nm-bar', '');
      track.setAttribute('aria-hidden', 'true');
      // As long as the share of the whole; the smallest still shows as a sliver.
      track.style.setProperty('--nm-bar', `${Math.max(0.5, share)}%`);
      item.append(label, value, track);
      list.append(item);
    }
    return list;
  }

  private compression(analysis: SizeAnalysis): HTMLElement {
    const { strings, format } = this;
    const { compression } = analysis;
    const geometry: string[] = [];
    if (compression.draco > 0) {
      geometry.push(
        fill(strings.draco, format.count(compression.draco), format.count(compression.primitives)),
      );
    }
    if (compression.meshopt > 0) {
      geometry.push(
        fill(strings.meshopt, format.count(compression.meshopt), format.count(compression.views)),
      );
    }
    if (compression.quantized) geometry.push(strings.quantized);
    const textures = Object.entries(compression.textures)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${format.count(count)} ${FORMATS[name] ?? name.toUpperCase()}`);
    return props([
      [strings.geometry, geometry.join(', ') || strings.none],
      [strings.categories.textures, textures.join(', ') || strings.none],
    ]);
  }

  /** Each image: its name, format, size, bytes and GPU memory, and what may be wrong with it. */
  private images(images: ImageSize[]): HTMLElement {
    const { strings, format } = this;
    const list = document.createElement('ul');
    list.className = 'nm-images';
    for (const image of [...images].sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0))) {
      const item = document.createElement('li');
      const name = image.name || `${this.structure.kinds.image} ${image.image}`;
      item.append(
        image.texture === undefined
          ? element('span', '', name)
          : linkElement(name, entryKey('texture', image.texture)),
      );
      const facts: string[] = [];
      if (image.info) {
        facts.push(FORMATS[image.info.format] ?? image.info.format);
        facts.push(`${image.info.width} × ${image.info.height}`);
      }
      if (image.bytes !== undefined) facts.push(format.bytes(image.bytes));
      if (image.gpuMemory !== undefined) {
        facts.push(`≈ ${format.bytes(image.gpuMemory)} ${this.structure.labels.gpuMemory}`);
      }
      item.append(element('div', 'nm-image-facts', facts.join(' · ')));
      const notes = image.warnings.map((warning) => strings.imageWarnings[warning]);
      if (image.texture === undefined) notes.push(strings.unusedImage);
      for (const note of notes) {
        const line = element('div', 'nm-image-warning', '');
        line.innerHTML = icons.issueWarning;
        line.append(document.createTextNode(note));
        item.append(line);
      }
      list.append(item);
    }
    return list;
  }

  private suggestions(analysis: SizeAnalysis): HTMLElement {
    const { strings, format } = this;
    const container = document.createElement('div');
    container.append(element('p', 'nm-note-line', strings.suggestionsNote));
    for (const suggestion of analysis.suggestions) {
      const words = strings.suggestion[suggestion.kind];
      const block = document.createElement('section');
      block.className = 'nm-suggestion';
      const command = document.createElement('div');
      command.className = 'nm-command';
      const code = element('code', 'nm-json', suggestion.command);
      const copy = element('button', 'nm-icon-button', '');
      copy.innerHTML = icons.copy;
      copy.setAttribute('type', 'button');
      copy.title = strings.copy;
      copy.setAttribute('aria-label', strings.copy);
      copy.dataset.command = suggestion.command;
      command.append(code, copy);
      block.append(
        element('h4', 'nm-suggestion-title', words.title),
        element('p', 'nm-suggestion-text', fill(words.text, format.bytes(suggestion.bytes))),
        command,
      );
      container.append(block);
    }
    return container;
  }

  private link(model: GltfModel, key: EntryKey): HTMLElement {
    const parsed = parseKey(key);
    if (!parsed) return element('span', '', key);
    const collection = (
      {
        mesh: 'meshes',
        texture: 'textures',
        animation: 'animations',
        skin: 'skins',
        node: 'nodes',
      } as const
    )[parsed.kind as 'mesh'];
    const kind = this.structure.kinds[parsed.kind];
    const name =
      (collection && model.displayName(collection, parsed.index)) ?? `${kind} ${parsed.index}`;
    const link = linkElement(name, key);
    link.title = `${name}, ${kind} ${parsed.index}`;
    return link;
  }
}

function element(tag: string, className: string, text: string): HTMLElement {
  const created = document.createElement(tag);
  if (className) created.className = className;
  created.textContent = text;
  return created;
}

function title(text: string): HTMLElement {
  return element('h3', 'nm-section-title', text);
}

function props(rows: [string, string][]): HTMLElement {
  const list = document.createElement('dl');
  list.className = 'nm-props';
  for (const [label, value] of rows) {
    list.append(element('dt', '', label), element('dd', '', value));
  }
  return list;
}

function linkElement(text: string, key: EntryKey): HTMLElement {
  const button = element('button', 'nm-link', text);
  button.setAttribute('type', 'button');
  button.dataset.key = key;
  return button;
}
