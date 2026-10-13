import type { ModelFormat } from './protocol';

const FORMATS: Readonly<Record<string, ModelFormat>> = {
  '.glb': 'glb',
  '.gltf': 'gltf',
};

/** File extensions the viewer opens, with the leading dot. */
export const SUPPORTED_EXTENSIONS: readonly string[] = Object.keys(FORMATS);

export function formatForPath(path: string): ModelFormat | undefined {
  const dot = path.lastIndexOf('.');
  if (dot < 0 || dot < path.lastIndexOf('/') || dot < path.lastIndexOf('\\')) {
    return undefined;
  }
  return FORMATS[path.slice(dot).toLowerCase()];
}
