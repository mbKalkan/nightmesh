// An OBJ, STL or PLY file as glTF, so it goes the way a glTF model does: JSON for the panels and
// the loader, a buffer per array for the bytes. The top node is the file; the viewer sets its
// scale and rotation from the units and up axis the user picks.
import type { Gltf } from '../plan';
import type { MeshObject, MeshPart, ParsedMesh } from './geometry';

/** A material as glTF has it: factors linear, textures by image index. */
export interface MaterialSpec {
  name: string;
  baseColor: [number, number, number, number];
  metallic: number;
  roughness: number;
  emissive?: [number, number, number];
  baseColorTexture?: number;
  emissiveTexture?: number;
  normalTexture?: number;
}

const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const MODES = { points: 0, lines: 1, triangles: 4 } as const;

/** The glTF JSON a file is shown as, and its buffers by index. */
export interface MeshGltf {
  json: Gltf & Record<string, unknown>;
  buffers: Uint8Array[];
}

/**
 * @param materials one for each of `mesh.materials`, in order
 * @param images URIs of the images the materials use, relative to the model
 */
export function toGltf(
  mesh: ParsedMesh,
  fileName: string,
  materials: readonly MaterialSpec[],
  images: readonly string[],
): MeshGltf {
  const nodes: Record<string, unknown>[] = [];
  const meshes: Record<string, unknown>[] = [];
  const accessors: Record<string, unknown>[] = [];
  const bufferViews: {
    buffer: number;
    byteLength: number;
    byteStride?: number;
    target?: number;
  }[] = [];
  const buffers: Uint8Array[] = [];

  const view = (data: ArrayBufferView, target: number, byteStride?: number): number => {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    buffers.push(bytes);
    const entry: (typeof bufferViews)[number] = {
      buffer: buffers.length - 1,
      byteLength: bytes.length,
      target,
    };
    if (byteStride) entry.byteStride = byteStride;
    return bufferViews.push(entry) - 1;
  };

  const accessor = (fields: Record<string, unknown>) => accessors.push(fields) - 1;

  const primitive = (part: MeshPart): Record<string, unknown> | undefined => {
    const count = part.positions.length / 3;
    if (count === 0) return undefined;
    const attributes: Record<string, number> = {
      POSITION: accessor({
        bufferView: view(part.positions, ARRAY_BUFFER),
        componentType: FLOAT,
        count,
        type: 'VEC3',
        ...bounds(part.positions),
      }),
    };
    if (part.normals) {
      attributes.NORMAL = accessor({
        bufferView: view(part.normals, ARRAY_BUFFER),
        componentType: FLOAT,
        count,
        type: 'VEC3',
      });
    }
    if (part.uvs) {
      attributes.TEXCOORD_0 = accessor({
        bufferView: view(part.uvs, ARRAY_BUFFER),
        componentType: FLOAT,
        count,
        type: 'VEC2',
      });
    }
    if (part.colors) {
      // Four channels a vertex either way: without alpha, the fourth is padding, as glTF wants
      // each vertex's color to start on four bytes.
      attributes.COLOR_0 = accessor({
        bufferView: view(part.colors, ARRAY_BUFFER, part.alpha ? undefined : 8),
        componentType: UNSIGNED_SHORT,
        normalized: true,
        count,
        type: part.alpha ? 'VEC4' : 'VEC3',
      });
    }
    const result: Record<string, unknown> = { attributes, mode: MODES[part.mode] };
    if (part.indices) {
      const indices = narrowIndices(part.indices, count);
      result.indices = accessor({
        bufferView: view(indices, ELEMENT_ARRAY_BUFFER),
        componentType: indices instanceof Uint16Array ? UNSIGNED_SHORT : UNSIGNED_INT,
        count: indices.length,
        type: 'SCALAR',
      });
    }
    if (part.material !== undefined && part.material < materials.length) {
      result.material = part.material;
    }
    return result;
  };

  const meshOf = (object: MeshObject): number | undefined => {
    const primitives = object.parts
      .map(primitive)
      .filter((value): value is Record<string, unknown> => value !== undefined);
    if (primitives.length === 0) return undefined;
    const entry: Record<string, unknown> = { primitives };
    if (object.name) entry.name = object.name;
    return meshes.push(entry) - 1;
  };

  /** A node for `object` and its children; `translation` moves geometry back where it was. */
  const nodeOf = (object: MeshObject, translation?: [number, number, number]): number => {
    const node: Record<string, unknown> = {};
    const index = nodes.push(node) - 1;
    if (object.name) node.name = object.name;
    if (translation) node.translation = translation;
    const meshIndex = meshOf(object);
    if (meshIndex !== undefined) node.mesh = meshIndex;
    const children = object.children.map((child) => nodeOf(child));
    if (children.length > 0) node.children = children;
    return index;
  };

  const root: Record<string, unknown> = { name: fileName };
  nodes.push(root);
  const { objects, offset } = mesh;
  // A single object without children is drawn by the file's node itself: one level less to
  // open in the tree. Geometry moved to the origin keeps a node of its own to move it back.
  if (objects.length === 1 && objects[0].children.length === 0 && !offset) {
    const meshIndex = meshOf(objects[0]);
    if (meshIndex !== undefined) root.mesh = meshIndex;
  } else {
    const children = objects.map((object) => nodeOf(object, offset));
    if (children.length > 0) root.children = children;
  }

  const json: MeshGltf['json'] = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: nodes as Gltf['nodes'],
  };
  if (meshes.length > 0) json.meshes = meshes as unknown as Gltf['meshes'];
  if (accessors.length > 0) json.accessors = accessors as Gltf['accessors'];
  if (bufferViews.length > 0) {
    json.bufferViews = bufferViews;
    json.buffers = buffers.map((bytes) => ({ byteLength: bytes.length }));
  }
  if (materials.length > 0) json.materials = materials.map(material);
  if (images.length > 0) {
    json.images = images.map((uri) => ({ uri }));
    json.textures = images.map((_, source) => ({ source }));
  }
  return { json, buffers };
}

