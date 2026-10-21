// PLY, ASCII and binary of either byte order: a header that declares elements and their
// properties, then the elements' records in order. Vertices, faces and edges are read; any other
// element is passed over. A file with faces is a mesh, one without a point cloud.
import type { PlyFacts } from '../../../shared/protocol';
import { Growable, TripleIndex, bitsOf } from './arrays';
import {
  LINEAR_BYTES,
  MeshFormatError,
  Origin,
  linearChannel,
  type MeshPart,
  type MeshProblem,
  type MeshReader,
  type ParsedMesh,
} from './geometry';
import { Cursor, LineSplitter, concat, decodeText } from './text';

type ScalarType =
  'int8' | 'uint8' | 'int16' | 'uint16' | 'int32' | 'uint32' | 'float32' | 'float64';

const TYPES: Readonly<Record<string, ScalarType>> = {
  char: 'int8',
  int8: 'int8',
  uchar: 'uint8',
  uint8: 'uint8',
  short: 'int16',
  int16: 'int16',
  ushort: 'uint16',
  uint16: 'uint16',
  int: 'int32',
  int32: 'int32',
  uint: 'uint32',
  uint32: 'uint32',
  float: 'float32',
  float32: 'float32',
  double: 'float64',
  float64: 'float64',
};

const SIZES: Readonly<Record<ScalarType, number>> = {
  int8: 1,
  uint8: 1,
  int16: 2,
  uint16: 2,
  int32: 4,
  uint32: 4,
  float32: 4,
  float64: 8,
};

/** The largest value of each integer type, to read colors stored as integers from 0 to 1. */
const RANGES: Readonly<Record<ScalarType, number>> = {
  int8: 127,
  uint8: 255,
  int16: 32767,
  uint16: 65535,
  int32: 2147483647,
  uint32: 4294967295,
  float32: 1,
  float64: 1,
};

interface Property {
  name: string;
  type: ScalarType;
  /** For a list: the type of its count; `type` is then the type of its items. */
  count?: ScalarType;
  /** As the header writes it, for the inspector. */
  declared: string;
}

interface Element {
  name: string;
  count: number;
  properties: Property[];
}

/** Headers longer than this aren't PLY headers. */
const MAX_HEADER = 1 << 20;

/** Names of vertex properties, by what they are for, as the exporters spell them. */
const VERTEX_NAMES = {
  position: [['x'], ['y'], ['z']],
  normal: [['nx'], ['ny'], ['nz']],
  color: [
    ['red', 'r', 'diffuse_red'],
    ['green', 'g', 'diffuse_green'],
    ['blue', 'b', 'diffuse_blue'],
    ['alpha', 'a', 'diffuse_alpha'],
  ],
  uv: [
    ['s', 'u', 'texture_u', 'texture_s'],
    ['t', 'v', 'texture_v', 'texture_t'],
  ],
} as const;

export class PlyReader implements MeshReader {
  private header: Uint8Array | undefined = new Uint8Array(0);
  private facts: PlyFacts | undefined;
  private elements: Element[] = [];
  private body: AsciiBody | BinaryBody | undefined;
  private vertices: VertexData | undefined;
  private faces: FaceData | undefined;
  private edges: Growable<Uint32Array> | undefined;
  private readonly origin = new Origin();
  private readonly textures: string[] = [];
  /** Faces and edges that name vertices the file doesn't have. */
  private broken = 0;

  /** `size` bounds what the header's counts can make room for. */
  constructor(private readonly size: number) {}

  push(chunk: Uint8Array): void {
    if (this.body) return this.body.push(chunk);
    const header = concat(this.header!, chunk);
    const end = headerEnd(header);
    if (end < 0) {
      if (header.length > MAX_HEADER) throw new MeshFormatError('PLY header too long');
      this.header = header;
      return;
    }
    this.header = undefined;
    this.readHeader(decodeText(header.subarray(0, end)));
    this.startBody(this.size - end);
    if (end < header.length) this.body!.push(header.subarray(end));
  }

  private readHeader(text: string): void {
    const header = parseHeader(text);
    this.facts = header.facts;
    this.elements = header.elements;
    this.textures.push(...header.textures);
  }

