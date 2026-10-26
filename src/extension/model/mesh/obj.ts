// Wavefront OBJ: vertices, texture coordinates and normals in lists of their own, faces that pick
// one of each for every corner. Each object (`o`) and group (`g`) becomes a node; within one, the
// faces of each material are a primitive, its vertices the distinct corners its faces use.
// Faces without normals in a smoothing group (`s 1`) get normals averaged over the faces of that
// group around each vertex, as Blender and 3ds Max draw them; other faces without normals stay
// flat, in a primitive of their own.
import type { ObjFacts } from '../../../shared/protocol';
import { Growable, TripleIndex } from './arrays';
import {
  MeshFormatError,
  Origin,
  linearChannel,
  type MeshMaterial,
  type MeshObject,
  type MeshPart,
  type MeshProblem,
  type MeshReader,
  type ParsedMesh,
  type PartMode,
} from './geometry';
import { triangulate } from './polygon';
import { Cursor, LineSplitter, concat, decodeText, utf16 } from './text';

const NONE = -1;
/** A corner's normal index at or below this is a made one: smoothed normal `SMOOTHED - index`. */
const SMOOTHED = -2;
const HASH = 0x23;
const BACKSLASH = 0x5c;
const SPACE = 0x20;
const TAB = 0x09;
const LOWER_V = 0x76;
const LOWER_T = 0x74;
const LOWER_N = 0x6e;
const LOWER_F = 0x66;

const utf8 = new TextEncoder();

/** Free-form curves and surfaces: valid OBJ, but not drawn. */
const FREE_FORM = new Set(['curv', 'curv2', 'surf']);
/** Comments kept from the top of the file. */
const COMMENTS = 10;

class Primitive {
  /** Each distinct corner: its position, texture and normal index (or NONE, or a smoothed one). */
  readonly corners = new Growable(Int32Array, 64);
  readonly indices = new Growable(Uint32Array, 64);
  readonly table = new TripleIndex(16);
  textured = 0;
  untextured = 0;
  withNormal = 0;
  withoutNormal = 0;

  constructor(
    readonly mode: PartMode,
    readonly material: number | undefined,
  ) {}

  /** Adds a corner, as a new vertex if no corner before it was the same. */
  corner(v: number, vt: number, vn: number): void {
    const index = this.table.index(v, vt + 1, vn + 1);
    if (this.table.added) {
      this.corners.push3(v, vt, vn);
      if (vt === NONE) this.untextured++;
      else this.textured++;
      if (vn === NONE) this.withoutNormal++;
      else this.withNormal++;
    }
    this.indices.push(index);
  }
}

class Node {
  readonly children: Node[] = [];
  readonly primitives = new Map<string, Primitive>();
  /** Children by name, as files go back to a group they started before. */
  readonly named = new Map<string, Node>();

  constructor(readonly name: string | undefined) {}

  /** Faces with normals and faces drawn flat, without, go in primitives apart. */
  primitive(mode: PartMode, material: number | undefined, normals: boolean): Primitive {
    const key = `${mode}:${material ?? ''}:${normals ? 'n' : ''}`;
    let primitive = this.primitives.get(key);
    if (!primitive) {
      primitive = new Primitive(mode, material);
      this.primitives.set(key, primitive);
    }
    return primitive;
  }

  child(name: string): Node {
    let node = this.named.get(name);
    if (!node) {
      node = new Node(name);
      this.named.set(name, node);
      this.children.push(node);
    }
    return node;
  }
}

