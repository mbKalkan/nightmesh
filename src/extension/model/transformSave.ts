import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, copyFile, open, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { applyEdits, modify, type FormattingOptions, type JSONPath } from 'jsonc-parser';
import { isDefault, modelRoots, TRANSFORM_PATHS, type Trs } from '../../shared/transforms';

/** "glTF", and the JSON chunk's type, as GLB writes them (little-endian). */
const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
/** The GLB header, then the JSON chunk's length and type. */
const GLB_START = 20;
const BOM = String.fromCharCode(0xfeff);

/**
 * The glTF JSON with the nodes in `transforms` moved, turned and scaled as given (D-069). Only
 * those nodes' `translation`, `rotation` and `scale` change, and a `matrix` they had goes; the
 * rest of the text stays as it was, layout and numbers alike. A transform for node
 * `nodes.length` adds that node above the shown scene's top nodes, unless it leaves them in place.
 */
export function transformedJson(text: string, transforms: ReadonlyMap<number, Trs>): string {
  if (transforms.size === 0) return text;
  const json = JSON.parse(text) as { nodes?: unknown };
  const nodes = Array.isArray(json.nodes) ? (json.nodes as unknown[]) : [];
  const formattingOptions = formattingOf(text);
  const edit = (path: JSONPath, value: unknown) => {
    text = applyEdits(text, modify(text, path, value, { formattingOptions }));
  };
  for (const [index, trs] of [...transforms].sort(([a], [b]) => a - b)) {
    const node = nodes[index];
    if (typeof node === 'object' && node !== null && !Array.isArray(node)) {
      if ('matrix' in node) edit(['nodes', index, 'matrix'], undefined);
      for (const path of TRANSFORM_PATHS) {
        edit(['nodes', index, path], isDefault(path, trs[path]) ? undefined : trs[path]);
      }
    } else if (index === nodes.length) {
      const place = modelRoots(json);
      const paths = TRANSFORM_PATHS.filter((path) => !isDefault(path, trs[path]));
      if (!place || paths.length === 0) continue;
      const added = Object.fromEntries([
        ['children', place.roots],
        ...paths.map((path) => [path, trs[path]]),
      ]);
      edit(['nodes', -1], added);
      edit(['scenes', place.scene, 'nodes'], [index]);
    }
  }
  return text;
}

/** Edits in a file laid out over lines keep its indentation; a GLB's JSON is on one line. */
function formattingOf(text: string): FormattingOptions | undefined {
  const indent = /\n([ \t]+)\S/.exec(text)?.[1];
  if (!indent) return undefined;
  const spaces = indent.startsWith(' ');
  return {
    insertSpaces: spaces,
    tabSize: spaces ? indent.length : 1,
    eol: text.includes('\r\n') ? '\r\n' : '\n',
  };
}

/** A GLB or glTF file in memory, with the nodes in `transforms` changed. */
export function transformedBytes(
  data: Uint8Array,
  transforms: ReadonlyMap<number, Trs>,
): Uint8Array {
  if (!isGlb(data)) return transformedText(data, transforms);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const { jsonLength, restLength } = glbLayout(view, data.byteLength);
  const json = glbJson(
    transformedJson(decodeJson(data.subarray(GLB_START, GLB_START + jsonLength)), transforms),
  );
  const rest = data.subarray(GLB_START + jsonLength, GLB_START + jsonLength + restLength);
  const out = new Uint8Array(GLB_START + json.byteLength + rest.byteLength);
  out.set(glbStart(out.byteLength, json.byteLength));
  out.set(json, GLB_START);
  out.set(rest, GLB_START + json.byteLength);
  return out;
}

/**
 * Writes the model at `source` to `target`, which may be the same file, with the nodes in
 * `transforms` changed. A GLB's binary chunk is copied as it is, never read whole. The new file is
 * written next to the target and put in its place once complete, so a failed save leaves the
 * file as it was.
 */
