import { describe, expect, it } from 'vitest';
import { TripleIndex, bitsOf } from '../../src/extension/model/mesh/arrays';
import { Cursor, LineSplitter } from '../../src/extension/model/mesh/text';

const bytes = (text: string) => new TextEncoder().encode(text);
const cursor = (text: string) => new Cursor().reset(bytes(text), 0, bytes(text).length);

describe('Cursor', () => {
  it('reads numbers as parseFloat does', () => {
    const words = [
      '0',
      '1',
      '-1.5',
      '+2.25',
      '.5',
      '-.5',
      '1.',
      '1e3',
      '1.5E-2',
      '-2.5e+2',
      '0.000001',
    ];
    const read = cursor(words.join('  \t'));
    for (const word of words) expect(read.number()).toBe(Number.parseFloat(word));
    expect(read.atEnd()).toBe(true);
  });

  it('keeps the precision of long coordinates', () => {
    for (const word of [
      '500000.123456789',
      '4100000.987654321',
      '-0.1234567890123',
      '3.14159265358979',
    ]) {
      expect(cursor(word).number()).toBeCloseTo(Number.parseFloat(word), 9);
    }
  });

  it('reads NaN and infinities as some exporters write them, and passes over other words', () => {
    const read = cursor('nan -inf Infinity 1.#QNAN x 7');
    expect(read.number()).toBeNaN();
    expect(read.number()).toBe(-Infinity);
    expect(read.number()).toBe(Infinity);
    expect(read.number()).toBeNaN();
    expect(read.number()).toBeNaN();
    expect(read.number()).toBe(7);
    expect(read.number()).toBeNaN();
  });

  it("reads OBJ's corners: integers between slashes", () => {
    const read = cursor('1/2/3 -4//5 6/7');
    const steps = [
      read.integer(),
      read.slash(),
      read.integer(),
      read.slash(),
      read.integer(),
      read.integer(),
      read.slash(),
      read.slash(),
      read.integer(),
      read.integer(),
      read.slash(),
      read.integer(),
    ];
    expect(steps).toEqual([1, true, 2, true, 3, -4, true, true, 5, 6, true, 7]);
    expect(read.atEnd()).toBe(true);
  });

  it('finds keywords, words and the rest of a line', () => {
    const read = cursor('  usemtl  Wood Dark \r');
    expect(read.keyword('use')).toBe(false);
    expect(read.keyword('usemtl')).toBe(true);
    expect(read.rest()).toBe('Wood Dark');
    expect(cursor('vertex 1 2 3').word()).toBe('vertex');
  });
});

describe('LineSplitter', () => {
  it('hands out the same lines however the text is split', () => {
    const text = 'v 1 2 3\r\nvt 0.5 0.5\n\nf 1/1 2/2 3/3\nlast';
    const expected = ['v 1 2 3', 'vt 0.5 0.5', '', 'f 1/1 2/2 3/3', 'last'];
    for (const size of [1, 2, 3, 7, 1000]) {
      const lines: string[] = [];
      const splitter = new LineSplitter((buffer, start, end) =>
        lines.push(new TextDecoder().decode(buffer.subarray(start, end))),
      );
      const all = bytes(text);
      for (let at = 0; at < all.length; at += size) splitter.push(all.slice(at, at + size));
      splitter.finish();
      expect(lines, `pieces of ${size}`).toEqual(expected);
    }
  });
});

describe('TripleIndex', () => {
  it('numbers distinct triples in the order they come, through growth', () => {
    const index = new TripleIndex(2);
    const seen: number[] = [];
    for (let i = 0; i < 5000; i++) seen.push(index.index(i % 1000, (i % 1000) * 7, -1));
    expect(index.size).toBe(1000);
    expect(seen.slice(0, 1000)).toEqual(Array.from({ length: 1000 }, (_, i) => i));
    expect(seen.slice(1000, 2000)).toEqual(seen.slice(0, 1000));
    index.index(5, 35, -1);
    expect(index.added).toBe(false);
    index.index(5, 35, 0);
    expect(index.added).toBe(true);
  });

  it('tells floats apart by their bits, with -0 as 0', () => {
    expect(bitsOf(-0)).toBe(bitsOf(0));
    expect(bitsOf(0.1)).not.toBe(bitsOf(0.1000001));
  });
});