export class ObjReader implements MeshReader {
  private readonly cursor = new Cursor();
  private readonly lines = new LineSplitter((bytes, start, end) => this.line(bytes, start, end));
  private readonly origin = new Origin();
  private readonly positions = new Growable(Float64Array, 1 << 16);
  /** sRGB colors of the vertices, three each, once any vertex has one. */
  private colors: Growable<Float32Array> | undefined;
  private brightest = 0;
  private readonly texcoords = new Growable(Float32Array, 1 << 14);
  private readonly normals = new Growable(Float32Array, 1 << 14);
  /** The smoothing group of the faces read, from `s`: 0 when off. */
  private smoothing = 0;
  /**
   * Smoothed normals: one for each vertex and smoothing group that a face without normals uses,
   * as a sum of face normals weighted by the angle of each face at the vertex.
   */
  private readonly smoothedSums = new Growable(Float32Array, 3 * 256);
  /** By vertex, the first group it was smoothed in and its smoothed normal there, plus 1… */
  private groupAt = new Int32Array(0);
  private smoothedAt = new Int32Array(0);
  /** …and, for vertices on the border of groups, by vertex and group, those of other groups. */
  private readonly otherIndex = new TripleIndex(64);
  private readonly otherSmoothed = new Growable(Int32Array, 64);
  /** Vertices whose coordinates aren't numbers: faces using them are left out. */
  private readonly invalid = new Set<number>();
  /** The file's top level: a node for each object, and groups outside any. */
  private readonly root = new Node(undefined);
  private object: Node | undefined;
  private group: Node | undefined;
  /** Where faces go before the file names an object or group. */
  private unnamed: Node | undefined;
  private readonly materials: MeshMaterial[] = [];
  private readonly materialIndex = new Map<string, number>();
  private material: number | undefined;
  private readonly libraries: string[] = [];
  private readonly statements: Record<string, number> = {};
  private faces = 0;
  private readonly comments: string[] = [];
  private started = false;
  private broken = 0;
  private freeForm = 0;
  /** A line ending in a backslash, waiting for the one it continues on. */
  private continued: Uint8Array | undefined;
  /** One polygon's corners while it is read, their positions, and the primitive it goes in. */
  private polygon = new Int32Array(3 * 64);
  private polygonXyz = new Float64Array(3 * 64);
  private polygonPart: Primitive | undefined;
  /** Whether the polygon read has corners with smoothed normals. */
  private polygonSmoothed = false;
  private first = true;
  /** For a file in UTF-16, as some Windows tools write text: read as UTF-8. */
  private transcoder: InstanceType<typeof TextDecoder> | undefined;

  push(chunk: Uint8Array): void {
    if (this.first) {
      this.first = false;
      const encoding = utf16(chunk);
      if (encoding) this.transcoder = new TextDecoder(encoding);
      // UTF-8's byte order mark would read as part of the first statement.
      else if (chunk[0] === 0xef && chunk[1] === 0xbb && chunk[2] === 0xbf) {
        chunk = chunk.subarray(3);
      }
    }
    if (this.transcoder) {
      chunk = utf8.encode(this.transcoder.decode(chunk, { stream: true }));
    }
    this.lines.push(chunk);
  }

  private line(bytes: Uint8Array, start: number, end: number): void {
    if (end > start && bytes[end - 1] === BACKSLASH) {
      const part = concat(bytes.subarray(start, end - 1), new Uint8Array([SPACE]));
      this.continued = this.continued ? concat(this.continued, part) : part;
      return;
    }
    if (this.continued) {
      const joined = concat(this.continued, bytes.subarray(start, end));
      this.continued = undefined;
      this.statement(joined, 0, joined.length);
      return;
    }
    this.statement(bytes, start, end);
  }

  private statement(bytes: Uint8Array, start: number, end: number): void {
    const cursor = this.cursor.reset(bytes, start, end);
    cursor.skipSpaces();
    const at = cursor.pos;
    if (at >= end) return;
    const first = bytes[at];
    const second = at + 1 < end ? bytes[at + 1] : SPACE;
    const spaced = (byte: number) => byte === SPACE || byte === TAB;
    if (first === HASH) {
      if (!this.started && this.comments.length < COMMENTS) {
        const comment = decodeText(bytes.subarray(at + 1, end)).trim();
        if (comment) this.comments.push(comment);
      }
      return;
    }
    this.started = true;
    if (first === LOWER_V && spaced(second)) {
      cursor.pos = at + 1;
      return this.vertex(cursor);
    }
    if (first === LOWER_V && second === LOWER_T && (at + 2 >= end || spaced(bytes[at + 2]))) {
      cursor.pos = at + 2;
      const u = cursor.number();
      const v = cursor.number();
      this.texcoords.push(Number.isFinite(u) ? u : 0);
      this.texcoords.push(Number.isFinite(v) ? v : 0);
      return;
    }
    if (first === LOWER_V && second === LOWER_N && (at + 2 >= end || spaced(bytes[at + 2]))) {
      cursor.pos = at + 2;
      const x = cursor.number();
      const y = cursor.number();
      const z = cursor.number();
      this.normals.push3(x || 0, y || 0, z || 0);
      return;
    }
    if (first === LOWER_F && spaced(second)) {
      cursor.pos = at + 1;
      this.faces++;
      return this.face(cursor, 'triangles');
    }
    const keyword = cursor.word();
    this.statements[keyword] = (this.statements[keyword] ?? 0) + 1;
    switch (keyword) {
      case 'l':
        return this.face(cursor, 'lines');
      case 'p':
        return this.face(cursor, 'points');
      case 'o':
        this.object = this.root.child(cursor.rest() || '');
        this.group = undefined;
        return;
      case 'g': {
        const name = cursor.rest();
        // A bare `g`, or `default`, goes back to faces of the object itself.
        if (!name || name === 'default') this.group = undefined;
        else this.group = (this.object ?? this.root).child(name);
        return;
      }
      case 's':
        this.smoothing = smoothingGroup(cursor.rest());
        return;
      case 'usemtl':
        return this.useMaterial(cursor.rest());
      case 'mtllib':
        this.libraries.push(...libraryNames(cursor.rest()));
        return;
      default:
        if (FREE_FORM.has(keyword)) this.freeForm++;
    }
  }