function material(spec: MaterialSpec): Record<string, unknown> {
  const pbr: Record<string, unknown> = {
    baseColorFactor: spec.baseColor.map(round),
    metallicFactor: round(spec.metallic),
    roughnessFactor: round(spec.roughness),
  };
  if (spec.baseColorTexture !== undefined) pbr.baseColorTexture = { index: spec.baseColorTexture };
  const result: Record<string, unknown> = { name: spec.name, pbrMetallicRoughness: pbr };
  if (spec.emissive && spec.emissive.some((value) => value > 0)) {
    result.emissiveFactor = spec.emissive.map(round);
  }
  if (spec.emissiveTexture !== undefined) {
    result.emissiveTexture = { index: spec.emissiveTexture };
    result.emissiveFactor ??= [1, 1, 1];
  }
  if (spec.normalTexture !== undefined) result.normalTexture = { index: spec.normalTexture };
  if (spec.baseColor[3] < 1) result.alphaMode = 'BLEND';
  // The formats don't say which side of a face is the front: both are drawn.
  result.doubleSided = true;
  return result;
}

/** Six significant digits, as the inspector shows them: 0.214041 rather than 0.21404114. */
const round = (value: number) => Number(value.toPrecision(6));

/** The smallest and largest coordinate on each axis, as glTF requires for positions. */
function bounds(positions: Float32Array): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[i + axis];
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  if (min[0] === Infinity) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}

/** Indices in 16 bits when every one fits: half the memory. 65535 is reserved by glTF. */
function narrowIndices(indices: Uint32Array, vertices: number): Uint16Array | Uint32Array {
  return vertices <= 65535 ? Uint16Array.from(indices) : indices;
}