  /** `bytes`: how much of the file is left for the elements' records. */
  private startBody(bytes: number): void {
    const encoding = this.facts!.encoding;
    const handlers = this.elements.map((element) => {
      // A record takes at least a byte per value in binary, two ("0 ") in ASCII: a header that
      // declares more records than that can't make the reader allocate more.
      const smallest = element.properties.reduce(
        (sum, property) =>
          sum +
          (encoding === 'ascii'
            ? 2
            : property.count
              ? SIZES[property.count]
              : SIZES[property.type]),
        0,
      );
      const records = Math.min(
        element.count,
        Math.floor(Math.max(0, bytes) / Math.max(1, smallest)),
      );
      return this.handler(element, records);
    });
    this.body =
      encoding === 'ascii'
        ? new AsciiBody(this.elements, handlers)
        : new BinaryBody(this.elements, handlers, encoding === 'binary_little_endian');
  }

  /**
   * What to do with each record of an element: keep what is drawn, pass over the rest. `records`
   * is how many the file has room for.
   */
  private handler(element: Element, records: number): RecordHandler {
    if (element.name === 'vertex' && !this.vertices) {
      this.vertices = new VertexData(element, records, this.origin);
      return this.vertices;
    }
    if (element.name === 'face' && !this.faces) {
      this.faces = new FaceData(element);
      return this.faces;
    }
    if (element.name === 'edge' && !this.edges) {
      const first = element.properties.findIndex((property) => property.name === 'vertex1');
      const second = element.properties.findIndex((property) => property.name === 'vertex2');
      if (first >= 0 && second >= 0) {
        const edges = (this.edges = new Growable(
          Uint32Array,
          Math.min(element.count, 1 << 20) * 2,
        ));
        return {
          record: (values) => {
            edges.push(values[first]);
            edges.push(values[second]);
          },
        };
      }
    }
    return { record: () => {} };
  }

  finish(): ParsedMesh {
    if (!this.body) {
      // A header with nothing after it: the last line has no line break of its own.
      const header = this.header!;
      if (headerEnd(concat(header, new Uint8Array([0x0a]))) !== header.length + 1) {
        throw new MeshFormatError('PLY header without end_header');
      }
      this.readHeader(decodeText(header));
      this.startBody(0);
    }
    const complete = this.body!.finish();
    const problems: MeshProblem[] = complete ? [] : [{ kind: 'truncated' }];
    const vertices = this.vertices;
    const parts: MeshPart[] = [];
    const textured = this.textures.length > 0 && (vertices?.uvs || this.faces?.texcoords);
    const material = textured ? 0 : undefined;
    if (vertices && vertices.count > 0) {
      // Vertices without coordinates (scanners write NaN where they saw nothing) are left out,
      // with the faces and edges that use them.
      const remap = vertices.compact();
      const count = vertices.count;
      const faces = this.faces?.take(count, remap);
      if (faces) this.broken += faces.broken;
      if (faces && faces.indices.length > 0) {
        parts.push(
          faces.texcoords
            ? wedgeVertices(vertices, faces.indices, faces.texcoords, material)
            : { mode: 'triangles', ...vertices.attributes(), indices: faces.indices, material },
        );
      }
      const edges = this.edges?.take();
      if (edges && edges.length > 0) {
        const kept = keepInRange(remapped(edges, remap), 2, count);
        this.broken += (edges.length - kept.length) / 2;
        if (kept.length > 0) parts.push({ mode: 'lines', ...vertices.attributes(), indices: kept });
      }
      if (parts.length === 0 && count > 0) parts.push({ mode: 'points', ...vertices.attributes() });
    }
    if (this.broken > 0) problems.push({ kind: 'faces', count: this.broken });
    const texture = this.textures[0];
    return {
      objects: [{ parts, children: [] }],
      materials: textured ? [{ name: texture, texture }] : [],
      libraries: [],
      offset: this.origin.offset,
      facts: this.facts!,
      problems,
    };
  }
}

/** Vertex indices after vertices were left out: `remap` gives each old index its new one, or -1. */
function remapped(indices: Uint32Array, remap: Int32Array | undefined): Uint32Array {
  if (!remap) return indices;
  for (let i = 0; i < indices.length; i++) {
    const index = indices[i];
    // Past the vertices read, or one left out: no vertex, which the range check drops.
    indices[i] = index < remap.length && remap[index] >= 0 ? remap[index] : 0xffffffff;
  }
  return indices;
}

