import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileSource, memorySource } from '../../src/extension/model/sources';
import { readTileTables } from '../../src/extension/model/tileTables';
import type { TileTablesBytes } from '../../src/shared/protocol';
import { BoxGeometry, Group, InstancedBufferAttribute, InstancedMesh } from 'three';
import { featureOf, instanceFeatures, tablesFromBytes } from '../../src/webview/scene/features';

const FIXTURES = resolve('test/fixtures/tiles');

/** A fixture's tables as the host sends them, read as the webview reads them. */
async function tablesOf(name: string, part?: string) {
  const source = await fileSource(join(FIXTURES, name));
  try {
    const bytes = await readTileTables(source, part);
    if (!bytes) throw new Error(`${name} has no tables`);
    return { bytes, tables: tablesFromBytes(bytes) };
  } finally {
    await source.close();
  }
}

/** Tables made from JSON and a binary body, each table its JSON then its body. */
function made(
  format: TileTablesBytes['format'],
  feature: object,
  batch: object,
  featureBinary = new Uint8Array(),
  batchBinary = new Uint8Array(),
): TileTablesBytes {
  // JSON padded with spaces to 8 bytes, as tiles have it: the binary body after it is aligned.
  const json = (value: object) => {
    const text = JSON.stringify(value);
    return new TextEncoder().encode(text.padEnd(Math.ceil(text.length / 8) * 8, ' '));
  };
  const featureJson = json(feature);
  const bytes = new Uint8Array(featureJson.length + featureBinary.length);
  bytes.set(featureJson);
  bytes.set(featureBinary, featureJson.length);
  const batchJson = json(batch);
  const batchBytes = new Uint8Array(batchJson.length + batchBinary.length);
  batchBytes.set(batchJson);
  batchBytes.set(batchBinary, batchJson.length);
  return {
    format,
    feature: { bytes, json: featureJson.length },
    batch: { bytes: batchBytes, json: batchJson.length },
  };
}

const values = (feature: ReturnType<typeof featureOf>) =>
  Object.fromEntries(feature!.properties.map(({ name, value }) => [name, value]));