  private vertex(cursor: Cursor): void {
    const x = cursor.number();
    const y = cursor.number();
    const z = cursor.number();
    const index = this.positions.length / 3;
    if (!Number.isFinite(x + y + z)) this.invalid.add(index);
    this.origin.decide(x, y, z);
    this.positions.push3(x, y, z);
    // `v x y z r g b`: a color after the position, as MeshLab and ZBrush write; a single
    // number there is a weight, which isn't used.
    const r = cursor.number();
    const g = Number.isNaN(r) ? Number.NaN : cursor.number();
    const b = Number.isNaN(g) ? Number.NaN : cursor.number();
    if (!Number.isNaN(b)) {
      if (!this.colors) {
        this.colors = new Growable(Float32Array, this.positions.array.length);
        // Vertices before the first with a color are white.
        for (let before = 0; before < index; before++) this.colors.push3(1, 1, 1);
      }
      this.colors.push3(r, g, b);
      this.brightest = Math.max(this.brightest, r, g, b);
    } else if (this.colors) {
      this.colors.push3(1, 1, 1);
    }
  }

  /** A face, line or point statement: corners as `v`, `v/vt`, `v//vn` or `v/vt/vn`. */
  private face(cursor: Cursor, mode: PartMode): void {
    const vertices = this.positions.length / 3;
    const textures = this.texcoords.length / 2;
    const normals = this.normals.length / 3;
    let count = 0;
    let bad = false;
    while (!cursor.atEnd()) {
      const v = resolve(cursor.integer(), vertices);
      let vt = NONE;
      let vn = NONE;
      if (cursor.slash()) {
        if (cursor.slash()) {
          vn = resolve(cursor.integer(), normals);
          bad ||= vn === NONE;
        } else {
          vt = resolve(cursor.integer(), textures);
          bad ||= vt === NONE;
          if (cursor.slash()) {
            vn = resolve(cursor.integer(), normals);
            bad ||= vn === NONE;
          }
        }
      }
      if (v === NONE || this.invalid.has(v)) bad = true;
      // Anything else in the word (a fourth index, a stray character) is passed over.
      while (!cursor.atWordEnd()) cursor.pos++;
      if (count * 3 + 3 > this.polygon.length) {
        const grown = new Int32Array(this.polygon.length * 2);
        grown.set(this.polygon);
        this.polygon = grown;
      }
      this.polygon[count * 3] = v;
      this.polygon[count * 3 + 1] = vt;
      this.polygon[count * 3 + 2] = vn;
      count++;
    }
    const least = mode === 'triangles' ? 3 : mode === 'lines' ? 2 : 1;
    if (bad || count < least) {
      this.broken++;
      return;
    }
    const corners = this.polygon;
    let withNormals = mode === 'triangles';
    this.polygonSmoothed = false;
    for (let i = 0; withNormals && i < count; i++) {
      if (corners[i * 3 + 2] !== NONE) continue;
      if (this.smoothing === 0) withNormals = false;
      else {
        corners[i * 3 + 2] = this.smoothed(corners[i * 3]);
        this.polygonSmoothed = true;
      }
    }
    const primitive = this.current().primitive(mode, this.material, withNormals);
    if (mode === 'triangles' && count === 3) {
      this.polygonPart = primitive;
      this.polygonTriangle(0, 1, 2);
    } else if (mode === 'triangles') {
      // Fans where convex, ears where not.
      this.polygonPart = primitive;
      triangulate(this.polygonPositions(count), count, this.polygonTriangle);
    } else if (mode === 'lines') {
      // Lines and points are drawn without texture coordinates or normals.
      for (let i = 0; i + 1 < count; i++) {
        primitive.corner(corners[i * 3], NONE, NONE);
        primitive.corner(corners[i * 3 + 3], NONE, NONE);
      }
    } else {
      for (let i = 0; i < count; i++) primitive.corner(corners[i * 3], NONE, NONE);
    }
  }