/** Where the header ends: just past the line break after `end_header`, or -1 if not yet. */
function headerEnd(bytes: Uint8Array): number {
  const marker = 'end_header';
  for (let at = bytes.indexOf(0x65); at >= 0; at = bytes.indexOf(0x65, at + 1)) {
    let match = at + marker.length <= bytes.length;
    for (let i = 0; match && i < marker.length; i++) match = bytes[at + i] === marker.charCodeAt(i);
    if (!match) continue;
    // At the start of a line, and followed by its line break.
    if (at > 0 && bytes[at - 1] !== 0x0a) continue;
    let end = at + marker.length;
    while (end < bytes.length && (bytes[end] === 0x20 || bytes[end] === 0x0d)) end++;
    if (end >= bytes.length) return -1;
    if (bytes[end] === 0x0a) return end + 1;
  }
  return -1;
}

/** A PLY header: what the inspector shows, the elements to read, and MeshLab's textures. */
function parseHeader(text: string): { facts: PlyFacts; elements: Element[]; textures: string[] } {
  const elements: Element[] = [];
  const textures: string[] = [];
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== 'ply') throw new MeshFormatError('Not a PLY file');
  const facts: PlyFacts = {
    format: 'ply',
    encoding: 'ascii',
    version: '',
    comments: [],
    objInfo: [],
    elements: [],
  };
  let format = false;
  for (const raw of lines.slice(1)) {
    const line = raw.trim();
    const [keyword, ...words] = line.split(/\s+/);
    if (keyword === 'format') {
      if (
        words[0] !== 'ascii' &&
        words[0] !== 'binary_little_endian' &&
        words[0] !== 'binary_big_endian'
      ) {
        throw new MeshFormatError(`Unknown PLY format ${words[0]}`);
      }
      facts.encoding = words[0];
      facts.version = words[1] ?? '';
      format = true;
    } else if (keyword === 'comment') {
      const comment = line.slice('comment'.length).trim();
      facts.comments.push(comment);
      // MeshLab names the model's texture this way.
      const texture = /^TextureFile\s+(.+)$/i.exec(comment)?.[1].trim();
      if (texture) textures.push(texture);
    } else if (keyword === 'obj_info') {
      facts.objInfo.push(line.slice('obj_info'.length).trim());
    } else if (keyword === 'element') {
      const count = Number(words[1]);
      if (!words[0] || !Number.isSafeInteger(count) || count < 0) {
        throw new MeshFormatError(`Bad PLY element: ${line}`);
      }
      elements.push({ name: words[0], count, properties: [] });
    } else if (keyword === 'property') {
      const element = elements.at(-1);
      if (!element) throw new MeshFormatError('PLY property before any element');
      element.properties.push(property(words, line));
    } else if (keyword !== '' && keyword !== 'end_header') {
      throw new MeshFormatError(`Unknown PLY header line: ${line}`);
    }
  }
  if (!format) throw new MeshFormatError('PLY header without a format');
  facts.elements = elements.map(({ name, count, properties }) => ({
    name,
    count,
    properties: properties.map((property) => property.declared),
  }));
  return { facts, elements, textures };
}

/** The facts a PLY header gives, from the start of the file; undefined if it isn't all there. */
export function plyHeaderFacts(head: Uint8Array): PlyFacts | undefined {
  const end = headerEnd(head);
  if (end < 0) return undefined;
  try {
    return parseHeader(decodeText(head.subarray(0, end))).facts;
  } catch {
    return undefined;
  }
}

function property(words: string[], line: string): Property {
  if (words[0] === 'list') {
    const count = TYPES[words[1]];
    const type = TYPES[words[2]];
    if (!count || !type || !words[3]) throw new MeshFormatError(`Bad PLY property: ${line}`);
    return { name: words[3], type, count, declared: `list ${words[1]} ${words[2]} ${words[3]}` };
  }
  const type = TYPES[words[0]];
  if (!type || !words[1]) throw new MeshFormatError(`Bad PLY property: ${line}`);
  return { name: words[1], type, declared: `${words[0]} ${words[1]}` };
}

