import { describe, expect, it } from 'vitest';
import { formatForPath } from '../../src/shared/formats';

describe('formatForPath', () => {
  it('recognizes glTF files by extension, in any case', () => {
    expect(formatForPath('/models/robot.glb')).toBe('glb');
    expect(formatForPath('/models/Robot.GLTF')).toBe('gltf');
  });

  it('recognizes b3dm tiles', () => {
    expect(formatForPath('/tiles/0/1.B3DM')).toBe('b3dm');
    expect(formatForPath('/tiles/0/1.pnts')).toBe('pnts');
  });

  it('ignores other files and dots in folder names', () => {
    expect(formatForPath('/models/robot.bin')).toBeUndefined();
    expect(formatForPath('/models.glb/readme')).toBeUndefined();
    expect(formatForPath('C:\\models.gltf\\readme')).toBeUndefined();
  });
});