  /** The positions of the polygon's corners, read, in `polygonXyz`. */
  private polygonPositions(count: number): Float64Array {
    if (this.polygonXyz.length < count * 3) this.polygonXyz = new Float64Array(count * 6);
    const xyz = this.polygonXyz;
    const positions = this.positions.array;
    for (let i = 0; i < count; i++) {
      const v = this.polygon[i * 3] * 3;
      xyz[i * 3] = positions[v];
      xyz[i * 3 + 1] = positions[v + 1];
      xyz[i * 3 + 2] = positions[v + 2];
    }
    return xyz;
  }

  /** Adds a triangle of the polygon read, by its corners, to the primitive it is in. */
  private readonly polygonTriangle = (a: number, b: number, c: number): void => {
    const { polygon, polygonPart } = this;
    polygonPart!.corner(polygon[a * 3], polygon[a * 3 + 1], polygon[a * 3 + 2]);
    polygonPart!.corner(polygon[b * 3], polygon[b * 3 + 1], polygon[b * 3 + 2]);
    polygonPart!.corner(polygon[c * 3], polygon[c * 3 + 1], polygon[c * 3 + 2]);
    if (this.polygonSmoothed) this.smoothTriangle(a, b, c);
  };

  /** The smoothed normal of a vertex in the current smoothing group, as a normal index. */
  private smoothed(v: number): number {
    if (v >= this.smoothedAt.length) {
      const size = Math.max(v + 1, this.positions.array.length / 3);
      const groups = new Int32Array(size);
      groups.set(this.groupAt);
      this.groupAt = groups;
      const smoothed = new Int32Array(size);
      smoothed.set(this.smoothedAt);
      this.smoothedAt = smoothed;
    }
    const group = this.smoothing | 0;
    const first = this.smoothedAt[v];
    if (first === 0) {
      const index = this.newSmoothed();
      this.groupAt[v] = group;
      this.smoothedAt[v] = index + 1;
      return SMOOTHED - index;
    }
    if (this.groupAt[v] === group) return SMOOTHED - (first - 1);
    const other = this.otherIndex.index(v, group, 0);
    if (this.otherIndex.added) this.otherSmoothed.push(this.newSmoothed());
    return SMOOTHED - this.otherSmoothed.array[other];
  }

  private newSmoothed(): number {
    this.smoothedSums.push3(0, 0, 0);
    return this.smoothedSums.length / 3 - 1;
  }

  /**
   * Adds a triangle's normal to the smoothed normals of its corners, weighted by its angle at
   * each: a polygon cut into triangles then counts as much as the polygon.
   */
  private smoothTriangle(a: number, b: number, c: number): void {
    const { polygon } = this;
    const p = this.positions.array;
    const pa = polygon[a * 3] * 3;
    const pb = polygon[b * 3] * 3;
    const pc = polygon[c * 3] * 3;
    const abx = p[pb] - p[pa];
    const aby = p[pb + 1] - p[pa + 1];
    const abz = p[pb + 2] - p[pa + 2];
    const acx = p[pc] - p[pa];
    const acy = p[pc + 1] - p[pa + 1];
    const acz = p[pc + 2] - p[pa + 2];
    const bcx = acx - abx;
    const bcy = acy - aby;
    const bcz = acz - abz;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    // Twice the area: the length of every pair of edges' cross product, so each angle is
    // atan2 of it and the edges' dot product.
    const doubled = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (!(doubled > 0)) return;
    this.addSmoothed(polygon[a * 3 + 2], doubled, abx * acx + aby * acy + abz * acz, nx, ny, nz);
    this.addSmoothed(polygon[b * 3 + 2], doubled, -(abx * bcx + aby * bcy + abz * bcz), nx, ny, nz);
    this.addSmoothed(polygon[c * 3 + 2], doubled, acx * bcx + acy * bcy + acz * bcz, nx, ny, nz);
  }

