import type { Feature } from '../scene/features';
import type { Section } from './details';
import { featureSection, withFeature } from './feature';
import type { TilesetMessage, ViewerStrings } from '../../shared/protocol';
import type { Shell } from '../shell';
import { Formatter } from './format';
import { InspectorView } from './inspectorView';
import type { EntryKey } from './outline';
import {
  TilesetModel,
  inspectTileset,
  tileAncestors,
  tileKey,
  tilesetOutline,
  type TilesLive,
  type TilesetContext,
} from './tileset';
import { StructureTree } from './tree';

export interface TilesetEvents {
  /** The selection changed: in the tree, or from the 3D view. */
  selected(key: EntryKey): void;
  /** The user asked to see an entry in the 3D view. */
  activated(key: EntryKey): void;
}

/**
 * A tileset's panels (D-046): its tiles as the JSON has them on the left, and what the
 * inspector says about the one selected, with what the renderer has of it now.
 */
export class TilesetView {
  private readonly tree: StructureTree;
  private readonly inspector: InspectorView;
  private readonly format: Formatter;
  /** What the metadata says at the point clicked in the view, shown above the tile's details until it changes. */
  private feature: Section[] | undefined;
  private context: TilesetContext | undefined;
  private json: string | undefined;
  private selected: EntryKey = 'model';

  constructor(
    shell: Shell,
    private readonly strings: ViewerStrings,
    locale: string,
    private readonly events: TilesetEvents,
  ) {
    this.format = new Formatter(locale);
    this.tree = new StructureTree(
      strings.tileset.tree,
      (key) => this.show(key),
      (key) => events.activated(key),
    );
    this.inspector = new InspectorView(
      (key) => this.select(key),
      async () => undefined,
      strings.structure.labels.noPreview,
    );
    shell.structurePanel.body.replaceChildren(this.tree.element);
    shell.inspectorPanel.setTabs(
      [{ id: 'inspector', label: strings.structure.inspector, content: this.inspector.element }],
      'inspector',
      () => {},
    );
  }

  /**
   * Shows a tileset's tiles. When the file changed on disk, what was open and selected stays so,
   * as far as the new tileset still has it.
   */
  setTileset(message: TilesetMessage, fileName: string): void {
    if (message.reload && message.json === this.json) return;
    const keep = message.reload && this.context !== undefined;
    const model = new TilesetModel(message.json, message.schema);
    this.context = {
      model,
      fileName,
      fileSize: message.fileSize,
      strings: this.strings.tileset,
      fileSizeLabel: this.strings.structure.labels.fileSize,
      format: this.format,
      live: this.context?.live,
    };
    this.json = message.json;
    if (!keep || !inspectTileset(this.context, this.selected)) this.selected = 'model';
    // The root and its children show at once; the rest open as the user asks.
    const expanded = keep ? this.tree.expandedKeys() : model.root ? [tileKey('0')] : [];
    this.tree.setEntries(
      tilesetOutline(model, fileName, this.strings.tileset),
      expanded,
      this.selected,
      keep,
    );
    this.show(this.selected, keep);
  }

  /** Where the inspector learns what the renderer has of the tiles. */
  setLive(live: TilesLive | undefined): void {
    if (this.context) this.context.live = live;
    this.refresh();
  }

  /** Shows the selected entry again, as the renderer's tiles came or went. */
  refresh(): void {
    if (this.context) this.inspector.show(inspectTileset(this.context, this.selected), true);
  }

  /**
   * Selects `key` in the tree, opening the tiles above it, and shows its details. A tile the
   * file doesn't list, from an external tileset, selects the nearest one above it that it does.
   */
  select(key: EntryKey): void {
    if (!this.context) return;
    while (!inspectTileset(this.context, key)) {
      const slash = key.lastIndexOf('/');
      if (slash < 0) return;
      key = key.slice(0, slash);
    }
    this.tree.select(key, tileAncestors(this.context.model, key));
    this.show(key);
  }

  /** An entry as screen readers say it: its name, then what it is. */
  describe(key: EntryKey): string | undefined {
    const inspection = this.context && inspectTileset(this.context, key);
    return inspection && `${inspection.title}, ${inspection.kind}`;
  }

  /** Shows what the metadata says at the point clicked above the tile's details; none clears it. */
  showFeature(features: readonly Feature[] | undefined): void {
    this.feature = features?.map((feature) =>
      featureSection(feature, this.strings.structure.tile, this.format),
    );
    if (this.context) {
      this.inspector.show(
        withFeature(inspectTileset(this.context, this.selected), this.feature),
        true,
      );
    }
  }

  private show(key: EntryKey, sameEntry = false): void {
    if (!this.context) return;
    if (!sameEntry || key !== this.selected) this.feature = undefined;
    this.selected = key;
    this.inspector.show(withFeature(inspectTileset(this.context, key), this.feature), sameEntry);
    this.events.selected(key);
  }
}
