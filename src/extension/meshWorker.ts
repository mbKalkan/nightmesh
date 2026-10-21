// The thread that reads OBJ, STL and PLY files: a large one takes seconds, which would hold up
// every extension in the extension host. The extension sends the file in pieces as asked.
import { parentPort } from 'node:worker_threads';
import type { MeshReader } from './model/mesh/geometry';
import { MeshFormatError } from './model/mesh/geometry';
import { createReader, meshBuffers } from './model/mesh/parse';
import type { MeshRequest, MeshResponse } from './workerMesh';

const port = parentPort!;
let reader: MeshReader | undefined;

const send = (message: MeshResponse, transfer: ArrayBuffer[] = []) =>
  port.postMessage(message, transfer);

port.on('message', (message: MeshRequest) => {
  try {
    if (message.type === 'start') {
      reader = createReader(message.format, message.size);
      send({ type: 'next' });
    } else if (message.type === 'chunk') {
      reader!.push(message.data);
      send({ type: 'next' });
    } else {
      const mesh = reader!.finish();
      // The arrays move to the extension rather than being copied.
      send({ type: 'done', mesh }, meshBuffers(mesh));
    }
  } catch (error) {
    send({
      type: 'failed',
      format: error instanceof MeshFormatError,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