describe('tile tables', () => {
  it("reads a b3dm feature's JSON and binary properties by its batch id", async () => {
    const { bytes, tables } = await tablesOf('batched.b3dm');
    expect(bytes.format).toBe('b3dm');
    const market = featureOf(tables, 'batch', 1);
    expect(market).toMatchObject({ id: 1, count: 3 });
    expect(values(market)).toMatchObject({
      name: 'Market',
      year: 1987,
      height: expect.any(Number),
    });
    expect(featureOf(tables, 'batch', 3)).toBeUndefined();
  });

  it('numbers i3dm features by instance and pnts features by point', async () => {
    const posts = await tablesOf('instanced.i3dm');
    expect(featureOf(posts.tables, 'instance', 4)).toMatchObject({
      id: 4,
      count: 9,
      properties: [{ name: 'name', value: 'Post 5' }],
    });
    const points = await tablesOf('points.pnts');
    expect(featureOf(points.tables, 'point', 100)).toMatchObject({ id: 100, count: 1153 });
    expect(values(featureOf(points.tables, 'point', 100))).toHaveProperty('intensity');
  });

  it('reads the tables of a tile inside a composite, by its place', async () => {
    const buildings = await tablesOf('composite.cmpt', '1');
    expect(buildings.bytes.format).toBe('b3dm');
    expect(values(featureOf(buildings.tables, 'batch', 2))).toMatchObject({ name: 'Tower' });
    const posts = await tablesOf('composite.cmpt', '2');
    expect(posts.bytes.format).toBe('i3dm');
    const source = await fileSource(join(FIXTURES, 'composite.cmpt'));
    try {
      expect(await readTileTables(source, '9')).toBeUndefined();
    } finally {
      await source.close();
    }
  });

  it('reads the features of a b3dm tile from before 3D Tiles 1.0, whose header counts them', async () => {
    const batch = new TextEncoder().encode('{"name":["Mill","Barn"]}');
    const glb = readFileSync('test/fixtures/triangle.glb');
    // Magic, version, byte length, batch length, batch table length; no feature table.
    const bytes = new Uint8Array(20 + batch.length + glb.length);
    bytes.set(new TextEncoder().encode('b3dm'));
    const view = new DataView(bytes.buffer);
    [1, bytes.length, 2, batch.length].forEach((word, i) => view.setUint32(4 + 4 * i, word, true));
    bytes.set(batch, 20);
    bytes.set(glb, 20 + batch.length);

    const sent = await readTileTables(memorySource(bytes));
    expect(sent).toMatchObject({ format: 'b3dm', batchLength: 2 });
    expect(featureOf(tablesFromBytes(sent!), 'batch', 1)).toEqual({
      source: 'batch',
      id: 1,
      count: 2,
      properties: [{ name: 'name', value: 'Barn' }],
    });
  });

  it('maps instances and points to the features their BATCH_ID names', () => {
    const tables = tablesFromBytes(
      made(
        'i3dm',
        {
          INSTANCES_LENGTH: 3,
          BATCH_LENGTH: 2,
          BATCH_ID: { byteOffset: 0, componentType: 'UNSIGNED_BYTE' },
        },
        { kind: ['oak', 'pine'] },
        new Uint8Array([1, 0, 1, 0]),
      ),
    );
    expect(featureOf(tables, 'instance', 0)).toMatchObject({ id: 1, count: 3 });
    expect(values(featureOf(tables, 'instance', 1))).toEqual({ kind: 'oak' });
    expect(featureOf(tables, 'instance', 3)).toBeUndefined();
  });

  it("reads a binary vector property's components for the feature, not for the index", () => {
    const tables = tablesFromBytes(
      made(
        'b3dm',
        { BATCH_LENGTH: 2 },
        { place: { byteOffset: 0, componentType: 'FLOAT', type: 'VEC3' } },
        undefined,
        new Uint8Array(new Float32Array([1, 2, 3, 4, 5, 6]).buffer),
      ),
    );
    expect(values(featureOf(tables, 'batch', 1)).place).toEqual([4, 5, 6]);
  });

  it('gives a feature the properties of its class and the classes above it', () => {
    const tables = tablesFromBytes(
      made(
        'b3dm',
        { BATCH_LENGTH: 2 },
        {
          extensions: {
            '3DTILES_batch_table_hierarchy': {
              classes: [
                { name: 'Wall', length: 1, instances: { color: ['white'] } },
                { name: 'Building', length: 1, instances: { name: ['Home'] } },
              ],
              instancesLength: 2,
              classIds: [0, 1],
              parentCounts: [1, 0],
              parentIds: [1],
            },
          },
        },
      ),
    );
    expect(featureOf(tables, 'batch', 0)?.properties).toEqual([
      { name: 'name', value: 'Home', className: 'Building' },
      { name: 'color', value: 'white', className: 'Wall' },
    ]);
  });
});

describe('instanceFeatures', () => {
  /** Three instances whose feature IDs are 2, 0 and 1, under a scene with a table of fruit. */
  function crates(sets: unknown[]) {
    const geometry = new BoxGeometry();
    geometry.setAttribute(
      '_FEATURE_ID_0',
      new InstancedBufferAttribute(new Float32Array([2, 0, 1]), 1),
    );
    const mesh = new InstancedMesh(geometry, undefined, 3);
    mesh.userData.instanceFeatures = sets;
    const fruit = ['Apples', 'Pears', 'Plums'];
    const scene = new Group().add(mesh);
    scene.userData.structuralMetadata = {
      tableAccessors: [
        {
          count: 3,
          definition: { class: 'crate' },
          properties: { fruit: {} },
          getPropertyValue: (_: string, id: number) => fruit[id],
        },
      ],
    };
    return mesh;
  }

  it("reads each set's feature: by its instance attribute, or the instance's number", () => {
    const mesh = crates([
      { featureCount: 3, attribute: 0, propertyTable: 0, label: 'crate' },
      { featureCount: 3 },
    ]);
    expect(instanceFeatures(mesh, 0)).toEqual([
      {
        source: 'feature',
        id: 2,
        count: 3,
        label: 'crate',
        className: 'crate',
        properties: [{ name: 'fruit', value: 'Plums' }],
      },
      { source: 'feature', id: 0, count: 3, label: '2', properties: [] },
    ]);
  });

  it('leaves out the null feature, and sets it cannot read', () => {
    const mesh = crates([
      { featureCount: 3, attribute: 0, nullFeatureId: 2 },
      { featureCount: 3, attribute: 5 },
      'not a set',
      { featureCount: 3, propertyTable: 9 },
    ]);
    expect(instanceFeatures(mesh, 0)).toEqual([
      { source: 'feature', id: 0, count: 3, label: '4', properties: [] },
    ]);
    expect(instanceFeatures(mesh, 1).map((feature) => feature.id)).toEqual([0, 1]);
  });
});
