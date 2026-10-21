// STL, binary and ASCII. Vertices with exactly the same coordinates are welded into one, so the
// model has the vertex count and memory of an indexed mesh; facet normals aren't kept, as files
// often have them zero or wrong, and a mesh without normals is drawn flat-shaded from its winding.
import type { StlFacts } from '../../../shared/protocol';
import { Growable, TripleIndex, bitsOf } from './arrays';
import {
  LINEAR_BYTES,
  MeshFormatError,
  Origin,
  type MeshObject,
  type MeshProblem,
  type MeshReader,
  type ParsedMesh,
} from './geometry';
import { Cursor, LineSplitter, concat, decodeText } from './text';

const HEADER = 80;
const FACET = 50;
/** Bytes looked at to tell ASCII from binary. */
const SNIFF = 512;

/**
 * Whether a file is binary or ASCII STL, from its first bytes (up to 512) and its size; undefined
 * when it is neither. Some binary files start with "solid" too, so ASCII also has to look like
 * text with facets in it.
 */
export function stlEncoding(head: Uint8Array, size: number): 'binary' | 'ascii' | undefined {
  const sniffed = head.subarray(0, SNIFF);
  const text = new TextDecoder('latin1').decode(sniffed);
  if (/^\s*solid(\s|$)/.test(text) && !text.includes('\0') && /\b(facet|endsolid)\b/.test(text)) {
    return 'ascii';
  }
  if (head.length < HEADER + 4 || size < HEADER + 4) return undefined;
  const count = new DataView(head.buffer, head.byteOffset + HEADER, 4).getUint32(0, true);
  if (HEADER + 4 + count * FACET === size) return 'binary';
  // A file cut short or padded is still binary if it doesn't read as text: coordinates as
  // floats are full of bytes that text never has.
  const binary = sniffed.some(
    (byte) => byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d,
  );
  return binary && count > 0 ? 'binary' : undefined;
}

export class StlReader implements MeshReader {
  private head: Uint8Array | undefined = new Uint8Array(0);
  private body: BinaryStl | AsciiStl | undefined;

  constructor(private readonly size: number) {}

  push(chunk: Uint8Array): void {
    if (this.body) return this.body.push(chunk);
    this.head = concat(this.head!, chunk);
    if (this.head.length >= SNIFF || this.head.length >= this.size) this.start();
  }

  finish(): ParsedMesh {
    if (!this.body) this.start();
    return this.body!.finish();
  }

  private start(): void {
    const head = this.head!;
    this.head = undefined;
    const encoding = stlEncoding(head, this.size);
    if (!encoding) throw new MeshFormatError('Not an STL file');
    this.body = encoding === 'binary' ? new BinaryStl() : new AsciiStl();
    this.body.push(head);
  }
}

class BinaryStl {
  private pending = new Uint8Array(0);
  private header: Uint8Array | undefined;
  private declared = 0;
  private read = 0;
  private readonly origin = new Origin();
  private readonly positions = new Growable(Float32Array);
  private indices: Growable<Uint32Array> | undefined;
  private colors: Growable<Uint16Array> | undefined;
  private weld: TripleIndex | undefined;
  /** Materialise Magics' default color, from `COLOR=` in the header, as linear channels. */
  private defaultColor: [number, number, number, number] | undefined;
  /** The facet being read: three corners of three coordinates. */
  private readonly corners = new Float64Array(9);
  /** Facets with coordinates that aren't numbers, left out. */
  private broken = 0;

  push(chunk: Uint8Array): void {
    let data = this.pending.length > 0 ? concat(this.pending, chunk) : chunk;
    if (!this.header) {
      if (data.length < HEADER + 4) {
        this.pending = data.slice();
        return;
      }
      this.start(data);
      data = data.subarray(HEADER + 4);
    }
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const whole = Math.min(Math.floor(data.length / FACET), this.declared - this.read);
    for (let facet = 0; facet < whole; facet++) this.facet(view, facet * FACET);
    this.read += whole;
    this.pending = this.read < this.declared ? data.slice(whole * FACET) : new Uint8Array(0);
  }

