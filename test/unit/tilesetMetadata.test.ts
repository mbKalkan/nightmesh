import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { viewerStrings, type Translate } from '../../src/extension/texts';
import { Formatter } from '../../src/webview/structure/format';
import {
  inspectTileset,
  TilesetModel,
  type TilesetContext,
} from '../../src/webview/structure/tileset';
import { entityValues, readSchema } from '../../src/webview/structure/tilesetMetadata';

const english: Translate = (message, ...args) =>
  message.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)]));
const strings = viewerStrings(english);
const fixture = (name: string) => readFileSync(resolve('test/fixtures/tiles', name), 'utf8');
const district = fixture('metadata.json');
const schema = JSON.parse(fixture('metadata-schema.json')) as object;

const context = (json: string, withSchema?: object): TilesetContext => ({
  model: new TilesetModel(json, withSchema),
  fileName: 'tileset.json',
  fileSize: json.length,
  strings: strings.tileset,
  fileSizeLabel: strings.structure.labels.fileSize,
  format: new Formatter('en'),
});

/** An inspection's rows as `label: text (note)`, by section. */
const rows = (json: string, key: string, withSchema?: object) =>
  Object.fromEntries(
    (inspectTileset(context(json, withSchema), key)?.sections ?? []).map((section) => [
      section.title,
      section.rows.map(
        (row) => `${row.label}: ${row.text ?? row.json}${row.note ? ` (${row.note})` : ''}`,
      ),
    ]),
  );

describe('tileset metadata', () => {
  it("shows the tileset's own metadata, its schema and statistics", () => {
    const sections = rows(district, 'model', schema);
    expect(sections.Metadata).toEqual([
      'Class: district (District)',
      'name: Old town',
      'founded: 1453',
      'tags: ["historic", "coastal"]',
    ]);
    expect(sections['Metadata schema']).toEqual([
      'Schema file: metadata-schema.json',
      'ID: district',
      'Name: District',
      'Version: 1.0.0',
      'Classes: district, quarter, building, zone',
      'Enums: landUse',
      'Groups: 2',
    ]);
    expect(sections['Metadata statistics']).toEqual([
      'Class: quarter (3 entities)',
      'height: min 12 · max 30 · mean 20',
      'landUse: Residential 1 · Commercial 1 · Park 1',
    ]);
  });

  it("reads a tile's values as its class says, with defaults and no-data values", () => {
    const quarter = (path: string) => rows(district, `tile:${path}`, schema).Metadata;
    expect(quarter('0/0')).toEqual([
      'Class: quarter (Quarter)',
      'landUse: Residential',
      'coverage: 100',
      'height: 18 (TILE_MAXIMUM_HEIGHT)',
      'trees: 120',
      'surveyed: true',
    ]);
    expect(quarter('0/1')).toContain('coverage: 74.902');
    expect(quarter('0/1')).toContain('surveyed: false (default)');
    expect(quarter('0/2')).toContain('trees: 0 (no data)');
  });

  it("shows a content's metadata and the group it is in", () => {
    const sections = rows(district, 'tile:0/2', schema);
    expect(sections.Content).toEqual([
      ': south-east.b3dm',
      'Type: Batched 3D Model (b3dm)',
      'Group: 1',
    ]);
    expect(sections['Content metadata']).toEqual([
      'Class: building',
      'floors: 4',
      'architect: Studio 3',
    ]);
    expect(sections['Group 1']).toEqual(['Class: zone', 'label: East', 'color: [255, 128, 0]']);
  });

  it('shows the values as written when the schema is missing', () => {
    const sections = rows(district, 'tile:0/2');
    expect(sections.Metadata).toContain('trees: 65535');
    expect(sections.Metadata).toContain('coverage: 64');
    expect(rows(district, 'model')['Metadata schema']).toEqual([
      'Schema file: metadata-schema.json',
      'Groups: 2',
    ]);
  });

  it("reads 1.0's 3DTILES_metadata and 3DTILES_multiple_contents", () => {
    const entity = (value: object) => ({ extensions: { '3DTILES_metadata': value } });
    const json = JSON.stringify({
      asset: { version: '1.0' },
      properties: { Height: { minimum: 1, maximum: 85.5 } },
      ...entity({
        schema: {
          classes: {
            city: { properties: { name: { type: 'STRING' } } },
            tile: { properties: { level: { type: 'SCALAR', componentType: 'UINT8' } } },
          },
        },
        tileset: { class: 'city', properties: { name: 'Istanbul' } },
        groups: { harbour: { class: 'city', properties: { name: 'Port' } } },
      }),
      root: {
        extensions: {
          '3DTILES_metadata': { class: 'tile', properties: { level: 0 } },
          '3DTILES_multiple_contents': {
            contents: [
              { uri: 'a.b3dm', ...entity({ group: 'harbour' }) },
              { uri: 'b.pnts', ...entity({ class: 'city', properties: { name: 'Points' } }) },
            ],
          },
        },
      },
    });
    const model = rows(json, 'model');
    expect(model.Metadata).toEqual(['Class: city', 'name: Istanbul']);
    expect(model['Feature properties']).toEqual(['Height: 1 to 85.5']);
    const tile = rows(json, 'tile:0');
    expect(tile.Metadata).toEqual(['Class: tile', 'level: 0']);
    expect(tile.Content).toContain('Group: harbour');
    expect(tile['Content metadata (b.pnts)']).toEqual(['Class: city', 'name: Points']);
    expect(tile['Group harbour']).toEqual(['Class: city', 'name: Port']);
  });

  it('scales and offsets each component, and names enums written as numbers', () => {
    const read = readSchema({
      enums: { kind: { values: [{ name: 'Road', value: 7 }] } },
      classes: {
        c: {
          properties: {
            v: { type: 'VEC2', componentType: 'FLOAT32', offset: [10, 20], scale: 2 },
            n: { type: 'SCALAR', componentType: 'INT8', normalized: true },
            k: { type: 'ENUM', enumType: 'kind', array: true },
            i: { type: 'SCALAR', componentType: 'UINT8', offset: 5 },
          },
        },
      },
    });
    const values = entityValues(
      { className: 'c', properties: { v: [1, 2], n: -128, k: [7, 3], i: 1, extra: 'x' } },
      read,
    );
    expect(values.map(({ name, value }) => [name, value])).toEqual([
      ['v', [12, 24]],
      ['n', -1],
      ['k', ['Road', 3]],
      // Integers that aren't normalized are taken as they are.
      ['i', 1],
      ['extra', 'x'],
    ]);
  });
});
