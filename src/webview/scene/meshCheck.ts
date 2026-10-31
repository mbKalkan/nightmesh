// The meshes of a glTF model for the mesh check, as three.js read them: decompressed and
// dequantized, with where their nodes put them and where each GPU instance is. They must be
// taken before the model is drawn, when its vertices leave memory (D-003); taking them only
// copies arrays, and the worker places them.
import {
  Matrix4,
  type BufferAttribute,
  type InstancedMesh,
  type InterleavedBufferAttribute,
  type Mesh,
  type Object3D,
} from 'three';
import type { MeshCheck } from '../../shared/protocol';
import type { PlacedMesh } from '../../shared/meshCheck';
import workerSource from 'worker-source:../checkWorker';
import { blobUrl } from './decoders';

/**
 * Past this many triangles, counting each instance, the model isn't checked: the check holds
 * some 80 bytes a triangle, beside the model the view draws.
 */
export const CHECK_LIMIT = 5_000_000;

/**
 * Each visible mesh of the model, with its node's place in the model and its instances';
 * undefined for a model with no triangles, or more than `limit`. A skinned mesh is taken at
 * rest, a morphed one without its targets.
 */
export function meshesForCheck(root: Object3D, limit = CHECK_LIMIT): PlacedMesh[] | undefined {
  root.updateWorldMatrix(true, true);
  const found: { mesh: Mesh; places: number }[] = [];
  let triangles = 0;
  root.traverseVisible((object) => {
    const mesh = object as Mesh & Partial<InstancedMesh>;
    if (!mesh.isMesh || !mesh.geometry.attributes.position) return;
    const places = mesh.isInstancedMesh ? mesh.count! : 1;
    const { index, attributes } = mesh.geometry;
    triangles += Math.floor((index ? index.count : attributes.position.count) / 3) * places;
    found.push({ mesh, places });
  });
  if (triangles === 0 || triangles > limit) return undefined;

  const matrix = new Matrix4();
  return found.map(({ mesh, places }) => {
    const matrices = new Float64Array(places * 16);
    for (let place = 0; place < places; place++) {
      if ((mesh as Partial<InstancedMesh>).isInstancedMesh) {
        (mesh as InstancedMesh).getMatrixAt(place, matrix);
        matrix.premultiply(mesh.matrixWorld);
      } else {
        matrix.copy(mesh.matrixWorld);
      }
      matrices.set(matrix.elements, place * 16);
    }
    const { index } = mesh.geometry;
    return {
      positions: ownPositions(mesh.geometry.attributes.position),
      indices: index ? new Uint32Array(index.array as ArrayLike<number>) : undefined,
      matrices,
    };
  });
}

/** A copy of the positions, three floats each: values as three.js draws them. */
function ownPositions(position: BufferAttribute | InterleavedBufferAttribute): Float32Array {
  const plain = position as BufferAttribute;
  const interleaved = (position as InterleavedBufferAttribute).isInterleavedBufferAttribute;
  if (!interleaved && !plain.normalized && plain.itemSize === 3) {
    if (plain.array instanceof Float32Array) return plain.array.slice(0, plain.count * 3);
  }
  // Interleaved, or integers a quantized model stores.
  const values = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    values[i * 3] = position.getX(i);
    values[i * 3 + 1] = position.getY(i);
    values[i * 3 + 2] = position.getZ(i);
  }
  return values;
}

/** The check of `meshes`, made in a worker; aborting `signal` stops it, and it then gives none. */
export function checkInWorker(
  meshes: PlacedMesh[],
  signal: AbortSignal,
): Promise<MeshCheck | undefined> {
  return new Promise((resolve) => {
    const url = blobUrl(workerSource, 'text/javascript');
    const worker = new Worker(url);
    const done = (check: MeshCheck | undefined) => {
      worker.terminate();
      URL.revokeObjectURL(url);
      signal.removeEventListener('abort', aborted);
      resolve(check);
    };
    const aborted = () => done(undefined);
    signal.addEventListener('abort', aborted);
    worker.onmessage = ({ data }: MessageEvent<MeshCheck | null>) => done(data ?? undefined);
    worker.onerror = (event) => {
      console.warn(event.message);
      done(undefined);
    };
    // The arrays were made for the check: they move to the worker rather than being copied.
    const moved = meshes.flatMap(({ positions, indices, matrices }) =>
      [positions, indices, matrices].flatMap((array) =>
        array ? [array.buffer as ArrayBuffer] : [],
      ),
    );
    worker.postMessage(meshes, moved);
  });
}