/**
 * Takes each record of an element: its scalar properties in `values`, by property index, and the
 * items of its list properties in `lists`, which are only valid during the call.
 */
interface RecordHandler {
  record(values: Float64Array, lists: readonly Float64Array[], listLengths: Int32Array): void;
}

/** The vertex element: positions always, normals, colors and texture coordinates when it has them. */
class VertexData implements RecordHandler {
  positions: Float32Array;
  normals: Float32Array | undefined;
  colors: Uint16Array | undefined;
  readonly alpha: boolean;
  uvs: Float32Array | undefined;
  count = 0;
  /** Vertices whose coordinates aren't finite numbers, by index; made when the first comes. */
  private invalid: Uint8Array | undefined;
  private invalidCount = 0;
  private readonly position: number[];
  private readonly normal: number[] | undefined;
  private readonly color: number[] | undefined;
  /** Colors stored as bytes, converted through a table. */
  private readonly colorBytes: boolean;
  private readonly colorRange: number;
  private readonly uv: number[] | undefined;

  constructor(
    element: Element,
    /** How many vertices there can be room for. */
    private readonly capacity: number,
    private readonly origin: Origin,
  ) {
    const find = (names: readonly string[]) =>
      element.properties.findIndex((property) => !property.count && names.includes(property.name));
    const all = (groups: readonly (readonly string[])[]) => {
      const found = groups.map(find);
      return found.every((index) => index >= 0) ? found : undefined;
    };
    const position = all(VERTEX_NAMES.position);
    if (!position) throw new MeshFormatError('PLY vertices without x, y and z');
    this.position = position;
    this.normal = all(VERTEX_NAMES.normal);
    this.color = all(VERTEX_NAMES.color.slice(0, 3));
    const alpha = find(VERTEX_NAMES.color[3]);
    if (this.color && alpha >= 0) this.color.push(alpha);
    this.alpha = this.color?.length === 4;
    const colorType = this.color && element.properties[this.color[0]].type;
    this.colorBytes = colorType === 'uint8';
    this.colorRange = colorType ? RANGES[colorType] : 1;
    this.uv = all(VERTEX_NAMES.uv);
    const count = capacity;
    this.positions = new Float32Array(count * 3);
    if (this.normal) this.normals = new Float32Array(count * 3);
    if (this.color) this.colors = new Uint16Array(count * 4);
    if (this.uv) this.uvs = new Float32Array(count * 2);
  }

  record(values: Float64Array): void {
    if (this.count >= this.capacity) return;
    const index = this.count++;
    const [x, y, z] = this.position;
    const { origin } = this;
    const vx = values[x];
    const vy = values[y];
    const vz = values[z];
    if (!Number.isFinite(vx + vy + vz)) {
      this.invalid ??= new Uint8Array(this.capacity);
      this.invalid[index] = 1;
      this.invalidCount++;
    }
    origin.decide(vx, vy, vz);
    this.positions[index * 3] = vx - origin.x;
    this.positions[index * 3 + 1] = vy - origin.y;
    this.positions[index * 3 + 2] = vz - origin.z;
    if (this.normal) {
      for (let axis = 0; axis < 3; axis++)
        this.normals![index * 3 + axis] = values[this.normal[axis]];
    }
    if (this.color) {
      const colors = this.colors!;
      for (let channel = 0; channel < 3; channel++) {
        const value = values[this.color[channel]];
        colors[index * 4 + channel] = this.colorBytes
          ? LINEAR_BYTES[value & 0xff]
          : linearChannel(value / this.colorRange);
      }
      colors[index * 4 + 3] = this.alpha
        ? Math.round(Math.min(1, Math.max(0, values[this.color[3]] / this.colorRange)) * 65535)
        : 65535;
    }
    if (this.uv) {
      this.uvs![index * 2] = values[this.uv[0]];
      this.uvs![index * 2 + 1] = 1 - values[this.uv[1]];
    }
  }

