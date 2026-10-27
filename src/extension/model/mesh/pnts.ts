// A Point Cloud (pnts) tile from 3D Tiles: a header, a feature table whose binary body holds each
// point's position, color and normal, plain or compressed with Draco, and a batch table. Read
// whole, as tiles are small.
import type { PntsFacts } from '../../../shared/protocol';
import { batchFacts, count, isObject, parseTable } from '../tileFile';
import {
  LINEAR_BYTES,
  MeshFormatError,
  Origin,
  linearChannel,
  type MeshPart,
  type MeshReader,
  type ParsedMesh,
} from './geometry';

const HEADER = 28;
/** More points than this aren't read: a damaged count would ask for more memory than there is. */
const MAX_POINTS = 1 << 28;

const COMPONENT_BYTES: Readonly<Record<string, number>> = {
  BYTE: 1,
  UNSIGNED_BYTE: 1,
  SHORT: 2,
  UNSIGNED_SHORT: 2,
  INT: 4,
  UNSIGNED_INT: 4,
  FLOAT: 4,
  DOUBLE: 8,
};

/** The properties of a tile's points that Draco held, by their feature table names. */
export interface DecodedPoints {
  POSITION?: Float32Array;
  NORMAL?: Float32Array;
  RGB?: Uint8Array;
  RGBA?: Uint8Array;
}

/**
 * Decodes Draco's point cloud `data` (draco.ts). Handed in, so that only the thread that reads
 * files carries the decoder.
 */
export type PointDecoder = (
  data: Uint8Array,
  properties: Readonly<Record<string, unknown>>,
  points: number,
) => Promise<DecodedPoints>;

export function isPnts(head: Uint8Array): boolean {
  return new TextDecoder().decode(head.subarray(0, 4)) === 'pnts';
}

export class PntsReader implements MeshReader {
  private readonly bytes: Uint8Array;
  private filled = 0;

  constructor(
    size: number,
    private readonly decode?: PointDecoder,
  ) {
    this.bytes = new Uint8Array(size);
  }

  push(chunk: Uint8Array): void {
    this.bytes.set(chunk.subarray(0, this.bytes.length - this.filled), this.filled);
    this.filled += chunk.length;
  }

  finish(): Promise<ParsedMesh> {
    return readPnts(this.bytes.subarray(0, this.filled), this.decode);
  }
}

/**
 * The points of a pnts tile, with what its header and tables say; Draco's with `decode`, which
 * left out says why they aren't drawn.
 */
export async function readPnts(bytes: Uint8Array, decode?: PointDecoder): Promise<ParsedMesh> {
  if (bytes.length < HEADER || !isPnts(bytes)) throw new MeshFormatError('Not a pnts tile');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(4, true);
  if (version !== 1) throw new MeshFormatError(`pnts version ${version}`);
  const [featureJson, featureBinary, batchJson, batchBinary] = [12, 16, 20, 24].map((offset) =>
    view.getUint32(offset, true),
  );
  if (HEADER + featureJson + featureBinary + batchJson + batchBinary > bytes.length) {
    throw new MeshFormatError('The tables run past the end of the file');
  }
  const featureTable = parseTable(bytes.subarray(HEADER, HEADER + featureJson));
  const batchStart = HEADER + featureJson + featureBinary;
  const batchTable = parseTable(bytes.subarray(batchStart, batchStart + batchJson));
  const body = new Body(bytes.subarray(HEADER + featureJson, batchStart));

  const points = count(featureTable.POINTS_LENGTH);
  if (points > MAX_POINTS) throw new MeshFormatError('Too many points');
  const featureExtensions = isObject(featureTable.extensions)
    ? Object.keys(featureTable.extensions)
    : [];
  const batch = batchFacts(batchTable);
  const facts: PntsFacts = {
    format: 'pnts',
    version,
    header: HEADER,
    featureTable: { json: featureJson, binary: featureBinary },
    batchTable: { json: batchJson, binary: batchBinary },
    batchLength: count(featureTable.BATCH_LENGTH),
    points,
    semantics: Object.keys(featureTable).filter((name) => name !== 'extensions'),
    properties: batch.properties,
    extensions: [...featureExtensions, ...batch.extensions],
  };
  const center = body.global(featureTable.RTC_CENTER, 'FLOAT', 3);
  if (center) facts.rtcCenter = center as [number, number, number];

  const mesh: ParsedMesh = { objects: [], materials: [], libraries: [], facts, problems: [] };
  let decoded: DecodedPoints = {};
  if (featureExtensions.includes('3DTILES_draco_point_compression')) {
    try {
      if (!decode) throw new Error('no decoder here');
      decoded = await decompress(featureTable, body, points, decode);
    } catch (error) {
      // The tile shows what it says, with nothing drawn.
      mesh.problems.push({
        kind: 'compressed',
        reason: error instanceof Error ? error.message : String(error),
      });
      return mesh;
    }
  }
  const origin = new Origin();
  const positions = readPositions(featureTable, body, points, origin, decoded.POSITION);
  if (!positions || points === 0) return mesh;
  const part: MeshPart = { mode: 'points', positions };
  const colors = readColors(featureTable, body, points, decoded);
  if (colors) Object.assign(part, colors);
  const normals = readNormals(featureTable, body, points, decoded.NORMAL);
  if (normals) part.normals = normals;
  mesh.objects.push({ parts: [part], children: [] });
  mesh.offset = origin.offset;
  return mesh;
}