  /** Adds a face normal `n`, of length `doubled`, to a smoothed one, by its angle at the corner. */
  private addSmoothed(
    vn: number,
    doubled: number,
    dot: number,
    nx: number,
    ny: number,
    nz: number,
  ): void {
    if (vn > SMOOTHED) return;
    const weight = Math.atan2(doubled, dot) / doubled;
    const sums = this.smoothedSums.array;
    const at = (SMOOTHED - vn) * 3;
    sums[at] += nx * weight;
    sums[at + 1] += ny * weight;
    sums[at + 2] += nz * weight;
  }

  private current(): Node {
    if (this.group) return this.group;
    if (this.object) return this.object;
    this.unnamed ??= this.root.child('');
    return this.unnamed;
  }

  private useMaterial(name: string): void {
    if (!name) {
      this.material = undefined;
      return;
    }
    let index = this.materialIndex.get(name);
    if (index === undefined) {
      index = this.materials.push({ name }) - 1;
      this.materialIndex.set(name, index);
    }
    this.material = index;
  }

  finish(): ParsedMesh {
    if (this.transcoder) this.lines.push(utf8.encode(this.transcoder.decode()));
    this.lines.finish();
    if (this.continued) {
      const last = this.continued;
      this.continued = undefined;
      this.statement(last, 0, last.length);
    }
    const vertices = this.positions.length / 3;
    if (!this.started) throw new MeshFormatError('Nothing in this OBJ file');
    const statements: Record<string, number> = {};
    const counted: [string, number][] = [
      ['v', vertices],
      ['vt', this.texcoords.length / 2],
      ['vn', this.normals.length / 3],
      ['f', this.faces],
    ];
    for (const [keyword, count] of counted) if (count > 0) statements[keyword] = count;
    Object.assign(statements, this.statements);
    const facts: ObjFacts = {
      format: 'obj',
      statements,
      comments: this.comments,
      mtllibs: this.libraries,
      materials: [],
    };
    const objects = this.root.children
      .map((node) => this.object3d(node))
      .filter((object): object is MeshObject => object !== undefined);
    // Vertices with no faces, lines or points using them are a point cloud, as scanners write
    // them in OBJ: drawn as points.
    if (objects.length === 0 && vertices > this.invalid.size) objects.push(this.pointCloud());
    const problems: MeshProblem[] = [];
    if (this.broken > 0) problems.push({ kind: 'faces', count: this.broken });
    if (this.freeForm > 0) problems.push({ kind: 'freeForm', count: this.freeForm });
    return {
      objects,
      materials: this.materials,
      libraries: this.libraries,
      offset: this.origin.offset,
      facts,
      problems,
    };
  }

  /** Every vertex as a point, in the order of the file. */
  private pointCloud(): MeshObject {
    const vertices = this.positions.length / 3;
    const count = vertices - this.invalid.size;
    const source = this.positions.array;
    const positions = new Float32Array(count * 3);
    const colors = this.colors && new Uint16Array(count * 4);
    const scale = this.brightest > 1 ? 1 / 255 : 1;
    const { origin } = this;
    for (let v = 0, i = 0; v < vertices; v++) {
      if (this.invalid.has(v)) continue;
      positions[i * 3] = source[v * 3] - origin.x;
      positions[i * 3 + 1] = source[v * 3 + 1] - origin.y;
      positions[i * 3 + 2] = source[v * 3 + 2] - origin.z;
      if (colors) {
        const rgb = this.colors!.array;
        for (let channel = 0; channel < 3; channel++) {
          colors[i * 4 + channel] = linearChannel(rgb[v * 3 + channel] * scale);
        }
        colors[i * 4 + 3] = 65535;
      }
      i++;
    }
    return { parts: [{ mode: 'points', positions, colors }], children: [] };
  }

