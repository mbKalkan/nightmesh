import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readGlbLayout, sniff, withoutByteOrderMark } from '../../src/extension/model/container';
import { memorySource } from '../../src/extension/model/sources';

const fixture = (name: string) => new Uint8Array(readFileSync(`test/fixtures/${name}`));
const text = (value: string) => new TextEncoder().encode(value);

describe('sniff', () => {
  it('tells files apart by their first bytes, not their extension', () => {
    expect(sniff(new Uint8Array())).toBe('empty');
    expect(sniff(fixture('scene.glb'))).toBe('glb');
    expect(sniff(fixture('triangle.gltf'))).toBe('json');
    expect(sniff(fixture('lfs-pointer.glb'))).toBe('lfsPointer');
    expect(sniff(fixture('not-a-model.glb'))).toBe('unknown');
  });

  it('accepts JSON after a byte order mark or whitespace', () => {
    expect(sniff(text(`${String.fromCharCode(0xfeff)}{"asset":{}}`))).toBe('json');
    expect(sniff(text('\n  {"asset":{}}'))).toBe('json');
  });

  it('removes a byte order mark only at the start', () => {
    const mark = String.fromCharCode(0xfeff);
    expect(withoutByteOrderMark(`${mark}{}`)).toBe('{}');
    expect(withoutByteOrderMark(`{${mark}}`)).toBe(`{${mark}}`);
  });
});

describe('readGlbLayout', () => {
  it('finds the JSON and binary chunks of a whole file', async () => {
    const bytes = fixture('scene.glb');
    const layout = await readGlbLayout(memorySource(bytes));
    expect(layout).toMatchObject({ version: 2, json: { offset: 20 }, truncated: false });
    if ('failure' in layout) throw new Error('expected a layout');
    expect(layout.bin?.available).toBe(layout.bin?.length);
    expect(layout.bin!.offset + layout.bin!.length).toBe(bytes.length);
  });

  it('notices a file cut off inside its binary chunk', async () => {
    const layout = await readGlbLayout(memorySource(fixture('truncated.glb')));
    if ('failure' in layout) throw new Error('expected a layout');
    expect(layout.truncated).toBe(true);
    expect(layout.bin!.available).toBeLessThan(layout.bin!.length);
  });

  it('reports other glTF versions', async () => {
    const bytes = fixture('triangle.glb').slice();
    new DataView(bytes.buffer).setUint32(4, 1, true);
    expect(await readGlbLayout(memorySource(bytes))).toEqual({ failure: 'version', version: 1 });
  });

  it('calls a file damaged when its chunks make no sense', async () => {
    const wrongChunk = fixture('triangle.glb').slice();
    new DataView(wrongChunk.buffer).setUint32(16, 0x12345678, true);
    const jsonTooLong = fixture('triangle.glb').slice();
    new DataView(jsonTooLong.buffer).setUint32(12, 1_000_000, true);
    for (const bytes of [wrongChunk, jsonTooLong, fixture('triangle.glb').slice(0, 16)]) {
      expect(await readGlbLayout(memorySource(bytes))).toEqual({ failure: 'damaged' });
    }
  });
});
