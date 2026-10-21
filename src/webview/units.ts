// OBJ, STL and PLY files don't say what their units are or which way is up; glTF is in metres
// with Y up. The file's node takes a scale and rotation that turn the one into the other.
import type { MeshFormat } from '../shared/protocol';

export type LengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';
export type UpAxis = 'y' | 'z';

export interface Units {
  unit: LengthUnit;
  up: UpAxis;
}

/** Metres in each unit. */
export const UNIT_METRES: Readonly<Record<LengthUnit, number>> = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  in: 0.0254,
  ft: 0.3048,
};

/**
 * What each format most often is: STL comes from CAD and 3D printing, in millimetres with Z up;
 * OBJ from modelling tools, PLY from scanning, in metres with Y up, as Blender writes both.
 */
export const DEFAULT_UNITS: Readonly<Record<MeshFormat, Units>> = {
  stl: { unit: 'mm', up: 'z' },
  obj: { unit: 'm', up: 'y' },
  ply: { unit: 'm', up: 'y' },
};

/** A quarter turn about X, from Z up to Y up. */
const Z_UP_TO_Y_UP = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];

type MeshGltf = { scenes?: { nodes?: number[] }[]; nodes?: Record<string, unknown>[] };

/** The file's node, and the nodes below it that move geometry back to coordinates far away. */
function fileNodes(gltf: MeshGltf) {
  const file = gltf.nodes?.[gltf.scenes?.[0]?.nodes?.[0] ?? -1];
  const children = Array.isArray(file?.children) ? (file.children as number[]) : [];
  // The formats have no transforms of their own: a translation is where the reader moved the
  // geometry from.
  const moved = children
    .map((index) => gltf.nodes?.[index])
    .filter((node): node is Record<string, unknown> => Array.isArray(node?.translation));
  return { file, moved };
}

/**
 * The units a file is most likely in: its format's, but with Z up for coordinates hundreds of
 * kilometres from the origin, as georeferenced scans have, whose third axis is height.
 */
export function unitsFor(format: MeshFormat, json: string): Units {
  const units = DEFAULT_UNITS[format];
  try {
    return fileNodes(JSON.parse(json) as MeshGltf).moved.length > 0 ? { ...units, up: 'z' } : units;
  } catch {
    return units;
  }
}

/**
 * glTF made from an OBJ, STL or PLY file, with its top node scaled to metres and turned to Y up.
 * `drawn` leaves out where far-away geometry was moved from, so it is drawn around the origin,
 * where 32-bit floats are precise; the panels keep the file's coordinates. The JSON comes back as
 * it was when it has no such node.
 */
export function withUnits(json: string, { unit, up }: Units, drawn = false): string {
  let gltf: MeshGltf;
  try {
    gltf = JSON.parse(json) as MeshGltf;
  } catch {
    return json;
  }
  const { file, moved } = fileNodes(gltf);
  if (!file) return json;
  const scale = UNIT_METRES[unit];
  if (scale === 1) delete file.scale;
  else file.scale = [scale, scale, scale];
  if (up === 'z') file.rotation = Z_UP_TO_Y_UP;
  else delete file.rotation;
  if (drawn) for (const node of moved) delete node.translation;
  return JSON.stringify(gltf);
}
