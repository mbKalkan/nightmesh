import type {
  ImageInfo,
  ModelFormat,
  Motion,
  StructureMessage,
  ViewerStrings,
} from '../../shared/protocol';
import type { Shell } from '../shell';
import { inspect, type InspectContext } from './details';
import { Formatter } from './format';
import { GltfModel } from './gltf';
import { InspectorView, type TexturePreview } from './inspectorView';
import { ancestors, initiallyExpanded, outline, type EntryKey } from './outline';
import { statistics } from './statistics';
import { StatisticsView } from './statisticsView';
import { StructureTree } from './tree';

export interface StructureEvents {
  /** The selection changed: in the tree, through a link, or from the 3D view. */
  selected(key: EntryKey): void;
  /** The user asked to see an entry in the 3D view. */
  activated(key: EntryKey): void;
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
  private readonly format: Formatter;
  private context: InspectContext | undefined;
  private json: string | undefined;
  private selected: EntryKey = 'model';

  constructor(
    shell: Shell,
    private readonly strings: ViewerStrings,
    locale: string,
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
    shell.structurePanel.body.replaceChildren(this.tree.element);
    shell.inspectorPanel.setTabs(
      [
        { id: 'inspector', label: strings.structure.inspector, content: this.inspector.element },
        { id: 'statistics', label: strings.structure.statistics, content: this.statistics.element },
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
    };
    this.json = message.json;
    if (!keep || !inspect(this.context, this.selected)) this.selected = 'model';
    const expanded = keep ? this.tree.expandedKeys() : initiallyExpanded(model);
    this.tree.setEntries(outline(model, this.strings.structure), expanded, this.selected, keep);
    this.statistics.show(statistics(model), model);
    this.show(this.selected, keep);
  }

  /** Image sizes from the host: they fill in texture details and the texture memory. */
  setImages(images: readonly (ImageInfo | null)[]): void {
    if (!this.context) return;
    this.context.images = images;
    this.statistics.show(statistics(this.context.model, images), this.context.model);
    this.render(true);
  }

  /** Whether each animation moves anything, from the host: the inspector says so. */
  setMotion(motion: readonly (Motion | null)[]): void {
    if (!this.context) return;
    this.context.motion = motion;
    this.render(true);
  }

  /** Shows the selected entry's details again, now that the 3D view can preview more of it. */
  refresh(): void {
    this.render(true);
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

  /** Selects `key` in the tree, opening what holds it, and shows its details. */
  select(key: EntryKey): void {
    if (!this.context) return;
    this.tree.select(key, ancestors(this.context.model, key));
    this.show(key);
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
