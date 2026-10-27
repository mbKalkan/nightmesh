// What an OBJ, STL or PLY file is read into, before it becomes glTF: objects holding parts, each
// part one glTF primitive with its vertex data in the arrays glTF will have.
import type { SourceFacts } from '../../../shared/protocol';

export type PartMode = 'triangles' | 'lines' | 'points';

/** One primitive: what it draws and its vertex data. */
export interface MeshPart {
  mode: PartMode;
  /** Three per vertex, relative to the mesh's `offset`. */
  positions: Float32Array;
  normals?: Float32Array;
  /** Two per vertex, V flipped already: glTF's origin is the top left of an image. */
  uvs?: Float32Array;
  /** Linear RGBA, four per vertex, 0 to 65535; the fourth only counts when `alpha` says so. */
  colors?: Uint16Array;
  alpha?: boolean;
  /** Corners of the triangles or ends of the lines; none when every vertex is used once. */
  indices?: Uint32Array;
  /** Index into `ParsedMesh.materials`; none when the file gives the part no material. */
  material?: number;
}

/** An object, group or solid: a glTF node with a mesh of its parts. */
export interface MeshObject {
  name?: string;
  parts: MeshPart[];
  children: MeshObject[];
}

/** Something in the file that couldn't be drawn, said to the user with how often it happened. */
export type MeshProblem =
  | { kind: 'faces'; count: number }
  | { kind: 'freeForm'; count: number }
  | { kind: 'truncated' }
  /** Geometry compressed in a way not read yet: a pnts tile's Draco points. */
  | { kind: 'compressed' };

/** A material the parts name: OBJ's `usemtl`, looked up in its libraries; PLY's texture. */
export interface MeshMaterial {
  name: string;
  /** An image the file names for it as written, relative to the file. */
  texture?: string;
}

export interface ParsedMesh {
  objects: MeshObject[];
  /** The materials the parts name, in the order of their indices. */
  materials: MeshMaterial[];
  /** OBJ's material libraries, as written. */
  libraries: string[];
  /** Where the coordinates were moved from, in the file's units, when they were far from 0. */
  offset?: [number, number, number];
  facts: SourceFacts;
  problems: MeshProblem[];
}

/** Reads a file piece by piece; `finish` once every piece has been pushed. */
export interface MeshReader {
  push(chunk: Uint8Array): void;
  finish(): ParsedMesh;
}

/** The file isn't one of its format, or can't be read as one. */
export class MeshFormatError extends Error {}

/** Coordinates past this, in the file's units, are moved closer to 0 before they become floats. */
const FAR = 1e4;

/**
 * Decides at the first vertex whether coordinates are far from the origin, as georeferenced scans
 * are: if so, every vertex is stored relative to that one, so 32-bit floats keep their precision.
 */
export class Origin {
  x = 0;
  y = 0;
  z = 0;
  decided = false;

  /** Called with each vertex until it has decided, at the first with finite coordinates. */
  decide(x: number, y: number, z: number): void {
    if (this.decided || !Number.isFinite(x + y + z)) return;
    this.decided = true;
    if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) > FAR) {
      this.x = Math.round(x);
      this.y = Math.round(y);
      this.z = Math.round(z);
    }
  }

  get offset(): [number, number, number] | undefined {
    return this.x || this.y || this.z ? [this.x, this.y, this.z] : undefined;
  }
}

/** An sRGB channel from 0 to 1 as a linear one from 0 to 65535, as glTF's colors are linear. */
export function linearChannel(srgb: number): number {
  const value = Math.min(1, Math.max(0, srgb));
  const linear = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  return Math.round(linear * 65535);
}

/** `linearChannel` for each 8-bit value. */
export const LINEAR_BYTES = Uint16Array.from({ length: 256 }, (_, value) =>
  linearChannel(value / 255),
);

/** An sRGB color channel from 0 to 1 in linear terms, as glTF's color factors are. */
export function linearFactor(srgb: number): number {
  const value = Math.min(1, Math.max(0, srgb));
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
