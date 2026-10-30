const TYPES = { Float32Array, Float64Array, Uint16Array };

/**
 * Runs `read` as if memory were short: typed arrays of more than `limit` bytes can't be made.
 * Tells a reader that makes room for what a damaged count says, before it finds the values, from
 * one that doesn't, without the test asking for gigabytes.
 */
export async function withMemory<T>(limit: number, read: () => T | Promise<T>): Promise<T> {
  for (const [name, Type] of Object.entries(TYPES)) {
    const short = new Proxy(Type, {
      construct(target, args: unknown[]) {
        if (typeof args[0] === 'number' && args[0] * Type.BYTES_PER_ELEMENT > limit) {
          throw new RangeError('Array buffer allocation failed');
        }
        return Reflect.construct(target, args) as object;
      },
    });
    Object.assign(globalThis, { [name]: short });
  }
  try {
    return await read();
  } finally {
    Object.assign(globalThis, TYPES);
  }
}