/**
 * The properties the feature table's Draco extension holds, decoded: positions as numbers, colors
 * as bytes, normals unpacked. Draco may have put the points in another order, the same for each.
 */
function decompress(
  table: Record<string, unknown>,
  body: Body,
  points: number,
  decode: PointDecoder,
): Promise<DecodedPoints> {
  const draco = (table.extensions as Record<string, unknown>)['3DTILES_draco_point_compression'];
  if (!isObject(draco) || !isObject(draco.properties)) {
    throw new Error('the extension names no properties');
  }
  const { byteOffset: at, byteLength: length } = draco;
  if (
    !(typeof at === 'number' && Number.isInteger(at) && at >= 0) ||
    !(typeof length === 'number' && Number.isInteger(length) && length > 0) ||
    at + length > body.bytes.length
  ) {
    throw new Error('its data is outside the feature table');
  }
  return decode(body.bytes.subarray(at, at + length), draco.properties, points);
}

/** The feature table's binary body, read where its JSON says, within bounds. */
class Body {
  private readonly view: DataView;

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  /**
   * Where a value for `points` points starts in the body, and its component type, when it is
   * there and fits: the JSON's, or the first allowed when the JSON leaves it out.
   */
  locate(
    value: unknown,
    points: number,
    components: number,
    allowed: readonly string[],
  ): { at: number; type: string } | undefined {
    if (!isObject(value) || typeof value.byteOffset !== 'number') return undefined;
    const type = typeof value.componentType === 'string' ? value.componentType : allowed[0];
    if (!allowed.includes(type)) return undefined;
    const at = value.byteOffset;
    const size = COMPONENT_BYTES[type] * components;
    if (!(Number.isInteger(at) && at >= 0 && at + points * size <= this.bytes.length)) {
      return undefined;
    }
    return { at, type };
  }

  /** A value for the whole tile: in the JSON, or `components` numbers in the body. */
  global(value: unknown, type: 'FLOAT' | 'UNSIGNED_BYTE', components: number) {
    let numbers: unknown[] | undefined;
    if (Array.isArray(value)) numbers = value;
    else {
      const place = this.locate(value, 1, components, [type]);
      if (place) {
        numbers = Array.from({ length: components }, (_, i) =>
          type === 'FLOAT'
            ? this.view.getFloat32(place.at + 4 * i, true)
            : this.view.getUint8(place.at + i),
        );
      }
    }
    if (numbers?.length !== components) return undefined;
    return numbers.every((n) => typeof n === 'number' && Number.isFinite(n))
      ? (numbers as number[])
      : undefined;
  }

  float(at: number): number {
    return this.view.getFloat32(at, true);
  }

  uint8(at: number): number {
    return this.view.getUint8(at);
  }

  uint16(at: number): number {
    return this.view.getUint16(at, true);
  }
}

/**
 * POSITION, decoded or in the body, or POSITION_QUANTIZED within the quantized volume; far
 * coordinates moved near 0.
 */
function readPositions(
  table: Record<string, unknown>,
  body: Body,
  points: number,
  origin: Origin,
  decoded: DecodedPoints['POSITION'],
): Float32Array | undefined {
  const positions = new Float32Array(points * 3);
  const put = (index: number, x: number, y: number, z: number) => {
    origin.decide(x, y, z);
    positions[index * 3] = x - origin.x;
    positions[index * 3 + 1] = y - origin.y;
    positions[index * 3 + 2] = z - origin.z;
  };
  if (decoded) {
    for (let i = 0; i < points; i++) put(i, decoded[i * 3], decoded[i * 3 + 1], decoded[i * 3 + 2]);
    return positions;
  }
  const plain = body.locate(table.POSITION, points, 3, ['FLOAT']);
  if (plain) {
    for (let i = 0, at = plain.at; i < points; i++, at += 12) {
      put(i, body.float(at), body.float(at + 4), body.float(at + 8));
    }
    return positions;
  }
  const quantized = body.locate(table.POSITION_QUANTIZED, points, 3, ['UNSIGNED_SHORT']);
  const offset = body.global(table.QUANTIZED_VOLUME_OFFSET, 'FLOAT', 3);
  const scale = body.global(table.QUANTIZED_VOLUME_SCALE, 'FLOAT', 3);
  if (!quantized || !offset || !scale) return undefined;
  const [sx, sy, sz] = scale.map((value) => value / 65535);
  for (let i = 0, at = quantized.at; i < points; i++, at += 6) {
    put(
      i,
      offset[0] + body.uint16(at) * sx,
      offset[1] + body.uint16(at + 2) * sy,
      offset[2] + body.uint16(at + 4) * sz,
    );
  }
  return positions;
}