  /**
   * Leaves out the vertices without finite coordinates, moving the others up: what each old index
   * became, -1 for those left out; undefined when all of them stay.
   */
  compact(): Int32Array | undefined {
    const invalid = this.invalid;
    if (!invalid || this.invalidCount === 0) return undefined;
    const remap = new Int32Array(this.count);
    let kept = 0;
    for (let index = 0; index < this.count; index++) {
      if (invalid[index]) {
        remap[index] = -1;
        continue;
      }
      remap[index] = kept;
      if (kept !== index) {
        this.positions.copyWithin(kept * 3, index * 3, index * 3 + 3);
        this.normals?.copyWithin(kept * 3, index * 3, index * 3 + 3);
        this.colors?.copyWithin(kept * 4, index * 4, index * 4 + 4);
        this.uvs?.copyWithin(kept * 2, index * 2, index * 2 + 2);
      }
      kept++;
    }
    this.count = kept;
    this.invalid = undefined;
    return remap;
  }

  /** The vertex attributes as a part has them, cut to the vertices the file really had. */
  attributes(): Pick<MeshPart, 'positions' | 'normals' | 'colors' | 'alpha' | 'uvs'> {
    const count = this.count;
    const cut = <T extends Float32Array | Uint16Array>(array: T | undefined, size: number) =>
      array && (array.length === count * size ? array : (array.subarray(0, count * size) as T));
    return {
      positions: cut(this.positions, 3)!,
      normals: cut(this.normals, 3),
      colors: cut(this.colors, 4),
      alpha: this.alpha || undefined,
      uvs: cut(this.uvs, 2),
    };
  }
}

/** The face element: polygons as triangles, with the texture coordinates of each corner if any. */
class FaceData implements RecordHandler {
  private readonly indices: Growable<Uint32Array>;
  /** Per corner of each triangle, when faces carry their own texture coordinates. */
  readonly texcoords: Growable<Float32Array> | undefined;
  private readonly vertexList: number;
  private readonly texcoordList: number;
  private broken = 0;

  constructor(element: Element) {
    this.vertexList = element.properties.findIndex(
      (property) =>
        property.count && (property.name === 'vertex_indices' || property.name === 'vertex_index'),
    );
    if (this.vertexList < 0) throw new MeshFormatError('PLY faces without vertex indices');
    this.texcoordList = element.properties.findIndex(
      (property) => property.count && property.name === 'texcoord',
    );
    this.indices = new Growable(Uint32Array, Math.min(element.count, 1 << 22) * 3);
    if (this.texcoordList >= 0)
      this.texcoords = new Growable(Float32Array, Math.min(element.count, 1 << 22) * 6);
  }

  record(_values: Float64Array, lists: readonly Float64Array[], lengths: Int32Array): void {
    const corners = lists[this.vertexList];
    const count = lengths[this.vertexList];
    if (count < 3) {
      this.broken++;
      return;
    }
    const texcoords = this.texcoords && lists[this.texcoordList];
    const withTexcoords = texcoords && lengths[this.texcoordList] === count * 2;
    for (let i = 1; i + 1 < count; i++) {
      this.indices.push3(corners[0], corners[i], corners[i + 1]);
      if (this.texcoords) {
        for (const corner of [0, i, i + 1]) {
          this.texcoords.push(withTexcoords ? texcoords![corner * 2] : 0);
          this.texcoords.push(withTexcoords ? 1 - texcoords![corner * 2 + 1] : 0);
        }
      }
    }
  }

  /**
   * The triangles, without those naming vertices past `vertices` or left out: `remap` gives each
   * vertex index read its new one.
   */
  take(
    vertices: number,
    remap: Int32Array | undefined,
  ): { indices: Uint32Array; texcoords?: Float32Array; broken: number } {
    const indices = remapped(this.indices.take(), remap);
    const texcoords = this.texcoords?.take();
    let kept = 0;
    let broken = this.broken;
    for (let triangle = 0; triangle * 3 < indices.length; triangle++) {
      const a = indices[triangle * 3];
      const b = indices[triangle * 3 + 1];
      const c = indices[triangle * 3 + 2];
      if (a >= vertices || b >= vertices || c >= vertices) {
        broken++;
        continue;
      }
      indices[kept * 3] = a;
      indices[kept * 3 + 1] = b;
      indices[kept * 3 + 2] = c;
      if (texcoords) texcoords.copyWithin(kept * 6, triangle * 6, triangle * 6 + 6);
      kept++;
    }
    return {
      indices: kept * 3 === indices.length ? indices : indices.slice(0, kept * 3),
      texcoords:
        texcoords && (kept * 6 === texcoords.length ? texcoords : texcoords.slice(0, kept * 6)),
      broken,
    };
  }
}

