// A JSON file a model or tileset refers to: a metadata schema given as a file of its own
// (D-057, D-058). The webview resolves no URIs, so the host reads it and sends it along.
import { withoutByteOrderMark } from './container';
import { resourceName } from './resources';
import type { ResourceProblem } from './load';
import type { ResourceData } from './plan';

/** The largest metadata schema read from a file of its own: schemas are a few kilobytes. */
const SCHEMA_BYTES = 16 * 1024 * 1024;

export interface JsonResources {
  data(uri: string): Promise<ResourceData | undefined>;
  problem(uri: string, problem: ResourceProblem, name: string): void;
}

/**
 * The JSON object at `uri`, or undefined when it can't be read or isn't an object: the user is
 * told why, with the other resources' problems.
 */
export async function readJsonObject(
  uri: string,
  resources: JsonResources,
): Promise<object | undefined> {
  const data = await resources.data(uri);
  if (!data) return undefined;
  try {
    if (data.available > SCHEMA_BYTES) throw new RangeError();
    const bytes = await data.source.read(data.offset, data.available);
    const parsed: unknown = JSON.parse(withoutByteOrderMark(new TextDecoder().decode(bytes)));
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed;
  } catch {
    // Said below.
  }
  resources.problem(uri, 'unreadable', resourceName(uri));
  return undefined;
}
