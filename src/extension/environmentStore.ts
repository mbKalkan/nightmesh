import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Environment } from '../shared/protocol';

/** Larger than any environment the view makes; a file that says otherwise isn't one. */
const MAX_SIDE = 4096;

/**
 * Keeps the lighting environment the first viewer made (D-047) in a folder of the extension's
 * own, its global storage, so later viewers, in any window and session, start without making it
 * again. Free of VS Code APIs: the folder is on the extension host's disk, also in a remote.
 */
export class EnvironmentStore {
  private kept: Promise<Environment | undefined> | undefined;

  constructor(private readonly folder: string) {}

  /** The environment kept, read from disk the first time; undefined if there is none yet. */
  get(): Promise<Environment | undefined> {
    this.kept ??= this.read();
    return this.kept;
  }

  /** Keeps what a viewer made, if it looks like an environment. */
  async keep(environment: Environment): Promise<void> {
    if (!isEnvironment(environment)) return;
    this.kept = Promise.resolve(environment);
    try {
      await mkdir(this.folder, { recursive: true });
      const { key, width, height, data } = environment;
      await writeFile(this.path('bin'), data);
      await writeFile(this.path('json'), JSON.stringify({ key, width, height }));
    } catch {
      // Viewers in this session still have it; the next session makes it again.
    }
  }

  private async read(): Promise<Environment | undefined> {
    try {
      const header = JSON.parse(await readFile(this.path('json'), 'utf8')) as Omit<
        Environment,
        'data'
      >;
      // A copy of its own, as the webview takes it: a Node Buffer can be a view of a shared pool.
      const environment = { ...header, data: new Uint8Array(await readFile(this.path('bin'))) };
      return isEnvironment(environment) ? environment : undefined;
    } catch {
      return undefined;
    }
  }

  private path(extension: 'bin' | 'json'): string {
    return join(this.folder, `environment.${extension}`);
  }
}

function isEnvironment(value: Environment): boolean {
  const { key, width, height, data } = value ?? {};
  const side = (n: unknown) =>
    Number.isInteger(n) && (n as number) > 0 && (n as number) <= MAX_SIDE;
  return (
    typeof key === 'string' &&
    key.length <= 100 &&
    side(width) &&
    side(height) &&
    data instanceof Uint8Array &&
    data.byteLength === width * height * 8
  );
}