  private start(data: Uint8Array): void {
    this.header = data.slice(0, HEADER);
    this.declared = new DataView(data.buffer, data.byteOffset + HEADER, 4).getUint32(0, true);
    const color = materialiseColor(this.header);
    if (color) {
      this.defaultColor = color;
      this.colors = new Growable(Uint16Array, Math.min(this.declared, 1 << 20) * 12);
    } else {
      this.weld = new TripleIndex(Math.min(this.declared, 1 << 22));
      this.indices = new Growable(Uint32Array, Math.min(this.declared, 1 << 22) * 3);
    }
    this.positions.reserve(Math.min(this.declared, 1 << 22) * 3);
  }

  private facet(view: DataView, at: number): void {
    const { origin, positions, weld } = this;
    let color = this.defaultColor;
    if (color) {
      const packed = view.getUint16(at + 48, true);
      // Bit 15 clear: the facet has a color of its own, five bits a channel.
      if ((packed & 0x8000) === 0) {
        color = [
          LINEAR_BYTES[Math.round(((packed & 0x1f) / 31) * 255)],
          LINEAR_BYTES[Math.round((((packed >> 5) & 0x1f) / 31) * 255)],
          LINEAR_BYTES[Math.round((((packed >> 10) & 0x1f) / 31) * 255)],
          65535,
        ];
      }
    }
    const corners = this.corners;
    for (let i = 0; i < 9; i++) corners[i] = view.getFloat32(at + 12 + i * 4, true);
    if (!corners.every(Number.isFinite)) {
      this.broken++;
      return;
    }
    for (let corner = 0; corner < 3; corner++) {
      const x = corners[corner * 3];
      const y = corners[corner * 3 + 1];
      const z = corners[corner * 3 + 2];
      origin.decide(x, y, z);
      if (weld) {
        const index = weld.index(bitsOf(x), bitsOf(y), bitsOf(z));
        if (weld.added) positions.push3(x - origin.x, y - origin.y, z - origin.z);
        this.indices!.push(index);
      } else {
        positions.push3(x - origin.x, y - origin.y, z - origin.z);
        const colors = this.colors!;
        colors.push3(color![0], color![1], color![2]);
        colors.push(color![3]);
      }
    }
  }

  finish(): ParsedMesh {
    const header = this.header ?? this.pending.slice(0, HEADER);
    const facts: StlFacts = {
      format: 'stl',
      encoding: 'binary',
      header: headerText(header),
      triangles: this.declared,
    };
    if (this.defaultColor) facts.colors = true;
    const positions = this.positions.take();
    const object: MeshObject = {
      parts:
        positions.length > 0
          ? [
              {
                mode: 'triangles',
                positions,
                indices: this.indices?.take(),
                colors: this.colors?.take(),
              },
            ]
          : [],
      children: [],
    };
    const problems: MeshProblem[] = [];
    if (this.read < this.declared) problems.push({ kind: 'truncated' });
    if (this.broken > 0) problems.push({ kind: 'faces', count: this.broken });
    return {
      objects: [object],
      materials: [],
      libraries: [],
      offset: this.origin.offset,
      facts,
      problems,
    };
  }
}

/** The color in a Materialise Magics header (`COLOR=` and four bytes), as linear channels. */
function materialiseColor(header: Uint8Array): [number, number, number, number] | undefined {
  for (let at = 0; at + 10 <= HEADER; at++) {
    if (
      header[at] === 0x43 && // C
      header[at + 1] === 0x4f && // O
      header[at + 2] === 0x4c && // L
      header[at + 3] === 0x4f && // O
      header[at + 4] === 0x52 && // R
      header[at + 5] === 0x3d // =
    ) {
      return [
        LINEAR_BYTES[header[at + 6]],
        LINEAR_BYTES[header[at + 7]],
        LINEAR_BYTES[header[at + 8]],
        Math.round((header[at + 9] / 255) * 65535),
      ];
    }
  }
  return undefined;
}