export async function saveTransformed(
  source: string,
  target: string,
  transforms: ReadonlyMap<number, Trs>,
): Promise<void> {
  const temp = join(dirname(target), `.${basename(target)}.${randomBytes(4).toString('hex')}.tmp`);
  try {
    const file = await open(source, 'r');
    try {
      const start = new Uint8Array(GLB_START);
      const { bytesRead } = await file.read(start, 0, GLB_START, 0);
      if (!isGlb(start.subarray(0, bytesRead))) {
        await writeFile(temp, transformedText(await file.readFile(), transforms));
      } else {
        const size = (await file.stat()).size;
        const layout = glbLayout(new DataView(start.buffer), size);
        const oldJson = new Uint8Array(layout.jsonLength);
        await file.read(oldJson, 0, layout.jsonLength, GLB_START);
        const json = glbJson(transformedJson(decodeJson(oldJson), transforms));
        const total = GLB_START + json.byteLength + layout.restLength;
        await writeFile(temp, concat(glbStart(total, json.byteLength), json));
        if (layout.restLength > 0) {
          const restStart = GLB_START + layout.jsonLength;
          await pipeline(
            createReadStream(source, { start: restStart, end: restStart + layout.restLength - 1 }),
            createWriteStream(temp, { flags: 'a' }),
          );
        }
      }
    } finally {
      await file.close();
    }
    // A file the user made executable or private stays so; Windows has only a read-only flag.
    if (process.platform !== 'win32') {
      await chmod(temp, (await stat(source)).mode).catch(() => {});
    }
    await replace(temp, target);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

/**
 * Puts the new file in the target's place. Another program holding the target open can keep
 * Windows from renaming over it, while still letting it be written.
 */
async function replace(temp: string, target: string): Promise<void> {
  try {
    await rename(temp, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY') throw error;
    await copyFile(temp, target);
    await unlink(temp);
  }
}

function isGlb(data: Uint8Array): boolean {
  return (
    data.byteLength >= 12 &&
    new DataView(data.buffer, data.byteOffset, 4).getUint32(0, true) === GLB_MAGIC
  );
}

/** The JSON chunk's length, and how much follows it up to the length the header gives. */
function glbLayout(view: DataView, fileSize: number): { jsonLength: number; restLength: number } {
  const length = view.getUint32(8, true);
  const jsonLength = view.getUint32(12, true);
  if (
    view.getUint32(4, true) !== 2 ||
    view.getUint32(16, true) !== JSON_CHUNK ||
    length > fileSize ||
    GLB_START + jsonLength > length
  ) {
    throw new Error("The GLB file's header isn't one Nightmesh can save.");
  }
  return { jsonLength, restLength: length - GLB_START - jsonLength };
}

/** A GLB header for a file of `length` bytes, and its JSON chunk's header. */
function glbStart(length: number, jsonLength: number): Uint8Array {
  const start = new Uint8Array(GLB_START);
  const view = new DataView(start.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, length, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, JSON_CHUNK, true);
  return start;
}

/** A GLB's JSON chunk as text, without the spaces (or, in some files, zeros) padding it. */
function decodeJson(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes).replace(/[\s\0]+$/, '');
}

/** JSON for a GLB's chunk: padded with spaces to a multiple of four bytes. */
function glbJson(text: string): Uint8Array {
  const bytes = new TextEncoder().encode(text);
  const padded = new Uint8Array(Math.ceil(bytes.byteLength / 4) * 4).fill(0x20);
  padded.set(bytes);
  return padded;
}

/** A .gltf file with the nodes changed; a byte order mark it starts with stays. */
function transformedText(data: Uint8Array, transforms: ReadonlyMap<number, Trs>): Uint8Array {
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(data);
  const bom = text.startsWith(BOM) ? BOM : '';
  return new TextEncoder().encode(bom + transformedJson(text.slice(bom.length), transforms));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}