/** `values` without the groups of `size` that name a vertex past `count`. */
function keepInRange(values: Uint32Array, size: number, count: number): Uint32Array {
  let kept = 0;
  for (let group = 0; group * size < values.length; group++) {
    let inside = true;
    for (let i = 0; i < size; i++) inside &&= values[group * size + i] < count;
    if (!inside) continue;
    values.copyWithin(kept * size, group * size, group * size + size);
    kept++;
  }
  return kept * size === values.length ? values : values.slice(0, kept * size);
}

/**
 * Triangles whose corners carry their own texture coordinates, as MeshLab writes them: each
 * distinct vertex and coordinate pair becomes a vertex of its own.
 */
function wedgeVertices(
  vertices: VertexData,
  corners: Uint32Array,
  texcoords: Float32Array,
  material: number | undefined,
): MeshPart {
  const source = vertices.attributes();
  const table = new TripleIndex(corners.length);
  const map = new Growable(Uint32Array, corners.length);
  const indices = new Uint32Array(corners.length);
  const uvs = new Growable(Float32Array, corners.length * 2);
  for (let corner = 0; corner < corners.length; corner++) {
    const u = texcoords[corner * 2];
    const v = texcoords[corner * 2 + 1];
    const index = table.index(corners[corner], bitsOf(u), bitsOf(v));
    if (table.added) {
      map.push(corners[corner]);
      uvs.push(u);
      uvs.push(v);
    }
    indices[corner] = index;
  }
  const from = map.take();
  const gather = <T extends Float32Array | Uint16Array>(
    array: T | undefined,
    size: number,
  ): T | undefined => {
    if (!array) return undefined;
    const out = new (array.constructor as new (length: number) => T)(from.length * size);
    for (let i = 0; i < from.length; i++) {
      for (let k = 0; k < size; k++) out[i * size + k] = array[from[i] * size + k];
    }
    return out;
  };
  return {
    mode: 'triangles',
    positions: gather(source.positions, 3)!,
    normals: gather(source.normals, 3),
    colors: gather(source.colors, 4),
    alpha: source.alpha,
    uvs: uvs.take(),
    indices,
    material,
  };
}

/** Scratch space for one record: scalar values by property, and list items. */
class RecordScratch {
  readonly values: Float64Array;
  readonly lists: Float64Array[];
  readonly lengths: Int32Array;

  constructor(element: Element) {
    this.values = new Float64Array(element.properties.length);
    this.lists = element.properties.map(() => new Float64Array(0));
    this.lengths = new Int32Array(element.properties.length);
  }

  /** Room for `count` items in list `index`. */
  list(index: number, count: number): Float64Array {
    if (this.lists[index].length < count) this.lists[index] = new Float64Array(Math.max(count, 16));
    this.lengths[index] = count;
    return this.lists[index];
  }
}

/** Items in one list past this make a record damaged rather than a buffer enormous. */
const MAX_LIST = 1 << 16;

class AsciiBody {
  private readonly cursor = new Cursor();
  private readonly lines = new LineSplitter((bytes, start, end) => this.line(bytes, start, end));
  private element = 0;
  private record = 0;
  private readonly scratch: RecordScratch[];

  constructor(
    private readonly elements: Element[],
    private readonly handlers: RecordHandler[],
  ) {
    this.scratch = elements.map((element) => new RecordScratch(element));
    this.skipEmpty();
  }

  push(chunk: Uint8Array): void {
    this.lines.push(chunk);
  }

  private skipEmpty(): void {
    while (
      this.element < this.elements.length &&
      this.record >= this.elements[this.element].count
    ) {
      this.element++;
      this.record = 0;
    }
  }

