import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { embindWithoutEval } from '../../scripts/embindWithoutEval.mjs';

const transcoder = readFileSync(
  createRequire(import.meta.url).resolve('three/examples/jsm/libs/basis/basis_transcoder.js'),
  'utf8',
);

describe('embindWithoutEval', () => {
  it('takes run-time code generation out of the Basis transcoder', () => {
    expect(transcoder).toMatch(/newFunc\(Function/);
    const patched = embindWithoutEval(transcoder);
    expect(patched).not.toMatch(/newFunc\(Function|new Function|\beval\(/);
    expect(patched).toMatch(/^\s*var BASIS = /);
  });

  it('refuses a transcoder it was not written for', () => {
    expect(() => embindWithoutEval('var BASIS = () => {};')).toThrow(/not found as expected/);
  });
});