/** A binary header as text, when it is text: printable up to its first NUL, trimmed. */
function headerText(header: Uint8Array): string | undefined {
  const end = header.indexOf(0);
  const bytes = header.subarray(0, end < 0 ? header.length : end);
  for (const byte of bytes) if (byte < 0x20 || byte > 0x7e) return undefined;
  const text = decodeText(bytes).trim();
  return text || undefined;
}

interface Solid {
  name?: string;
  positions: Growable<Float32Array>;
  indices: Growable<Uint32Array>;
  weld: TripleIndex;
}

class AsciiStl {
  private readonly cursor = new Cursor();
  private readonly lines = new LineSplitter((bytes, start, end) => this.line(bytes, start, end));
  private readonly origin = new Origin();
  private readonly solids: Solid[] = [];
  private solid: Solid | undefined;
  /** The corners of the facet being read, by index into the solid's vertices. */
  private corners: number[] = [];
  private facets = 0;
  private broken = 0;

  push(chunk: Uint8Array): void {
    this.lines.push(chunk);
  }

  private line(bytes: Uint8Array, start: number, end: number): void {
    const cursor = this.cursor.reset(bytes, start, end);
    if (cursor.keyword('vertex')) {
      const x = cursor.number();
      const y = cursor.number();
      const z = cursor.number();
      if (!Number.isFinite(x + y + z)) {
        this.corners.push(-1);
        return;
      }
      const solid = this.current();
      this.origin.decide(x, y, z);
      const index = solid.weld.index(bitsOf(x), bitsOf(y), bitsOf(z));
      if (solid.weld.added) {
        solid.positions.push3(x - this.origin.x, y - this.origin.y, z - this.origin.z);
      }
      this.corners.push(index);
    } else if (cursor.keyword('facet')) {
      // `facet normal …` starts a facet; its normal isn't kept.
      this.endFacet();
    } else if (cursor.keyword('endloop') || cursor.keyword('endfacet')) {
      this.endFacet();
    } else if (cursor.keyword('solid')) {
      this.endFacet();
      this.solid = undefined;
      this.current(cursor.rest() || undefined);
    } else if (cursor.keyword('endsolid')) {
      this.endFacet();
      this.solid = undefined;
    }
  }

  /** The solid being read, started here when facets come before any `solid`. */
  private current(name?: string): Solid {
    if (!this.solid) {
      this.solid = {
        name,
        positions: new Growable(Float32Array),
        indices: new Growable(Uint32Array),
        weld: new TripleIndex(),
      };
      this.solids.push(this.solid);
    }
    return this.solid;
  }

  private endFacet(): void {
    const corners = this.corners;
    if (corners.length === 0) return;
    this.corners = [];
    this.facets++;
    if (corners.length < 3 || corners.includes(-1)) {
      this.broken++;
      return;
    }
    const indices = this.current().indices;
    // A loop of more than three vertices isn't standard; it is drawn as a fan.
    for (let i = 1; i + 1 < corners.length; i++)
      indices.push3(corners[0], corners[i], corners[i + 1]);
  }

  finish(): ParsedMesh {
    this.lines.finish();
    this.endFacet();
    if (this.solids.length === 0) throw new MeshFormatError('No solid in this STL file');
    const objects: MeshObject[] = this.solids.map((solid) => {
      const positions = solid.positions.take();
      const indices = solid.indices.take();
      return {
        name: solid.name,
        parts: indices.length > 0 ? [{ mode: 'triangles', positions, indices }] : [],
        children: [],
      };
    });
    const facts: StlFacts = {
      format: 'stl',
      encoding: 'ascii',
      solids: this.solids.map((solid) => solid.name ?? ''),
      triangles: this.facets,
    };
    return {
      objects,
      materials: [],
      libraries: [],
      offset: this.origin.offset,
      facts,
      problems: this.broken > 0 ? [{ kind: 'faces', count: this.broken }] : [],
    };
  }
}
