// A Batched 3D Model (b3dm) tile from 3D Tiles: a header, a feature table and a batch table, and
// after them a GLB, which is shown as any other GLB is.
import type { TileFacts } from '../../shared/protocol';
import { withoutByteOrderMark } from './container';
import type { Gltf } from './plan';
import { sliceSource, type ByteSource } from './sources';

export type B3dm =
  | { facts: TileFacts; glb: ByteSource }
  | { failure: 'notTile' | 'damaged' }
  | { failure: 'version'; version: number };

const HEADER = 28;
/**
 * Files from before 3D Tiles 1.0 have shorter headers. Where 1.0 has a table's length, theirs
 * have the start of a table's JSON or of the GLB, which read as a number this large or larger;
 * CesiumJS tells them apart the same way.
 */
const LEGACY = 570425344;
/** Tables' JSON past this isn't read, only counted: it names properties, a list of a few words. */
const MAX_TABLE_JSON = 64 * 1024 * 1024;

export function isB3dm(head: Uint8Array): boolean {
  return new TextDecoder().decode(head.subarray(0, 4)) === 'b3dm';
}

/** Reads a b3dm tile's header and tables, and finds the GLB after them. */
export async function readB3dm(source: ByteSource): Promise<B3dm> {
  const head = await source.read(0, Math.min(HEADER, source.size));
  if (!isB3dm(head)) return { failure: 'notTile' };
  if (head.length < HEADER) return { failure: 'damaged' };
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const version = view.getUint32(4, true);
  // A number this large isn't a version: the bytes after the magic are something else.
  if (version !== 1)
    return version < 256 ? { failure: 'version', version } : { failure: 'damaged' };

  let header = HEADER;
  let [featureJson, featureBinary, batchJson, batchBinary] = [12, 16, 20, 24].map((offset) =>
    view.getUint32(offset, true),
  );
  let batchLength: number | undefined;
  if (batchJson >= LEGACY) {
    // Magic, version, byte length, batch length, batch table length.
    header = 20;
    [batchLength, batchJson] = [featureJson, featureBinary];
    [featureJson, featureBinary, batchBinary] = [0, 0, 0];
  } else if (batchBinary >= LEGACY) {
    // Magic, version, byte length, batch table JSON length, its binary length, batch length.
    header = 24;
    [batchLength, batchJson, batchBinary] = [batchJson, featureJson, featureBinary];
    [featureJson, featureBinary] = [0, 0];
  }
  const glb = header + featureJson + featureBinary + batchJson + batchBinary;
  if (glb >= source.size) return { failure: 'damaged' };

  const featureTable = await readJson(source, header, featureJson);
  const batchTable = await readJson(source, header + featureJson + featureBinary, batchJson);
  const facts: TileFacts = {
    format: 'b3dm',
    version,
    header,
    featureTable: { json: featureJson, binary: featureBinary },
    batchTable: { json: batchJson, binary: batchBinary },
    batchLength: batchLength ?? count(featureTable.BATCH_LENGTH),
    ...batchFacts(batchTable),
  };
  const center = await rtcCenter(
    source,
    featureTable.RTC_CENTER,
    header + featureJson,
    featureBinary,
  );
  if (center) facts.rtcCenter = center;
  return { facts, glb: sliceSource(source, glb, source.size - glb) };
}

/** A table's JSON; empty when there is none, it is too large, or it isn't an object. */
async function readJson(
  source: ByteSource,
  offset: number,
  length: number,
): Promise<Record<string, unknown>> {
  if (length === 0 || length > MAX_TABLE_JSON || offset + length > source.size) return {};
  return parseTable(await source.read(offset, length));
}

/** A table's JSON from its bytes; empty when it isn't an object. */
export function parseTable(bytes: Uint8Array): Record<string, unknown> {
  try {
    const text = new TextDecoder().decode(bytes);
    // Tables are padded with spaces, and some writers pad with zeros.
    const value: unknown = JSON.parse(withoutByteOrderMark(text).replace(/\0+$/, ''));
    return isObject(value) ? value : {};
  } catch {
    return {};
  }
}

/** A batch table's properties, with what each holds, and its extensions. */
export function batchFacts(
  batchTable: Record<string, unknown>,
): Pick<TileFacts, 'properties' | 'extensions'> {
  return {
    properties: Object.entries(batchTable)
      .filter(([name]) => name !== 'extensions' && name !== 'extras')
      .map(([name, value]) => ({ name, type: propertyType(value) })),
    extensions: isObject(batchTable.extensions) ? Object.keys(batchTable.extensions) : [],
  };
}

/** What a batch table property holds: values in its JSON, or numbers in the binary body. */
function propertyType(value: unknown): string {
  if (isObject(value) && typeof value.componentType === 'string' && typeof value.type === 'string')
    return `${value.componentType} ${value.type}`;
  return 'JSON';
}

/** `RTC_CENTER`, given in the JSON or as three floats in the feature table's binary body. */
async function rtcCenter(
  source: ByteSource,
  value: unknown,
  binary: number,
  binaryLength: number,
): Promise<[number, number, number] | undefined> {
  let center: unknown[] | undefined;
  if (Array.isArray(value)) center = value;
  else if (isObject(value) && typeof value.byteOffset === 'number') {
    const offset = value.byteOffset;
    if (!(offset >= 0 && offset + 12 <= binaryLength)) return undefined;
    const bytes = await source.read(binary + offset, 12);
    const floats = new DataView(bytes.buffer, bytes.byteOffset, 12);
    center = [0, 4, 8].map((at) => floats.getFloat32(at, true));
  }
  if (center?.length !== 3 || !center.every((n) => typeof n === 'number' && Number.isFinite(n)))
    return undefined;
  return center as [number, number, number];
}

export const count = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The glTF of a b3dm tile to draw, with its features' batch ids named as 3D Tiles 1.0 names them,
 * `_BATCHID`: tiles from before it name them `BATCHID`, which CesiumJS still reads.
 */
export function withBatchIds(json: Gltf): Gltf {
  const renamed = structuredClone(json);
  let found = false;
  for (const mesh of renamed.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const draco = primitive.extensions?.KHR_draco_mesh_compression as
        { attributes?: Record<string, number> } | undefined;
      for (const attributes of [primitive.attributes, draco?.attributes]) {
        if (attributes?.BATCHID === undefined || attributes._BATCHID !== undefined) continue;
        attributes._BATCHID = attributes.BATCHID;
        delete attributes.BATCHID;
        found = true;
      }
    }
  }
  return found ? renamed : json;
}
