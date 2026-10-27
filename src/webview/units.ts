// OBJ, STL and PLY files seldom say what their units are or which way is up; glTF is in metres
// with Y up. The file's node takes a scale and rotation that turn the one into the other.
import type { LengthUnit, MeshFormat, SourceFacts, Units } from '../shared/protocol';

export type { LengthUnit, UpAxis, Units } from '../shared/protocol';

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
  // 3D Tiles: metres, and a tile's own frame has Z up.
  pnts: { unit: 'm', up: 'z' },
};

/** A quarter turn about X, from Z up to Y up. */
const Z_UP_TO_Y_UP: [number, number, number, number] = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];

/** The scale and rotation (x, y, z, w) that turn a file in `units` into metres with Y up. */
export function fileTransform({ unit, up }: Units): {
  scale: number;
  rotation: [number, number, number, number];
} {
  return { scale: UNIT_METRES[unit], rotation: up === 'z' ? Z_UP_TO_Y_UP : [0, 0, 0, 1] };
}

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

/** Unit names a file's comments use, as Maya writes in every OBJ file it exports. */
const STATED_UNITS: readonly [RegExp, LengthUnit][] = [
  [/^millimet(?:er|re)s?$/i, 'mm'],
  [/^centimet(?:er|re)s?$/i, 'cm'],
  [/^met(?:er|re)s?$/i, 'm'],
  [/^inch(?:es)?$/i, 'in'],
  [/^(?:feet|foot)$/i, 'ft'],
];

/**
 * The unit an OBJ file says it is in: "This file uses centimeters as units for non-parametric
 * coordinates." in Maya's export. Undefined when it doesn't say.
 */
export function statedUnit(source: SourceFacts | undefined): LengthUnit | undefined {
  if (source?.format !== 'obj') return undefined;
  for (const comment of source.comments) {
    const named = /\buses\s+(\w+)\s+as\s+units\b/i.exec(comment)?.[1];
    const found = named && STATED_UNITS.find(([pattern]) => pattern.test(named));
    if (found) return found[1];
  }
  return undefined;
}

/**
 * glTF made from an OBJ, STL or PLY file, with its top node scaled to metres and turned to Y up.
 * `drawn` leaves out where far-away geometry was moved from, so it is drawn around the origin,
 * where 32-bit floats are precise; the panels keep the file's coordinates. The JSON comes back as
 * it was when it has no such node.
 */
export function withUnits(json: string, units: Units, drawn = false): string {
  let gltf: MeshGltf;
  try {
    gltf = JSON.parse(json) as MeshGltf;
  } catch {
    return json;
  }
  const { file, moved } = fileNodes(gltf);
  if (!file) return json;
  const { scale } = fileTransform(units);
  if (scale === 1) delete file.scale;
  else file.scale = [scale, scale, scale];
  if (units.up === 'z') file.rotation = Z_UP_TO_Y_UP;
  else delete file.rotation;
  if (drawn) for (const node of moved) delete node.translation;
  return JSON.stringify(gltf);
}