/**
 * RGBA, RGB (each decoded or in the body), RGB565 or CONSTANT_RGBA, as linear colors; `alpha`
 * when any is see-through.
 */
function readColors(
  table: Record<string, unknown>,
  body: Body,
  points: number,
  decoded: DecodedPoints,
): Pick<MeshPart, 'colors' | 'alpha'> | undefined {
  const colors = new Uint16Array(points * 4);
  let alpha = false;
  // Bytes of each point's color, one after another from `at`.
  const bytes = (semantic: 'RGBA' | 'RGB', components: number) => {
    const compressed = decoded[semantic];
    if (compressed) return { source: compressed, at: 0 };
    const place = body.locate(table[semantic], points, components, ['UNSIGNED_BYTE']);
    return place && { source: body.bytes, at: place.at };
  };
  const rgba = bytes('RGBA', 4);
  const rgb = rgba ? undefined : bytes('RGB', 3);
  const rgb565 = body.locate(table.RGB565, points, 1, ['UNSIGNED_SHORT']);
  const constant = body.global(table.CONSTANT_RGBA, 'UNSIGNED_BYTE', 4);
  if (rgba || rgb) {
    const stride = rgba ? 4 : 3;
    const { source, at: start } = (rgba ?? rgb)!;
    for (let i = 0, at = start; i < points; i++, at += stride) {
      colors[i * 4] = LINEAR_BYTES[source[at]];
      colors[i * 4 + 1] = LINEAR_BYTES[source[at + 1]];
      colors[i * 4 + 2] = LINEAR_BYTES[source[at + 2]];
      const a = rgba ? source[at + 3] : 255;
      colors[i * 4 + 3] = a * 257;
      if (a < 255) alpha = true;
    }
  } else if (rgb565) {
    for (let i = 0, at = rgb565.at; i < points; i++, at += 2) {
      const value = body.uint16(at);
      colors[i * 4] = linearChannel((value >> 11) / 31);
      colors[i * 4 + 1] = linearChannel(((value >> 5) & 0x3f) / 63);
      colors[i * 4 + 2] = linearChannel((value & 0x1f) / 31);
      colors[i * 4 + 3] = 65535;
    }
  } else if (constant) {
    const [r, g, b, a] = constant.map((value) => Math.min(255, Math.max(0, Math.round(value))));
    for (let i = 0; i < points; i++) {
      colors.set([LINEAR_BYTES[r], LINEAR_BYTES[g], LINEAR_BYTES[b], a * 257], i * 4);
    }
    alpha = a < 255;
  } else {
    return undefined;
  }
  return alpha ? { colors, alpha } : { colors };
}

/**
 * NORMAL, decoded or in the body, or NORMAL_OCT16P: two bytes, a point on an octahedron unfolded
 * into a square.
 */
function readNormals(
  table: Record<string, unknown>,
  body: Body,
  points: number,
  decoded: DecodedPoints['NORMAL'],
): Float32Array | undefined {
  if (decoded) return decoded;
  const normals = new Float32Array(points * 3);
  const plain = body.locate(table.NORMAL, points, 3, ['FLOAT']);
  if (plain) {
    for (let i = 0, at = plain.at; i < points * 3; i++, at += 4) normals[i] = body.float(at);
    return normals;
  }
  const oct = body.locate(table.NORMAL_OCT16P, points, 2, ['UNSIGNED_BYTE']);
  if (!oct) return undefined;
  for (let i = 0, at = oct.at; i < points; i++, at += 2) {
    let x = (body.uint8(at) / 255) * 2 - 1;
    let y = (body.uint8(at + 1) / 255) * 2 - 1;
    const z = 1 - Math.abs(x) - Math.abs(y);
    if (z < 0) {
      [x, y] = [(1 - Math.abs(y)) * Math.sign(x || 1), (1 - Math.abs(x)) * Math.sign(y || 1)];
    }
    const length = Math.hypot(x, y, z) || 1;
    normals.set([x / length, y / length, z / length], i * 3);
  }
  return normals;
}
