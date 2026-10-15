import { Worker } from 'node:worker_threads';
import type { Validator, ValidatorReport } from './model/validation';

/** From the extension to the validator's thread. */
export type ValidatorRequest =
  | { type: 'validate'; data: Uint8Array }
  | ({ type: 'resource'; id: number } & ({ data: Uint8Array } | { reason: string }));

/** From the validator's thread back. */
export type ValidatorResponse =
  | { type: 'resource'; id: number; uri: string }
  | { type: 'report'; report: ValidatorReport }
  | { type: 'failed' };

/**
 * Runs each validation in a thread of its own, from the bundled `script`. `stop` ends the one
 * running: its promise rejects, and its file can be closed.
 */
export function workerValidator(script: string): { validate: Validator; stop(): void } {
  let stopCurrent: (() => void) | undefined;
  const validate: Validator = (data, resource) =>
    new Promise((resolve, reject) => {
      const worker = new Worker(script);
      const post = (message: ValidatorRequest, transfer: ArrayBuffer[] = []) =>
        worker.postMessage(message, transfer);
      const end = (settle: () => void) => {
        if (stopCurrent === stop) stopCurrent = undefined;
        void worker.terminate();
        settle();
      };
      const stop = () => end(() => reject(new Error('Stopped')));
      stopCurrent = stop;
      worker.on('message', (message: ValidatorResponse) => {
        if (message.type === 'resource') {
          resource(message.uri).then(
            (bytes) => post({ type: 'resource', id: message.id, data: bytes }, transferable(bytes)),
            (reason: unknown) => post({ type: 'resource', id: message.id, reason: String(reason) }),
          );
        } else if (message.type === 'report') {
          end(() => resolve(message.report));
        } else {
          end(() => reject(new Error('The validator failed')));
        }
      });
      worker.on('error', (error) => end(() => reject(error)));
      // The model's bytes move to the thread rather than being copied.
      post({ type: 'validate', data }, transferable(data));
    });
  return { validate, stop: () => stopCurrent?.() };
}

/** A buffer that can be handed over whole: one the bytes have to themselves. */
function transferable(bytes: Uint8Array): ArrayBuffer[] {
  const { buffer } = bytes;
  return buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === buffer.byteLength
    ? [buffer]
    : [];
}