  private line(bytes: Uint8Array, start: number, end: number): void {
    if (this.element >= this.elements.length) return;
    const cursor = this.cursor.reset(bytes, start, end);
    if (cursor.atEnd()) return;
    const { properties } = this.elements[this.element];
    const scratch = this.scratch[this.element];
    for (let index = 0; index < properties.length; index++) {
      if (!properties[index].count) {
        scratch.values[index] = cursor.number();
        continue;
      }
      const count = cursor.number();
      if (!(count >= 0 && count <= MAX_LIST)) throw new MeshFormatError('Bad PLY list');
      const items = scratch.list(index, count);
      for (let i = 0; i < count; i++) items[i] = cursor.number();
    }
    this.handlers[this.element].record(scratch.values, scratch.lists, scratch.lengths);
    this.record++;
    this.skipEmpty();
  }

  /** True when every record the header declares was there. */
  finish(): boolean {
    this.lines.finish();
    return this.element >= this.elements.length;
  }
}

class BinaryBody {
  private pending = new Uint8Array(0);
  private element = 0;
  private record = 0;
  private readonly scratch: RecordScratch[];
  /** Each element's record size when it has no lists: read without bounds checks per value. */
  private readonly fixedSizes: (number | undefined)[];

  constructor(
    private readonly elements: Element[],
    private readonly handlers: RecordHandler[],
    private readonly little: boolean,
  ) {
    this.scratch = elements.map((element) => new RecordScratch(element));
    this.fixedSizes = elements.map((element) =>
      element.properties.some((property) => property.count)
        ? undefined
        : element.properties.reduce((sum, property) => sum + SIZES[property.type], 0),
    );
    this.skipEmpty();
  }

  private skipEmpty(): void {
    while (
      this.element < this.elements.length &&
      this.record >= this.elements[this.element].count
    ) {
      this.element++;
      this.record = 0;
    }
  }

  push(chunk: Uint8Array): void {
    const data = this.pending.length > 0 ? concat(this.pending, chunk) : chunk;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let pos = 0;
    while (this.element < this.elements.length) {
      const next = this.readRecord(view, pos);
      if (next < 0) break;
      pos = next;
      this.record++;
      this.skipEmpty();
    }
    this.pending = this.element < this.elements.length ? data.slice(pos) : new Uint8Array(0);
  }

  /** Reads one record at `pos` and hands it on: the position after it, or -1 if it isn't all here. */
  private readRecord(view: DataView, pos: number): number {
    const element = this.elements[this.element];
    const scratch = this.scratch[this.element];
    const fixed = this.fixedSizes[this.element];
    const little = this.little;
    if (fixed !== undefined) {
      if (pos + fixed > view.byteLength) return -1;
      let at = pos;
      const { properties } = element;
      for (let index = 0; index < properties.length; index++) {
        const type = properties[index].type;
        scratch.values[index] = read(view, at, type, little);
        at += SIZES[type];
      }
      this.handlers[this.element].record(scratch.values, scratch.lists, scratch.lengths);
      return at;
    }
    let at = pos;
    for (let index = 0; index < element.properties.length; index++) {
      const property = element.properties[index];
      if (!property.count) {
        const size = SIZES[property.type];
        if (at + size > view.byteLength) return -1;
        scratch.values[index] = read(view, at, property.type, little);
        at += size;
        continue;
      }
      const countSize = SIZES[property.count];
      if (at + countSize > view.byteLength) return -1;
      const count = read(view, at, property.count, little);
      at += countSize;
      if (!(count >= 0 && count <= MAX_LIST)) throw new MeshFormatError('Bad PLY list');
      const size = SIZES[property.type];
      if (at + count * size > view.byteLength) return -1;
      const items = scratch.list(index, count);
      for (let i = 0; i < count; i++, at += size) items[i] = read(view, at, property.type, little);
    }
    this.handlers[this.element].record(scratch.values, scratch.lists, scratch.lengths);
    return at;
  }

  finish(): boolean {
    return this.element >= this.elements.length;
  }
}

function read(view: DataView, at: number, type: ScalarType, little: boolean): number {
  switch (type) {
    case 'float32':
      return view.getFloat32(at, little);
    case 'uint8':
      return view.getUint8(at);
    case 'int32':
      return view.getInt32(at, little);
    case 'uint32':
      return view.getUint32(at, little);
    case 'float64':
      return view.getFloat64(at, little);
    case 'int16':
      return view.getInt16(at, little);
    case 'uint16':
      return view.getUint16(at, little);
    case 'int8':
      return view.getInt8(at);
  }
}
