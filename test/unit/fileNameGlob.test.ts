import { describe, expect, it } from 'vitest';
import { fileNameGlob } from '../../src/extension/fileNameGlob';

describe('fileNameGlob', () => {
  it('keeps ordinary names unchanged', () => {
    expect(fileNameGlob('Quarterly Report (final).docx')).toBe('Quarterly Report (final).docx');
  });

  it('neutralizes glob metacharacters', () => {
    expect(fileNameGlob('a[1]{x}*?!.docx')).toBe('a?1??x????.docx');
  });
});
