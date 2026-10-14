// Loaded only for models with KTX2 (Basis Universal) textures.
import { LoadingManager, type WebGLRenderer } from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import transcoder from 'inline-text:three/examples/jsm/libs/basis/basis_transcoder.js';
import wasm from 'inline-binary:three/examples/jsm/libs/basis/basis_transcoder.wasm';
import { blobUrl } from './decoders';

/** Prefix of the transcoder's file names, which the loading manager maps to blob: URLs. */
const PATH = 'nightmesh-basis/';

/** Transcodes to a format the GPU behind `renderer` supports, in workers, offline. */
export function createKtx2Loader(renderer: WebGLRenderer): KTX2Loader {
  const files: Record<string, string> = {
    [`${PATH}basis_transcoder.js`]: blobUrl(transcoder, 'text/javascript'),
    [`${PATH}basis_transcoder.wasm`]: blobUrl(wasm, 'application/wasm'),
  };
  const manager = new LoadingManager();
  manager.setURLModifier((url) => files[url] ?? url);
  return new KTX2Loader(manager).setTranscoderPath(PATH).detectSupport(renderer);
}
