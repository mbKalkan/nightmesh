import { describe, expect, it } from 'vitest';
import {
  imageMimeType,
  resolveResourceUri,
  resourceName,
} from '../../src/extension/model/resources';

const MODEL = '/work/models/car';
const ROOT = '/work';
const resolve = (uri: string, root = ROOT, folder = MODEL) => resolveResourceUri(uri, folder, root);

describe('resolveResourceUri', () => {
  it('follows paths relative to the model', () => {
    expect(resolve('car.bin')).toEqual({ kind: 'path', path: '/work/models/car/car.bin' });
    expect(resolve('textures/paint.png')).toEqual({
      kind: 'path',
      path: '/work/models/car/textures/paint.png',
    });
  });

  it('decodes percent-encoded names', () => {
    expect(resolve('my%20car.bin')).toEqual({ kind: 'path', path: '/work/models/car/my car.bin' });
  });

  it('allows going up while staying inside the root', () => {
    expect(resolve('../shared/wheel.bin')).toEqual({
      kind: 'path',
      path: '/work/models/shared/wheel.bin',
    });
  });

  it('refuses paths that leave the root, even disguised', () => {
    expect(resolve('../../../etc/passwd')).toEqual({ kind: 'refused', reason: 'outside' });
    expect(resolve('%2E%2E/%2E%2E/%2E%2E/secret.bin')).toEqual({
      kind: 'refused',
      reason: 'outside',
    });
    expect(resolve('..\\..\\..\\secret.bin')).toEqual({ kind: 'refused', reason: 'outside' });
    expect(resolve('../../../workshop/x.bin')).toEqual({ kind: 'refused', reason: 'outside' });
  });

  it('refuses absolute paths and other schemes', () => {
    expect(resolve('/etc/passwd')).toEqual({ kind: 'refused', reason: 'absolute' });
    expect(resolve('\\\\server\\share\\x.bin')).toEqual({ kind: 'refused', reason: 'absolute' });
    expect(resolve('C:/Windows/win.ini')).toEqual({ kind: 'refused', reason: 'absolute' });
    expect(resolve('file:///etc/passwd')).toEqual({ kind: 'refused', reason: 'absolute' });
  });

  it('refuses the network', () => {
    expect(resolve('https://example.com/car.bin')).toEqual({ kind: 'refused', reason: 'network' });
    expect(resolve('HTTP://example.com/car.bin')).toEqual({ kind: 'refused', reason: 'network' });
  });

  it('refuses references that are not paths at all', () => {
    expect(resolve('')).toEqual({ kind: 'refused', reason: 'invalid' });
    expect(resolve('%E0%A4%A.bin')).toEqual({ kind: 'refused', reason: 'invalid' });
    expect(resolve('a%2Fb.bin')).toEqual({ kind: 'refused', reason: 'invalid' });
  });

  it('compares Windows paths without regard to case', () => {
    expect(resolve('x.bin', '/c:/Work', '/C:/work/models')).toEqual({
      kind: 'path',
      path: '/C:/work/models/x.bin',
    });
  });

  it('decodes data: URIs, base64 or not', () => {
    const base64 = resolve('data:application/octet-stream;base64,AAEC/w==');
    expect(base64).toMatchObject({ kind: 'data', mimeType: 'application/octet-stream' });
    expect([...(base64 as { bytes: Uint8Array }).bytes]).toEqual([0, 1, 2, 255]);
    const plain = resolve('data:text/plain,hi%21');
    expect(new TextDecoder().decode((plain as { bytes: Uint8Array }).bytes)).toBe('hi!');
  });
});

describe('imageMimeType', () => {
  it('knows the image types glTF uses', () => {
    expect(imageMimeType('paint.PNG')).toBe('image/png');
    expect(imageMimeType('paint.jpeg')).toBe('image/jpeg');
    expect(imageMimeType('paint.ktx2')).toBe('image/ktx2');
    expect(imageMimeType('paint.tga')).toBeUndefined();
  });
});

describe('resourceName', () => {
  it('names a resource by its file name', () => {
    expect(resourceName('textures/my%20paint.png')).toBe('my paint.png');
    expect(resourceName('..\\car.bin')).toBe('car.bin');
    expect(resourceName('data:image/png;base64,AAAA')).toBe('data: URI');
  });
});
