import { describe, expect, it } from 'vitest';
import { gitObject, lfsObjectId } from '../../src/extension/gitObject';

describe('gitObject', () => {
  it('reads staged versions from the index', () => {
    expect(gitObject('', 'models/robot.glb')).toBe(':models/robot.glb');
    expect(gitObject('~', 'models/robot.glb')).toBe(':models/robot.glb');
  });

  it('reads the sides of a merge conflict from their stage', () => {
    expect(gitObject('~2', 'robot.glb')).toBe(':2:robot.glb');
  });

  it('reads commits and branches as named', () => {
    expect(gitObject('HEAD', 'robot.glb')).toBe('HEAD:robot.glb');
    expect(gitObject('3f2a1c9', 'a b/robot.glb')).toBe('3f2a1c9:a b/robot.glb');
  });

  it('refuses a ref git would read as an option', () => {
    expect(gitObject('--output=x', 'robot.glb')).toBeUndefined();
  });
});

describe('lfsObjectId', () => {
  const oid = 'a'.repeat(64);
  const pointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize 12345\n`;

  it('finds the object a Git LFS pointer stands for', () => {
    expect(lfsObjectId(new TextEncoder().encode(pointer))).toBe(oid);
  });

  it('ignores anything else', () => {
    expect(
      lfsObjectId(new TextEncoder().encode('glTF\u0002\u0000\u0000\u0000 a model')),
    ).toBeUndefined();
    expect(lfsObjectId(new Uint8Array(4096))).toBeUndefined();
  });
});
