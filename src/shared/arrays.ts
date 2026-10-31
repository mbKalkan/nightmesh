// Arrays that grow as a file is read, and a table that gives each distinct vertex one index.

type TypedArray = Float32Array | Float64Array | Uint32Array | Int32Array | Uint16Array;
type TypedArrayConstructor<T extends TypedArray> = new (length: number) => T;

/** A typed array that doubles when it fills; `view()` is what has been written. */
export class Growable<T extends TypedArray> {
  array: T;
  length = 0;

  constructor(
    private readonly type: TypedArrayConstructor<T>,
    capacity = 1024,
  ) {
    this.array = new type(Math.max(16, capacity));
  }

  /** Makes room for `count` more values. */
  reserve(count: number): void {
    const needed = this.length + count;
    if (needed <= this.array.length) return;
    let capacity = this.array.length * 2;
    while (capacity < needed) capacity *= 2;
    const grown = new this.type(capacity);
    grown.set(this.array.subarray(0, this.length) as never);
    this.array = grown;
  }

  push(value: number): void {
    if (this.length === this.array.length) this.reserve(1);
    this.array[this.length++] = value;
  }

  push3(a: number, b: number, c: number): void {
    if (this.length + 3 > this.array.length) this.reserve(3);
    const { array } = this;
    array[this.length] = a;
    array[this.length + 1] = b;
    array[this.length + 2] = c;
    this.length += 3;
  }

  /** The values written so far, in an array of their own and exactly their length. */
  take(): T {
    const taken =
      this.length === this.array.length ? this.array : (this.array.slice(0, this.length) as T);
    this.array = new this.type(16);
    this.length = 0;
    return taken;
  }
}

const EMPTY = -1;

/**
 * Gives each distinct triple of 32-bit values an index, in the order they are first seen: the
 * vertex a corner of a face becomes, made of its position, texture and normal indices, or of the
 * bits of its coordinates.
 */
export class TripleIndex {
  private keys: Uint32Array;
  private slots: Int32Array;
  private mask: number;
  size = 0;
  /** Whether the last `index` call saw its triple for the first time. */
  added = false;

  constructor(expected = 1024) {
    let capacity = 16;
    while (capacity < expected * 2) capacity *= 2;
    this.slots = new Int32Array(capacity).fill(EMPTY);
    this.keys = new Uint32Array(capacity * 3);
    this.mask = capacity - 1;
  }

  /** The index of `a, b, c`, the next free one if it is new. */
  index(a: number, b: number, c: number): number {
    if (this.size * 2 >= this.slots.length) this.grow();
    const { slots, keys, mask } = this;
    let slot = hash(a, b, c) & mask;
    for (;;) {
      const found = slots[slot];
      if (found === EMPTY) break;
      const key = slot * 3;
      if (keys[key] === a >>> 0 && keys[key + 1] === b >>> 0 && keys[key + 2] === c >>> 0) {
        this.added = false;
        return found;
      }
      slot = (slot + 1) & mask;
    }
    const key = slot * 3;
    keys[key] = a;
    keys[key + 1] = b;
    keys[key + 2] = c;
    slots[slot] = this.size;
    this.added = true;
    return this.size++;
  }

  private grow(): void {
    const { slots, keys } = this;
    const capacity = slots.length * 2;
    this.slots = new Int32Array(capacity).fill(EMPTY);
    this.keys = new Uint32Array(capacity * 3);
    this.mask = capacity - 1;
    for (let slot = 0; slot < slots.length; slot++) {
      const value = slots[slot];
      if (value === EMPTY) continue;
      const a = keys[slot * 3];
      const b = keys[slot * 3 + 1];
      const c = keys[slot * 3 + 2];
      let to = hash(a, b, c) & this.mask;
      while (this.slots[to] !== EMPTY) to = (to + 1) & this.mask;
      this.slots[to] = value;
      this.keys[to * 3] = a;
      this.keys[to * 3 + 1] = b;
      this.keys[to * 3 + 2] = c;
    }
  }
}

function hash(a: number, b: number, c: number): number {
  let h = Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca77) ^ Math.imul(c, 0xc2b2ae3d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  return (h ^ (h >>> 12)) >>> 0;
}

const floatBits = new Float32Array(1);
const floatWord = new Uint32Array(floatBits.buffer);

/** The bits of a 32-bit float, to tell vertices apart by exactly what the file holds. */
export function bitsOf(value: number): number {
  floatBits[0] = value;
  // -0 and 0 are the same place.
  return floatWord[0] === 0x80000000 ? 0 : floatWord[0];
}
