import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { StructuralMetadata } from '3d-tiles-renderer/src/three/plugins/gltf/metadata/classes/StructuralMetadata.js';
import { MeshFeatures } from '3d-tiles-renderer/src/three/plugins/gltf/metadata/classes/MeshFeatures.js';
import { BufferAttribute, BufferGeometry, DataTexture, Mesh, Points } from 'three';
import { describe, expect, it } from 'vitest';
import { fileResourceOpener } from '../../src/extension/model/fileResources';
import { loadMessages, type ResourceOpener } from '../../src/extension/model/load';
import { memorySource } from '../../src/extension/model/sources';
import { loadTexts, viewerStrings, type Translate } from '../../src/extension/texts';
import type { HostToWebviewMessage, ModelMessage } from '../../src/shared/protocol';
import { surfaceFeatures } from '../../src/webview/scene/features';
import type { ProbeHit } from '../../src/webview/scene/picking';
import { surfaceProbes } from '../../src/webview/scene/surface';
import { featureSection } from '../../src/webview/structure/feature';
import { Formatter } from '../../src/webview/structure/format';

const FIXTURES = resolve('test/fixtures');

const english: Translate = (message, ...args) =>
  message.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)]));

/** The model message for glTF JSON, with the fixtures folder as the model's. */
async function modelOf(json: string, opener?: ResourceOpener): Promise<ModelMessage> {
  const open =
    opener ??
    fileResourceOpener('/fixtures', '/fixtures', (path) =>
      join(FIXTURES, path.slice('/fixtures'.length)),
    );
  const options = { loadId: 1, reload: false, texts: loadTexts(english), format: 'gltf' as const };
  const messages: HostToWebviewMessage[] = [];
  const source = memorySource(new TextEncoder().encode(json));
  for await (const message of loadMessages(source, open, options)) messages.push(message);
  const model = messages.find((message) => message.type === 'model');
  if (!model) throw new Error(`no model: ${JSON.stringify(messages.at(-1))}`);
  return model;
}

/** What a probe reads: a number plus one, low byte first, as the GPU writes it. */
const number = (value: number) =>
  new Uint8Array([(value + 1) & 0xff, ((value + 1) >> 8) & 0xff, (value + 1) >> 16, 255]);

describe('EXT_structural_metadata schema files', () => {
  const points = readFileSync(join(FIXTURES, 'features-points.gltf'), 'utf8');

  it('puts a schema given as a file of its own into the JSON to draw', async () => {
    const model = await modelOf(points);
    const metadata = JSON.parse(model.json).extensions.EXT_structural_metadata;
    expect(metadata.schemaUri).toBeUndefined();
    expect(metadata.schema).toEqual(
      JSON.parse(readFileSync(join(FIXTURES, 'features-schema.json'), 'utf8')),
    );
    expect(model.notices).toEqual([]);
  });

  it('draws the model without its metadata when the schema can’t be read', async () => {
    const missing = await modelOf(points.replace('features-schema.json', 'gone.json'));
    const json = JSON.parse(missing.json);
    expect(json.extensions.EXT_structural_metadata).toBeUndefined();
    expect(json.extensionsUsed).toEqual([]);
    expect(missing.notices).toEqual(["gone.json wasn't found next to the model."]);

    const broken = await modelOf(
      points.replace('features-schema.json', 'data:application/json,%7B%22classes%22'),
    );
    expect(JSON.parse(broken.json).extensions.EXT_structural_metadata).toBeUndefined();
    expect(broken.notices).toHaveLength(1);
  });
});

