// Reads accessor values from a model's binary data in the extension host, for what the structure
// shows before the view draws: whether animations move, where instances are.
import type { Gltf, Part } from './plan';

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** Component types: their size in bytes, and the largest value of normalized integers. */
const TYPES: Record<
  number,
  { size: number; read: (view: DataView, at: number) => number; max: number }
> = {
  5120: { size: 1, read: (view, at) => view.getInt8(at), max: 127 },
  5121: { size: 1, read: (view, at) => view.getUint8(at), max: 255 },
  5122: { size: 2, read: (view, at) => view.getInt16(at, true), max: 32767 },
  5123: { size: 2, read: (view, at) => view.getUint16(at, true), max: 65535 },
  5125: { size: 4, read: (view, at) => view.getUint32(at, true), max: 1 },
  5126: { size: 4, read: (view, at) => view.getFloat32(at, true), max: 1 },
};

export interface Accessor {
  bufferView?: number;
  byteOffset?: number;
  componentType?: number;
  normalized?: boolean;
  count?: number;
  type?: string;
  sparse?: unknown;
  min?: number[];
  max?: number[];
}

/**
 * Reads accessors from a render plan's parts, all reads together within `budget` bytes. An
 * accessor is undefined when it can't be read here: sparse, compressed (its bytes are then a
 * buffer the loader decodes, not a bufferView), out of its bufferView, or past the budget.
 */
export class AccessorReader {
  private readonly parts: Map<string, Part>;

  constructor(
    private readonly json: Gltf & { accessors?: Accessor[] },
    parts: readonly Part[],
    private budget: number,
  ) {
    this.parts = new Map(parts.map((part) => [part.key, part]));
  }

  accessor(index: number | undefined): Accessor | undefined {
    return index === undefined ? undefined : this.json.accessors?.[index];
  }

  /** The accessor's values, components of each element in turn; normalized ones from -1 to 1. */
  async read(index: number | undefined): Promise<number[] | undefined> {
    const accessor = this.accessor(index);
    const type = TYPES[accessor?.componentType ?? 0];
    const components = COMPONENTS[accessor?.type ?? ''];
    const count = accessor?.count;
    if (!accessor || !type || !components || !Number.isInteger(count) || accessor.sparse)
      return undefined;
    const part = this.parts.get(`bufferView:${accessor.bufferView}`);
    const stride =
      (this.json.bufferViews?.[accessor.bufferView ?? -1] as { byteStride?: number } | undefined)
        ?.byteStride ?? components * type.size;
    const length = (count! - 1) * stride + components * type.size;
    const offset = accessor.byteOffset ?? 0;
    if (!part || count! < 1 || offset < 0 || offset + length > part.length || length > this.budget)
      return undefined;
    this.budget -= length;
    const bytes = await part.source.read(part.offset + offset, length);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const values: number[] = [];
    for (let item = 0; item < count!; item++) {
      for (let component = 0; component < components; component++) {
        const raw = type.read(view, item * stride + component * type.size);
        values.push(accessor.normalized ? Math.max(raw / type.max, -1) : raw);
      }
    }
    return values;
  }
}

/** Largest value of each normalized integer component type, to scale `min` and `max` back. */
export function normalizedMax(accessor: Accessor): number {
  return accessor.normalized === true ? (TYPES[accessor.componentType ?? 0]?.max ?? 1) : 1;
}
