import { open } from 'node:fs/promises';

/** Random access to the bytes of a file or of a block of memory. */
export interface ByteSource {
  readonly size: number;
  /** Reads into a new buffer of its own, which can be posted to the webview as it is. */
  read(offset: number, length: number): Promise<Uint8Array>;
  close(): Promise<void>;
}

function checkRange(source: ByteSource, offset: number, length: number): void {
  if (!(offset >= 0 && length >= 0 && offset + length <= source.size)) {
    throw new RangeError(`Read of ${length} bytes at ${offset} is outside ${source.size} bytes`);
  }
}

export function memorySource(bytes: Uint8Array): ByteSource {
  const source: ByteSource = {
    size: bytes.length,
    read: async (offset, length) => {
      checkRange(source, offset, length);
      return bytes.slice(offset, offset + length);
    },
    close: async () => {},
  };
  return source;
}

/** Reads a local file in place, so a large model is never held in memory as a whole. */
export async function fileSource(path: string): Promise<ByteSource> {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    const source: ByteSource = {
      size,
      read: async (offset, length) => {
        checkRange(source, offset, length);
        const bytes = new Uint8Array(length);
        for (let done = 0; done < length;) {
          const { bytesRead } = await handle.read(bytes, done, length - done, offset + done);
          if (bytesRead === 0) throw new Error('The file got shorter while it was being read');
          done += bytesRead;
        }
        return bytes;
      },
      close: () => handle.close(),
    };
    return source;
  } catch (error) {
    await handle.close();
    throw error;
  }
}