  /** A node with what it draws; undefined when it and its children draw nothing. */
  private object3d(node: Node): MeshObject | undefined {
    const children = node.children
      .map((child) => this.object3d(child))
      .filter((child): child is MeshObject => child !== undefined);
    const parts = [...node.primitives.values()]
      .filter((primitive) => primitive.indices.length > 0)
      .map((primitive) => this.part(primitive));
    if (parts.length === 0 && children.length === 0) return undefined;
    return { name: node.name || undefined, parts, children };
  }

  private part(primitive: Primitive): MeshPart {
    const corners = primitive.corners.take();
    const count = corners.length / 3;
    const source = this.positions.array;
    const { origin } = this;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const v = corners[i * 3] * 3;
      positions[i * 3] = source[v] - origin.x;
      positions[i * 3 + 1] = source[v + 1] - origin.y;
      positions[i * 3 + 2] = source[v + 2] - origin.z;
    }
    const part: MeshPart = {
      mode: primitive.mode,
      positions,
      indices: primitive.indices.take(),
      material: primitive.material,
    };
    if (primitive.textured > 0) {
      // Corners without texture coordinates among ones with them get 0, 0.
      const texcoords = this.texcoords.array;
      const uvs = new Float32Array(count * 2);
      for (let i = 0; i < count; i++) {
        const vt = corners[i * 3 + 1];
        uvs[i * 2] = vt === NONE ? 0 : texcoords[vt * 2];
        uvs[i * 2 + 1] = vt === NONE ? 1 : 1 - texcoords[vt * 2 + 1];
      }
      part.uvs = uvs;
    }
    // Normals only when every corner has one: a few missing would draw black.
    if (primitive.withNormal > 0 && primitive.withoutNormal === 0) {
      const read = this.normals.array;
      const sums = this.smoothedSums.array;
      const normals = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const vn = corners[i * 3 + 2];
        if (vn >= 0) {
          normals[i * 3] = read[vn * 3];
          normals[i * 3 + 1] = read[vn * 3 + 1];
          normals[i * 3 + 2] = read[vn * 3 + 2];
          continue;
        }
        const at = (SMOOTHED - vn) * 3;
        const [x, y, z] = [sums[at], sums[at + 1], sums[at + 2]];
        const length = Math.sqrt(x * x + y * y + z * z);
        // Only faces of no area meet here: they don't show, any direction does.
        if (!(length > 0)) normals[i * 3 + 1] = 1;
        else {
          normals[i * 3] = x / length;
          normals[i * 3 + 1] = y / length;
          normals[i * 3 + 2] = z / length;
        }
      }
      part.normals = normals;
    }
    if (this.colors) {
      const source = this.colors.array;
      // Some files write colors from 0 to 255.
      const scale = this.brightest > 1 ? 1 / 255 : 1;
      const colors = new Uint16Array(count * 4);
      for (let i = 0; i < count; i++) {
        const v = corners[i * 3] * 3;
        colors[i * 4] = linearChannel(source[v] * scale);
        colors[i * 4 + 1] = linearChannel(source[v + 1] * scale);
        colors[i * 4 + 2] = linearChannel(source[v + 2] * scale);
        colors[i * 4 + 3] = 65535;
      }
      part.colors = colors;
    }
    return part;
  }
}

/** An OBJ index, from 1 or counted back from the end when negative, as a 0-based one or NONE. */
function resolve(index: number, count: number): number {
  if (!Number.isFinite(index) || index === 0) return NONE;
  const resolved = index > 0 ? index - 1 : count + index;
  return resolved >= 0 && resolved < count ? resolved : NONE;
}

/**
 * The group an `s` statement starts: a number, 0 or `off` for none. Any other word, as `on`,
 * smooths.
 */
function smoothingGroup(text: string): number {
  const word = text.split(/\s+/)[0].toLowerCase();
  if (!word || word === 'off') return 0;
  const group = Number(word);
  return Number.isInteger(group) ? group : 1;
}

/**
 * The libraries an `mtllib` names. The statement lists several separated by spaces, but file
 * names with spaces are common: unless every word is a `.mtl` file, it is one name.
 */
export function libraryNames(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every((word) => /\.mtl$/i.test(word))) return words;
  return text ? [text] : [];
}
