import { describe, expect, it } from 'vitest';
import { orderSides, type DiffCandidate } from '../../src/extension/diffSides';

describe('orderSides', () => {
  const file = (name: string, scheme = 'file') => ({ name, scheme });
  const describe_ = (x: DiffCandidate) => x;

  it('follows the order of the names in the tab label', () => {
    const a = file('old.glb');
    const b = file('new.glb');
    expect(orderSides(a, b, describe_, 'old.glb ↔ new.glb')).toEqual([a, b]);
    expect(orderSides(b, a, describe_, 'old.glb ↔ new.glb')).toEqual([a, b]);
  });

  it('puts the file on disk on the right when Git compares a file with itself', () => {
    const disk = file('model.glb');
    const git = file('model.glb', 'git');
    expect(orderSides(disk, git, describe_, 'model.glb ↔ model.glb')).toEqual([git, disk]);
    expect(orderSides(git, disk, describe_, 'model.glb ↔ model.glb')).toEqual([git, disk]);
  });

  it('puts what is staged after the last commit and before the file on disk', () => {
    const head = { ...file('model.glb', 'git'), gitRef: 'HEAD' };
    const staged = { ...file('model.glb', 'git'), gitRef: '' };
    const index = { ...file('model.glb', 'git'), gitRef: '~' };
    const disk = file('model.glb');
    const label = 'model.glb ↔ model.glb';
    expect(orderSides(staged, head, describe_, label)).toEqual([head, staged]);
    expect(orderSides(head, staged, describe_, label)).toEqual([head, staged]);
    expect(orderSides(disk, index, describe_, label)).toEqual([index, disk]);
  });

  it('keeps the order the viewers came in otherwise', () => {
    const a = { ...file('model.glb', 'git'), gitRef: '3f2a1c' };
    const b = { ...file('model.glb', 'git'), gitRef: '9e8d7b' };
    expect(orderSides(a, b, describe_, 'model.glb ↔ model.glb')).toEqual([a, b]);
    expect(orderSides(b, a, describe_, 'model.glb ↔ model.glb')).toEqual([b, a]);
  });
});
