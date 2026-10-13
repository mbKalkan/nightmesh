import type { ResourceOpener } from './load';
import { resolveResourceUri } from './resources';
import { fileSource, memorySource } from './sources';

/**
 * Opens resources of a model on the local file system, within `root` (D-005).
 * @param modelFolder posix path of the model's folder, as in a VS Code URI's `path`
 * @param toFsPath turns such a posix path into one the file system takes
 */
export function fileResourceOpener(
  modelFolder: string,
  root: string,
  toFsPath: (path: string) => string,
): ResourceOpener {
  return async (uri) => {
    const resolution = resolveResourceUri(uri, modelFolder, root);
    if (resolution.kind === 'refused') return resolution.reason;
    if (resolution.kind === 'data') return memorySource(resolution.bytes);
    try {
      return await fileSource(toFsPath(resolution.path));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unreadable';
    }
  };
}
