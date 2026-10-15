import type {
  ImageInfo,
  ModelFormat,
  Motion,
  StructureMessage,
  ValidationMessage,
  ViewerStrings,
} from '../../shared/protocol';
import type { SidePanel } from '../panel';
import type { Shell } from '../shell';
import { inspect, type InspectContext } from './details';
import { referenceOf, type Reference } from './reference';
import { fill, Formatter } from './format';
import { GltfModel } from './gltf';
import { InspectorView, type TexturePreview } from './inspectorView';
import { ancestors, initiallyExpanded, outline, type EntryKey } from './outline';
import { entryAt, entryPointer } from './pointers';
import { buildReport } from './report';
import { sizeAnalysis } from './sizes';
import { SizeView } from './sizeView';
import { statistics } from './statistics';
import { StatisticsView } from './statisticsView';
import { StructureTree } from './tree';
import { ModelUsage } from './usage';
import { ValidationView } from './validationView';

export interface StructureEvents {
  /** The selection changed: in the tree, through a link, or from the 3D view. */
  selected(key: EntryKey): void;
  /** The user asked to see an entry in the 3D view. */
  activated(key: EntryKey): void;
  /** Text to put on the clipboard. */
  copy(text: string): void;
  /** The user asked to see a place in the glTF JSON. */
  showJson(pointer: string): void;
  /** A texture's image as the 3D view has it, for the inspector to show. */
  preview(texture: number): Promise<TexturePreview>;
}

/**
 * The structure tree on the left, and on the right the inspector and the statistics, filled from
 * the model's JSON as soon as it arrives. Selecting in the tree, or following a link, shows that
 * entry's details.
 */
export class StructureView {
  private readonly tree: StructureTree;
  private readonly inspector: InspectorView;
  private readonly statistics: StatisticsView;
  private readonly validation: ValidationView;
  private readonly size: SizeView;
  /** Each image's own bytes, from the host. */
  private imageBytes: readonly (number | null)[] | undefined;
  private readonly panel: SidePanel;
  private readonly format: Formatter;
  private context: InspectContext | undefined;
  /** Who uses accessors, bufferViews and images: read when first asked for. */
  private usage: ModelUsage | undefined;
  private json: string | undefined;
  private selected: EntryKey = 'model';

  constructor(
    shell: Shell,
    private readonly strings: ViewerStrings,
    private readonly locale: string,
    private readonly events: StructureEvents,
  ) {
    this.format = new Formatter(locale);
    this.tree = new StructureTree(
      strings.structure.structure,
      (key) => this.show(key),
      (key) => events.activated(key),
    );
    this.inspector = new InspectorView(
      (key) => this.select(key),
      (texture) => events.preview(texture),
      strings.structure.labels.noPreview,
    );
    this.statistics = new StatisticsView(strings.structure, this.format, (key) => this.select(key));
    this.validation = new ValidationView(strings.validation, this.format, {
      entryAt: (pointer) => this.entryAt(pointer),
      describe: (key) => this.describe(key),
      select: (key) => this.select(key),
      showJson: (pointer) => events.showJson(pointer),
    });
    this.size = new SizeView(
      strings.size,
      strings.structure,
      this.format,
      (key) => this.select(key),
      (text) => events.copy(text),
    );
    this.panel = shell.inspectorPanel;
    shell.structurePanel.body.replaceChildren(this.tree.element);
    shell.inspectorPanel.setTabs(
      [
        { id: 'inspector', label: strings.structure.inspector, content: this.inspector.element },
        { id: 'statistics', label: strings.structure.statistics, content: this.statistics.element },
        { id: 'validation', label: strings.validation.tab, content: this.validation.element },
        { id: 'size', label: strings.size.tab, content: this.size.element },
      ],
      shell.inspectorTab,
      (tab) => (shell.inspectorTab = tab),
    );
  }

  /**
   * Shows a model's structure. When the file changed on disk, what was open and selected stays
   * open and selected, as far as the new structure still has it.
   */
  setStructure(message: StructureMessage, fileName: string, format: ModelFormat): void {
    if (message.reload && message.json === this.json) return;
    let json: unknown;
    try {
      json = JSON.parse(message.json);
    } catch {
      json = {};
    }
    const model = new GltfModel(json);
    const keep = message.reload && this.context !== undefined;
    this.context = {
      model,
      strings: this.strings.structure,
      format: this.format,
      file: { name: fileName, size: message.fileSize, container: format, chunks: message.chunks },
      // A changed file keeps its last report until it is validated again.
      validation: keep ? this.context?.validation : undefined,
    };
    this.json = message.json;
    this.usage = undefined;
    if (!keep) {
      this.validation.reset();
      this.showBadge();
    }
    if (!keep || !inspect(this.context, this.selected)) this.selected = 'model';
    const expanded = keep ? this.tree.expandedKeys() : initiallyExpanded(model);
    this.tree.setEntries(outline(model, this.strings.structure), expanded, this.selected, keep);
    this.imageBytes = undefined;
    this.statistics.show(statistics(model), model);
    this.showSize();
    this.show(this.selected, keep);
  }

