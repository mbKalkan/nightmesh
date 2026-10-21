import { Worker } from 'node:worker_threads';
import type { MeshCheck, MeshFormat } from '../shared/protocol';
import { MeshFormatError, type ParsedMesh } from './model/mesh/geometry';
import { CHUNK, type MeshEvent, type MeshParser } from './model/mesh/parse';

/** From the extension to the reading thread. */
export type MeshRequest =
  | { type: 'start'; format: MeshFormat; size: number }
  | { type: 'chunk'; data: Uint8Array }
  | { type: 'end' };

/** From the reading thread back: `next` asks for the next piece once it has read the last. */
export type MeshResponse =
  | { type: 'next' }
  | { type: 'done'; mesh: ParsedMesh }
  | { type: 'check'; check: MeshCheck | undefined }
  | { type: 'failed'; format: boolean; message: string };

/**
 * Reads OBJ, STL and PLY files in a thread of their own, from the bundled `script`: a large file
 * takes seconds, which would hold up every extension in the extension host. The file's pieces
 * go to the thread one at a time, as it asks for them, so they never pile up in memory.
 * `stop` ends the reading under way.
 */
export function workerMeshParser(script: string): { parse: MeshParser; stop(): void } {
  let stopCurrent: (() => void) | undefined;
  const parse: MeshParser = (format, source) => ({
    [Symbol.asyncIterator]: () => {
      const worker = new Worker(script);
      const queue: (MeshEvent | Error)[] = [];
      let waiting: (() => void) | undefined;
      let finished = false;
      let offset = 0;
      const push = (event: MeshEvent | Error) => {
        queue.push(event);
        waiting?.();
      };
      const end = () => {
        finished = true;
        if (stopCurrent === stop) stopCurrent = undefined;
        void worker.terminate();
      };
      const stop = () => push(new Error('Stopped'));
      stopCurrent = stop;
      const sendNext = async () => {
        if (offset >= source.size) {
          worker.postMessage({ type: 'end' } satisfies MeshRequest);
          return;
        }
        const length = Math.min(CHUNK, source.size - offset);
        const data = await source.read(offset, length);
        offset += length;
        // The piece moves to the thread rather than being copied.
        worker.postMessage({ type: 'chunk', data } satisfies MeshRequest, [
          data.buffer as ArrayBuffer,
        ]);
      };
      worker.on('message', (message: MeshResponse) => {
        if (message.type === 'next') {
          if (offset > 0) push({ type: 'progress', done: offset });
          sendNext().catch((error: unknown) =>
            push(error instanceof Error ? error : new Error(String(error))),
          );
        } else if (message.type === 'done') {
          push({ type: 'done', mesh: message.mesh });
        } else if (message.type === 'check') {
          push({ type: 'check', check: message.check });
        } else {
          push(message.format ? new MeshFormatError(message.message) : new Error(message.message));
        }
      });
      worker.on('error', (error) => push(error));
      worker.postMessage({ type: 'start', format, size: source.size } satisfies MeshRequest);
      return {
        next: async (): Promise<IteratorResult<MeshEvent>> => {
          if (finished) return { done: true, value: undefined };
          while (queue.length === 0) await new Promise<void>((resolve) => (waiting = resolve));
          waiting = undefined;
          const event = queue.shift()!;
          if (event instanceof Error) {
            end();
            throw event;
          }
          // The check is the last the thread sends.
          if (event.type === 'check') end();
          return { done: false, value: event };
        },
        return: async (): Promise<IteratorResult<MeshEvent>> => {
          end();
          return { done: true, value: undefined };
        },
      };
    },
  });
  return { parse, stop: () => stopCurrent?.() };
}
