import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EnvironmentStore } from '../../src/extension/environmentStore';

const folders: string[] = [];
const folder = () => {
  const made = mkdtempSync(join(tmpdir(), 'nightmesh-environment-'));
  folders.push(made);
  return join(made, 'storage');
};
afterEach(() => folders.splice(0).forEach((f) => rmSync(f, { recursive: true, force: true })));

const environment = (key = 'room-0.04-three-186') => ({
  key,
  width: 4,
  height: 2,
  data: Uint8Array.from({ length: 4 * 2 * 8 }, (_, i) => i),
});

describe('EnvironmentStore', () => {
  it('has nothing before a viewer made an environment', async () => {
    expect(await new EnvironmentStore(folder()).get()).toBeUndefined();
  });

  it('keeps what a viewer made for the next session', async () => {
    const storage = folder();
    await new EnvironmentStore(storage).keep(environment());
    const kept = await new EnvironmentStore(storage).get();
    expect(kept).toEqual(environment());
    expect(kept?.data.byteOffset).toBe(0);
    expect(kept?.data.byteLength).toBe(kept?.data.buffer.byteLength);
  });

  it('gives what it kept in this session without reading it again', async () => {
    const store = new EnvironmentStore(folder());
    await store.get();
    await store.keep(environment('newer'));
    expect((await store.get())?.key).toBe('newer');
  });

  it('turns down what doesn’t look like an environment', async () => {
    const storage = folder();
    const store = new EnvironmentStore(storage);
    await store.keep({ ...environment(), width: 5 });
    await store.keep({ ...environment(), key: 'x'.repeat(101) });
    expect(await store.get()).toBeUndefined();
    expect(await new EnvironmentStore(storage).get()).toBeUndefined();
  });

  it('reads a damaged file as none', async () => {
    const storage = folder();
    await new EnvironmentStore(storage).keep(environment());
    writeFileSync(join(storage, 'environment.bin'), Buffer.from([1, 2, 3]));
    expect(await new EnvironmentStore(storage).get()).toBeUndefined();
    writeFileSync(join(storage, 'environment.json'), '{');
    expect(await new EnvironmentStore(storage).get()).toBeUndefined();
  });
});