describe('surfaceFeatures', () => {
  const schema = {
    classes: {
      point: {
        properties: {
          intensity: { type: 'SCALAR', componentType: 'FLOAT32', offset: 1, scale: 2 },
          frame: { type: 'MAT2', componentType: 'FLOAT32' },
          kind: { type: 'SCALAR', componentType: 'UINT8', default: 7 },
        },
      },
      parcel: {
        properties: { area: { type: 'SCALAR', componentType: 'UINT16' } },
      },
    },
  };

  it("reads the property attributes of the point clicked, matrices too, and the class's defaults", () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
    geometry.setAttribute('_intensity', new BufferAttribute(new Float32Array([0, 0.5, 1]), 1));
    geometry.setAttribute(
      '_frame',
      new BufferAttribute(new Float32Array([1, 0, 0, 1, 2, 0, 0, 2, 0, 1, 1, 0]), 4),
    );
    const points = new Points(geometry);
    const definition = {
      schema,
      propertyAttributes: [
        {
          class: 'point',
          properties: { intensity: { attribute: '_INTENSITY' }, frame: { attribute: '_FRAME' } },
        },
      ],
    };
    points.userData.structuralMetadata = new StructuralMetadata(
      definition,
      [],
      [],
      { propertyAttributes: [0] },
      points,
    );
    expect(surfaceProbes(points)).toEqual([{ key: 'vertex', vertex: true }]);
    const hit: ProbeHit = { object: points, bytes: new Map([['vertex', number(1)]]) };
    expect(surfaceFeatures(hit)).toEqual([
      {
        source: 'point',
        id: 1,
        count: 3,
        className: 'point',
        properties: [
          { name: 'intensity', value: 2 },
          { name: 'frame', value: [2, 0, 0, 2] },
          { name: 'kind', value: 7 },
        ],
      },
    ]);
  });

  it('reads feature IDs from a texture’s channels, low byte first, and skips the null feature', () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
    const mesh = new Mesh(geometry);
    const texture = new DataTexture(new Uint8Array(4), 1, 1);
    mesh.userData.meshFeatures = new MeshFeatures(geometry, [texture], {
      featureIds: [
        { featureCount: 300, texture: { index: 0, channels: [2, 0] }, propertyTable: 0 },
        { featureCount: 3, nullFeatureId: 2 },
      ],
    });
    const table = new Uint16Array(300).map((_, i) => i * 10);
    mesh.userData.structuralMetadata = new StructuralMetadata(
      {
        schema,
        propertyTables: [{ class: 'parcel', count: 300, properties: { area: { values: 0 } } }],
      },
      [],
      [table.buffer],
    );
    expect(surfaceProbes(mesh)?.map((probe) => probe.key)).toEqual(['texel:0:0', 'vertex']);
    const hit: ProbeHit = {
      object: mesh,
      // Channel 2 is the low byte, channel 0 the high one: 1 × 256 + 4.
      bytes: new Map([
        ['texel:0:0', new Uint8Array([1, 99, 4, 255])],
        ['vertex', number(2)],
      ]),
    };
    expect(surfaceFeatures(hit)).toEqual([
      {
        source: 'feature',
        id: 260,
        count: 300,
        label: '1',
        className: 'parcel',
        properties: [{ name: 'area', value: 2600 }],
      },
    ]);
  });

  it("reads a row's other properties when one is a number its enum doesn't name", () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
    const mesh = new Mesh(geometry);
    const texture = new DataTexture(new Uint8Array(4), 1, 1);
    mesh.userData.meshFeatures = new MeshFeatures(geometry, [texture], {
      featureIds: [{ featureCount: 2, texture: { index: 0, channels: [0] }, propertyTable: 0 }],
    });
    mesh.userData.structuralMetadata = new StructuralMetadata(
      {
        schema: {
          enums: {
            zone: {
              valueType: 'UINT8',
              values: [
                { name: 'park', value: 0 },
                { name: 'plaza', value: 1 },
              ],
            },
          },
          classes: {
            parcel: {
              properties: {
                area: { type: 'SCALAR', componentType: 'UINT16' },
                zone: { type: 'ENUM', enumType: 'zone' },
              },
            },
          },
        },
        propertyTables: [
          { class: 'parcel', count: 2, properties: { area: { values: 0 }, zone: { values: 1 } } },
        ],
      },
      [],
      [new Uint16Array([100, 200]).buffer, new Uint8Array([1, 7]).buffer],
    );
    const at = (id: number): ProbeHit => ({
      object: mesh,
      bytes: new Map([['texel:0:0', new Uint8Array([id, 0, 0, 255])]]),
    });
    expect(surfaceFeatures(at(0))[0]).toMatchObject({
      className: 'parcel',
      properties: [
        { name: 'area', value: 100 },
        { name: 'zone', value: 'plaza' },
      ],
    });
    expect(surfaceFeatures(at(1))[0]).toMatchObject({
      id: 1,
      className: 'parcel',
      properties: [{ name: 'area', value: 200 }],
    });
  });

  it('reads nothing of an object without feature IDs or metadata', () => {
    expect(surfaceProbes(new Mesh(new BufferGeometry()))).toBeUndefined();
  });
});

describe('featureSection', () => {
  const words = viewerStrings(english).structure.tile;

  it('titles each kind of section and puts short lists on one line', () => {
    const section = featureSection(
      {
        source: 'feature',
        id: 2,
        count: 4,
        label: 'building',
        className: 'house',
        properties: [
          { name: 'flags', value: [true, false] },
          { name: 'names', value: ['One', 'Two'] },
          { name: 'size', value: [1, 2, 3] },
          { name: 'extra', value: { a: 1 } },
        ],
      },
      words,
      new Formatter('en'),
    );
    expect(section.title).toBe('Feature (building)');
    expect(section.rows.map((row) => [row.label, row.text ?? row.json, row.note])).toEqual([
      ['Feature ID', '2', 'of 4'],
      ['Class', 'house', undefined],
      ['flags', '[true, false]', undefined],
      ['names', '["One", "Two"]', undefined],
      ['size', '[1, 2, 3]', undefined],
      ['extra', JSON.stringify({ a: 1 }, null, 2), undefined],
    ]);
    const format = new Formatter('en');
    expect(featureSection({ source: 'texture', properties: [] }, words, format).title).toBe(
      'Texture properties',
    );
    expect(
      featureSection({ source: 'point', id: 5, count: 9, properties: [] }, words, format).rows[0],
    ).toMatchObject({ label: 'Point', text: '5', note: 'of 9' });
  });
});
