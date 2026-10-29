import { posix } from 'node:path';

/**
 * Where a URI in a model (a buffer, an image) points. Only `data:` URIs and paths relative to
 * the model are followed, and only inside the folder the viewer may read (D-005).
 */
export type Resolution =
  | { kind: 'data'; bytes: Uint8Array; mimeType?: string }
  | { kind: 'path'; path: string }
  | { kind: 'refused'; reason: 'network' | 'absolute' | 'outside' | 'invalid' };

const NETWORK_SCHEMES = new Set(['http', 'https', 'ftp', 'ws', 'wss']);

/**
 * @param modelFolder posix path of the folder the model is in, e.g. `/d:/models`
 * @param root posix path of the folder resources must stay inside
 */
export function resolveResourceUri(uri: string, modelFolder: string, root: string): Resolution {
  const trimmed = uri.trim();
  if (/^data:/i.test(trimmed)) return decodeDataUri(trimmed);

  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)?.[1].toLowerCase();
  if (scheme) {
    return { kind: 'refused', reason: NETWORK_SCHEMES.has(scheme) ? 'network' : 'absolute' };
  }
  // Glossed over by some exporters on Windows; the glTF specification only allows `/`.
  const relative = trimmed.replace(/\\/g, '/').replace(/[?#].*$/, '');
  if (relative.startsWith('/')) return { kind: 'refused', reason: 'absolute' };
  if (relative === '') return { kind: 'refused', reason: 'invalid' };

  let segments: string[];
  try {
    segments = relative.split('/').map((segment) => decodeURIComponent(segment));
  } catch {
    return { kind: 'refused', reason: 'invalid' };
  }
  if (segments.some((segment) => segment.includes('/') || segment.includes('\0'))) {
    return { kind: 'refused', reason: 'invalid' };
  }
  const path = posix.normalize(posix.join(modelFolder, ...segments));
  return isInside(path, root) ? { kind: 'path', path } : { kind: 'refused', reason: 'outside' };
}

/**
 * A URI in a file that another one links to by `link`, made relative to the linking file's
 * folder, as its own paths are: paths in the linked file are relative to its folder. Anything
 * else (`data:`, a scheme, an absolute path) stays as it is, to be decoded or refused the same.
 */
export function rebaseUri(uri: string, link: string): string {
  const trimmed = uri.trim();
  const relative = !/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^[/\\]/.test(trimmed);
  if (!relative || trimmed === '') return uri;
  const clean = link
    .trim()
    .replace(/\\/g, '/')
    .replace(/[?#].*$/, '');
  return clean.slice(0, clean.lastIndexOf('/') + 1) + trimmed;
}

/** Opens the URIs in the file `link` names, by the linking file's opener. */
export function linkedOpener<T>(open: (uri: string) => T, link: string): (uri: string) => T {
  return (uri) => open(rebaseUri(uri, link));
}

function isInside(path: string, root: string): boolean {
  return relativeInside(path, root) !== undefined;
}

/**
 * `path` relative to `root`, both posix paths as in VS Code URIs; undefined if it isn't inside.
 * Windows paths look like /c:/folder, and their file system ignores case: VS Code can give a
 * workspace folder as /D:/ and a file in it as /d:/.
 */
export function relativeInside(path: string, root: string): string | undefined {
  const windows = /^\/[a-z]:/i.test(root);
  const [p, r] = windows ? [path.toLowerCase(), root.toLowerCase()] : [path, root];
  const prefix = r.endsWith('/') ? r : `${r}/`;
  return p.startsWith(prefix) ? path.slice(prefix.length) : undefined;
}

function decodeDataUri(uri: string): Resolution {
  const comma = uri.indexOf(',');
  if (comma < 0) return { kind: 'refused', reason: 'invalid' };
  const header = uri.slice(5, comma).split(';');
  const data = uri.slice(comma + 1);
  const base64 = header.slice(1).some((part) => part.toLowerCase() === 'base64');
  try {
    const bytes = base64
      ? new Uint8Array(Buffer.from(data, 'base64'))
      : new TextEncoder().encode(decodeURIComponent(data));
    return { kind: 'data', bytes, mimeType: header[0] || undefined };
  } catch {
    return { kind: 'refused', reason: 'invalid' };
  }
}

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  ktx2: 'image/ktx2',
};

export function imageMimeType(uri: string): string | undefined {
  const extension = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(uri)?.[1].toLowerCase();
  return extension ? IMAGE_TYPES[extension] : undefined;
}

/** A short name for a resource in messages: its file name, not a whole data URI. */
export function resourceName(uri: string): string {
  if (/^data:/i.test(uri)) return 'data: URI';
  const clean = uri.replace(/[?#].*$/, '').replace(/\\/g, '/');
  const name = clean.slice(clean.lastIndexOf('/') + 1) || clean;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}
