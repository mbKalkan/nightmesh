import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tableRow, type PropertyTables } from '../../src/webview/structure/propertyTable';
import { entityValues, readSchema } from '../../src/webview/structure/tilesetMetadata';

const fixture = (path: string) => readFileSync(resolve('test/fixtures/tiles/implicit', path));
const schema = readSchema(JSON.parse(fixture('metadata.json').toString()).schema);

/** The subtree's property tables and buffer views, as the renderer's loader reads them. */
function tables(): PropertyTables {
  const bytes = fixture('tables/0/0/0.subtree');
  const jsonLength = Number(bytes.readBigUInt64LE(8));
  const json = JSON.parse(bytes.subarray(24, 24 + jsonLength).toString());
  const binary = bytes.subarray(24 + jsonLength);
  const views: Record<number, Uint8Array> = {};
  json.bufferViews.forEach((view: { byteOffset: number; byteLength: number }, i: number) => {
    views[i] = new Uint8Array(binary.subarray(view.byteOffset, view.byteOffset + view.byteLength));
  });
  return { tables: json.propertyTables, views };
}

describe('a property table row', () => {
  it('reads strings, numbers, enums, booleans and arrays as its class says', () => {
    const row = tableRow(tables(), 0, 3, schema);
    expect(row).toEqual({
      className: 'area',
      properties: { name: 'North-west', height: 26, landUse: 1, surveyed: true, marks: [4, 5, 6] },
    });
    expect(tableRow(tables(), 0, 0, schema)?.properties).toMatchObject({
      surveyed: true,
      marks: [],
    });
    expect(tableRow(tables(), 0, 2, schema)?.properties.surveyed).toBe(false);
    expect(tableRow(tables(), 1, 4, schema)).toEqual({
      className: 'building',
      properties: { floors: 9 },
    });
  });

  it('is read as an entity: enums by name, no data noted', () => {
    const values = entityValues(tableRow(tables(), 0, 4, schema)!, schema);
    expect(values.find((value) => value.name === 'landUse')).toMatchObject({
      value: 'Unknown',
      note: 'noData',
    });
  });

  it("scales and offsets a column's values as the table says, in place of the class", () => {
    const sensor = readSchema({
      classes: {
        sensor: {
          properties: {
            reading: { type: 'SCALAR', componentType: 'FLOAT32', offset: 1, scale: 2 },
            level: { type: 'SCALAR', componentType: 'FLOAT32', offset: 1, scale: 2 },
          },
        },
      },
    });
    const row = tableRow(
      {
        tables: [
          {
            class: 'sensor',
            count: 1,
            properties: { reading: { values: 0, offset: 10, scale: 0.5 }, level: { values: 0 } },
          },
        ],
        views: { 0: new Uint8Array(new Float32Array([4]).buffer) },
      },
      0,
      0,
      sensor,
    )!;
    expect(entityValues(row, sensor).map(({ name, value }) => [name, value])).toEqual([
      ['reading', 12],
      ['level', 9],
    ]);
  });

  it('gives nothing past the table, and only the class without a schema', () => {
    expect(tableRow(tables(), 0, 5, schema)).toEqual({ className: 'area', properties: {} });
    expect(tableRow(tables(), 0, 1, undefined)).toEqual({ className: 'area', properties: {} });
    expect(tableRow(tables(), 7, 0, schema)).toBeUndefined();
  });
});
