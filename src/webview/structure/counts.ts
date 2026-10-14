import { isObject, num, objects, type GltfModel, type JsonObject } from './gltf';

/** What a primitive draws: its vertices, and its triangles, lines or points. */
export interface PrimitiveCounts {
  vertices: number;
  elements: number;
  shape: 'triangles' | 'lines' | 'points';
}

/** Totals for a mesh: all its primitives, by what they draw. */
export interface MeshCounts {
  primitives: number;
  vertices: number;
  triangles: number;
  lines: number;
  points: number;
  materials: number[];
}

export function accessorCount(model: GltfModel, ref: unknown): number {
  return num(model.item('accessors', model.ref('accessors', ref))?.count) ?? 0;
}

export function primitiveCounts(model: GltfModel, primitive: JsonObject): PrimitiveCounts {
  const attributes = isObject(primitive.attributes) ? primitive.attributes : {};
  const vertices = accessorCount(model, attributes.POSITION);
  const indices = model.ref('accessors', primitive.indices);
  const count = indices !== undefined ? accessorCount(model, indices) : vertices;
  const mode = num(primitive.mode) ?? 4;
  // POINTS, LINES, LINE_LOOP, LINE_STRIP, TRIANGLES, TRIANGLE_STRIP, TRIANGLE_FAN
  const elements = [
    count,
    Math.floor(count / 2),
    count,
    Math.max(0, count - 1),
    Math.floor(count / 3),
    Math.max(0, count - 2),
    Math.max(0, count - 2),
  ][mode];
  return {
    vertices,
    elements: elements ?? 0,
    shape: mode >= 4 ? 'triangles' : mode >= 1 ? 'lines' : 'points',
  };
}

export function meshCounts(model: GltfModel, mesh: number): MeshCounts {
  const primitives = objects(model.items('meshes')[mesh]?.primitives);
  const totals: MeshCounts = {
    primitives: primitives.length,
    vertices: 0,
    triangles: 0,
    lines: 0,
    points: 0,
    materials: [],
  };
  for (const primitive of primitives) {
    const counts = primitiveCounts(model, primitive);
    totals.vertices += counts.vertices;
    totals[counts.shape] += counts.elements;
    const material = model.ref('materials', primitive.material);
    if (material !== undefined && !totals.materials.includes(material)) {
      totals.materials.push(material);
    }
  }
  return totals;
}