  /** Image sizes from the host: they fill in texture details and the texture memory. */
  setImages(images: readonly (ImageInfo | null)[], bytes: readonly (number | null)[]): void {
    if (!this.context) return;
    this.context.images = images;
    this.imageBytes = bytes;
    this.showStatistics();
    this.showSize();
    this.render(true);
  }

  private showSize(): void {
    if (!this.context) return;
    const { model, file, images } = this.context;
    const analysis = sizeAnalysis(model, this.modelUsage(), {
      fileName: file.name,
      fileSize: file.size,
      chunks: file.chunks,
      images,
      imageBytes: this.imageBytes,
    });
    this.size.show(analysis, model);
  }

  private showStatistics(): void {
    if (!this.context) return;
    const { model, images, motion } = this.context;
    this.statistics.show(statistics(model, images, motion), model);
  }

  /** Whether each animation moves anything, from the host: the inspector says so. */
  setMotion(motion: readonly (Motion | null)[]): void {
    if (!this.context) return;
    this.context.motion = motion;
    this.showStatistics();
    this.render(true);
  }

  /** What the glTF Validator says about the model, from the host. */
  setValidation(message: ValidationMessage): void {
    this.validation.set(message);
    this.showBadge();
    if (!this.context) return;
    const counts = this.validation.report?.counts;
    const strings = this.strings.validation;
    this.context.validation =
      counts &&
      (Object.values(counts).every((count) => count === 0)
        ? strings.noIssues
        : fill(strings.badge, counts.error, counts.warning));
    this.render(true);
  }

  /** Errors and warnings, counted on the validation tab. */
  private showBadge(): void {
    const counts = this.validation.report?.counts;
    const problems = counts ? counts.error + counts.warning : 0;
    this.panel.setBadge(
      'validation',
      problems > 0 ? this.format.count(problems) : undefined,
      counts && fill(this.strings.validation.badge, counts.error, counts.warning),
    );
  }

  private modelUsage(): ModelUsage {
    this.usage ??= new ModelUsage(this.context!.model);
    return this.usage;
  }

  /** Shows the selected entry's details again, now that the 3D view can preview more of it. */
  refresh(): void {
    this.render(true);
  }

  /** A node's name, if it has one. */
  nodeName(index: number): string | undefined {
    return this.context?.model.displayName('nodes', index);
  }

  /** Each animation's name, or its kind and index when it has none, by glTF index. */
  animationNames(): string[] {
    const model = this.context?.model;
    if (!model) return [];
    return model
      .items('animations')
      .map(
        (_, index) =>
          model.displayName('animations', index) ??
          `${this.strings.structure.kinds.animation} ${index}`,
      );
  }

  /**
   * A reference to `key` for a chat with an AI assistant or a note: where it is in the model,
   * and with `details` what the inspector says about it.
   */
  reference(key: EntryKey, details: boolean): Reference | undefined {
    return this.context && referenceOf(this.context, key, this.locale, details);
  }

  /** A report on the model, in Markdown and JSON, from what the panels show. */
  report(): { markdown: string; json: string } | undefined {
    if (!this.context) return undefined;
    const { model, images, motion, file } = this.context;
    return buildReport({
      context: this.context,
      strings: this.strings,
      statistics: statistics(model, images, motion),
      size: sizeAnalysis(model, this.modelUsage(), {
        fileName: file.name,
        fileSize: file.size,
        chunks: file.chunks,
        images,
        imageBytes: this.imageBytes,
      }),
      validation: this.validation.report,
    });
  }

  /** The JSON pointer of an entry, to show it in the glTF JSON. */
  pointerOf(key: EntryKey): string {
    return entryPointer(key);
  }

  /** The entry a JSON pointer is in, or leads to. */
  entryAt(pointer: string): EntryKey | undefined {
    return this.context && entryAt(this.context.model, this.modelUsage(), pointer);
  }

  /** Selects `key` in the tree, opening what holds it, and shows its details. */
  select(key: EntryKey): void {
    if (!this.context) return;
    this.tree.select(key, ancestors(this.context.model, key));
    this.show(key);
  }

  /** An entry as screen readers say it: its name, then its kind and index. */
  describe(key: EntryKey): string | undefined {
    const inspection = this.context && inspect(this.context, key);
    return inspection && `${inspection.title}, ${inspection.kind}`;
  }

  private show(key: EntryKey, sameEntry = false): void {
    if (!this.context) return;
    this.selected = key;
    this.render(sameEntry);
    this.events.selected(key);
  }

  private render(sameEntry: boolean): void {
    if (this.context) this.inspector.show(inspect(this.context, this.selected), sameEntry);
  }
}
