// The glTF Validator's thread: validating a large model takes seconds, which would hold up every
// extension in the extension host. Resources are read by the extension, which knows which ones
// the model may use.
import { parentPort } from 'node:worker_threads';
import { runValidator } from './model/validator';
import type { ValidatorRequest, ValidatorResponse } from './workerValidator';

const port = parentPort!;
const pending = new Map<
  number,
  { resolve(data: Uint8Array): void; reject(reason: string): void }
>();
let nextId = 0;

const send = (message: ValidatorResponse, transfer: ArrayBuffer[] = []) =>
  port.postMessage(message, transfer);

port.on('message', (message: ValidatorRequest) => {
  if (message.type === 'resource') {
    const request = pending.get(message.id);
    pending.delete(message.id);
    if ('data' in message) request?.resolve(message.data);
    else request?.reject(message.reason);
    return;
  }
  runValidator(
    message.data,
    (uri) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        send({ type: 'resource', id, uri });
      }),
  ).then(
    (report) => send({ type: 'report', report }),
    () => send({ type: 'failed' }),
  );
});
