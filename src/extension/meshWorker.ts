// The thread that reads OBJ, STL and PLY files: a large one takes seconds, which would hold up
// every extension in the extension host. The extension sends the file in pieces as asked.
import { parentPort } from 'node:worker_threads';
import type { MeshReader } from './model/mesh/geometry';
import { MeshFormatError } from './model/mesh/geometry';
import { checkMesh, trianglesOf } from './model/mesh/check';
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
      reader = undefined;
      // The check comes after the mesh, from a copy of its triangles, so the model shows first.
      const triangles = trianglesOf(mesh).map(({ positions, indices }) => ({
        positions: positions.slice(),
        indices: indices?.slice(),
      }));
      // The arrays move to the extension rather than being copied.
      send({ type: 'done', mesh }, meshBuffers(mesh));
      send({ type: 'check', check: checkMesh(triangles) });
    }
  } catch (error) {
    send({
      type: 'failed',
      format: error instanceof MeshFormatError,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
