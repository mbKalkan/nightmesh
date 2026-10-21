import type {
  CompareTarget,
  DiffSide,
  ImageInfo,
  LengthUnit,
  MeshCheck,
  ModelFormat,
  ModelSummary,
  Motion,
  StructureMessage,
  ValidationMessage,
  ViewerStrings,
} from '../../shared/protocol';
import { isMeshFormat } from '../../shared/formats';
import type { SidePanel } from '../panel';
import type { Shell } from '../shell';
import { compare, COLLECTIONS, type ChangeKind, type Comparison } from './compare';
import { COLLECTION_KINDS, CompareView } from './compareView';
import { inspect, type InspectContext } from './details';
import { referenceOf, type Reference } from './reference';
import { fill, Formatter } from './format';
import { GltfModel } from './gltf';
import { InspectorView, type TexturePreview } from './inspectorView';
import {
  ancestors,
  entryKey,
  initiallyExpanded,
  outline,
  parseKey,
  type EntryKey,
} from './outline';
import { entryAt, entryPointer } from './pointers';
import { buildReport } from './report';
import { sizeAnalysis } from './sizes';
import { SizeView } from './sizeView';
import { statistics } from './statistics';
import { StatisticsView } from './statisticsView';
import { summarize } from './summary';
import { StructureTree, type TreeMark } from './tree';
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
  /** While the model is compared with another version: its summary, each time it changes. */
  summarized(summary: ModelSummary): void;
  /** The nodes a comparison found added, removed or changed on this side; none once it ends. */
  compared(nodes: { key: EntryKey; kind: ChangeKind }[]): void;
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
  private readonly changes: CompareView;
  /** Which side of a comparison the model is, while VS Code compares two versions of it. */
  private comparing: DiffSide | undefined;
  /** This side and the other in short, while compared, and what differs between them. */
  private summary: ModelSummary | undefined;
  private sentSummary: string | undefined;
  private peerSummary: ModelSummary | undefined;
  private marked = false;
  /** The nodes last said to have changed, to say only what is new. */
  private comparedNodes = '[]';
  /** Each image's own bytes, from the host. */
  private imageBytes: readonly (number | null)[] | undefined;
  private readonly panel: SidePanel;
  private readonly format: Formatter;
  private context: InspectContext | undefined;
  /** Who uses accessors, bufferViews and images: read when first asked for. */
  private usage: ModelUsage | undefined;
  private json: string | undefined;
  private selected: EntryKey = 'model';
  /** glTF and GLB: the formats with JSON of their own, which is validated and sized. */
  private readonly gltf: boolean;

  constructor(
    private readonly shell: Shell,
    private readonly strings: ViewerStrings,
    private readonly locale: string,
    /** The viewer's file format, which stays for its lifetime. */
    modelFormat: ModelFormat,
    private readonly events: StructureEvents,
  ) {
    this.gltf = !isMeshFormat(modelFormat);
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
    this.changes = new CompareView(strings.structure, this.format, (key) => this.select(key));
    this.panel = shell.inspectorPanel;
    shell.structurePanel.body.replaceChildren(this.tree.element);
    this.showTabs(shell.inspectorTab);
  }

  /** The right panel's tabs, with the changes first while two versions are compared. */
  private showTabs(active: string): void {
    const { strings } = this;
    const tabs = [
      ...(this.comparing
        ? [{ id: 'changes', label: strings.structure.compare.tab, content: this.changes.element }]
        : []),
      { id: 'inspector', label: strings.structure.inspector, content: this.inspector.element },
      { id: 'statistics', label: strings.structure.statistics, content: this.statistics.element },
      // The glTF Validator and the size of the file's glTF parts don't apply to a model read
      // from OBJ, STL or PLY.
      ...(this.gltf
        ? [
            { id: 'validation', label: strings.validation.tab, content: this.validation.element },
            { id: 'size', label: strings.size.tab, content: this.size.element },
          ]
        : []),
    ];
    const tab = tabs.some(({ id }) => id === active) ? active : 'inspector';
    // The changes tab is there only while comparing: it isn't the one to open next time.
    this.panel.setTabs(tabs, tab, (id) => {
      if (id !== 'changes') this.shell.inspectorTab = id;
    });
    this.showBadge();
    this.showComparison();
  }

  /**
   * Makes the model one side of a comparison, with the changes in a tab of their own and marked
   * in the tree, or no longer one.
   */
  setComparing(side: DiffSide | undefined): void {
    const tabs = !this.comparing !== !side;
    this.comparing = side;
    this.peerSummary = undefined;
    this.sentSummary = undefined;
    if (tabs) this.showTabs(side ? 'changes' : this.shell.inspectorTab);
    this.summarize();
  }

  /** The other side of the comparison in short, from the host. */
  setPeerSummary(summary: ModelSummary): void {
    if (!this.comparing) return;
    this.peerSummary = summary;
    this.showComparison();
  }

  /** What the other side of a comparison calls `key`, to select it there too. */
  compareTarget(key: EntryKey): CompareTarget {
    const parsed = parseKey(key);
    const collection = COLLECTIONS.find((each) => COLLECTION_KINDS[each] === parsed?.kind);
    const entry = collection && parsed && this.summary?.[collection][parsed.index];
    return collection && entry ? { collection, key: entry.key } : { key };
  }

  /** The entry the other side of a comparison selected, as this side has it, if it does. */
  entryFor(target: CompareTarget): EntryKey | undefined {
    const { collection, key } = target;
    if (!collection) {
      return this.context && (inspect(this.context, key) || this.tree.hasTopLevel(key))
        ? key
        : undefined;
    }
    const entry = this.summary?.[collection].find((each) => each.key === key);
    return entry && entryKey(COLLECTION_KINDS[collection], entry.index);
  }

  /** While compared: this side's summary, for the other side when it changed, compared again. */
  private summarize(): void {
    if (this.comparing && this.context) {
      const { model, file, images, motion, check } = this.context;
      this.summary = summarize(model, {
        fileSize: file.size,
        images,
        imageBytes: this.imageBytes,
        motion,
        check,
      });
      const sent = JSON.stringify(this.summary);
      if (sent !== this.sentSummary) {
        this.sentSummary = sent;
        this.events.summarized(this.summary);
      }
    } else {
      this.summary = undefined;
    }
    this.showComparison();
  }

  private showComparison(): void {
    const side = this.comparing;
    const { summary, peerSummary } = this;
    const comparison =
      side && summary && peerSummary
        ? side === 'original'
          ? compare(summary, peerSummary)
          : compare(peerSummary, summary)
        : undefined;
    if (side) {
      this.changes.show(comparison, side);
      const count = comparison?.changes.length;
      const words = this.strings.structure.compare;
      this.panel.setBadge(
        'changes',
        count ? this.format.count(count) : undefined,
        count === 1 ? words.one : fill(words.many, this.format.count(count ?? 0)),
      );
    }
    const marks = comparison && side ? this.marks(comparison, side) : new Map<EntryKey, TreeMark>();
    if (marks.size > 0 || this.marked) this.tree.setMarks(marks);
    this.marked = marks.size > 0;
    // The 3D view boxes the nodes that changed, as this side has them.
    const nodes = (comparison?.changes ?? []).flatMap((change) => {
      const index = side === 'original' ? change.original : change.modified;
      return change.collection === 'nodes' && index !== undefined
        ? [{ key: entryKey('node', index), kind: change.kind }]
        : [];
    });
    const said = JSON.stringify(nodes);
    if (said !== this.comparedNodes) {
      this.comparedNodes = said;
      this.events.compared(nodes);
    }
  }

  /** The changes on this side, for the tree, and a dot on what holds them. */
  private marks(comparison: Comparison, side: DiffSide): Map<EntryKey, TreeMark> {
    const words = this.strings.structure.compare;
    const marks = new Map<EntryKey, TreeMark>();
    for (const change of comparison.changes) {
      const index = side === 'original' ? change.original : change.modified;
      if (index === undefined) continue;
      const key = entryKey(COLLECTION_KINDS[change.collection], index);
      marks.set(key, { kind: change.kind, label: words[change.kind] });
    }
    const model = this.context?.model;
    if (!model) return marks;
    const contains: TreeMark = { kind: 'contains', label: words.contains };
    for (const key of [...marks.keys()]) {
      for (const above of ancestors(model, key)) {
        if (!marks.has(above)) marks.set(above, contains);
      }
    }
    return marks;
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
      // A changed file keeps its last report until it is validated again, and its check.
      validation: keep ? this.context?.validation : undefined,
      source: message.source,
      check: keep ? this.context?.check : undefined,
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
    this.summarize();
  }

  /** Image sizes from the host: they fill in texture details and the texture memory. */
  setImages(images: readonly (ImageInfo | null)[], bytes: readonly (number | null)[]): void {
    if (!this.context) return;
    this.context.images = images;
    this.imageBytes = bytes;
    this.showStatistics();
    this.showSize();
    this.render(true);
    this.summarize();
  }

  private showSize(): void {
    if (!this.context || !this.gltf) return;
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

  /** Shows lengths in `unit`: an OBJ, STL or PLY file's own. */
  setLengthUnit(unit: LengthUnit): void {
    this.format.setLength(unit);
    this.showStatistics();
    this.render(true);
    if (this.comparing) this.showComparison();
  }

  private showStatistics(): void {
    if (!this.context) return;
    const { model, images, motion } = this.context;
    this.statistics.show(statistics(model, images, motion), model);
  }

  /** The check of an OBJ, STL or PLY model's triangles, from the host. */
  setMeshCheck(check: MeshCheck): void {
    if (!this.context) return;
    this.context.check = check;
    this.render(true);
    this.summarize();
  }

  /** Whether each animation moves anything, from the host: the inspector says so. */
  setMotion(motion: readonly (Motion | null)[]): void {
    if (!this.context) return;
    this.context.motion = motion;
    this.showStatistics();
    this.render(true);
    this.summarize();
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
      size: this.gltf
        ? sizeAnalysis(model, this.modelUsage(), {
            fileName: file.name,
            fileSize: file.size,
            chunks: file.chunks,
            images,
            imageBytes: this.imageBytes,
          })
        : undefined,
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
