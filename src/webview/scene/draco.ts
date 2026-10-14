// Loaded only for models that use Draco mesh compression.
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import wrapper from 'inline-text:three/examples/jsm/libs/draco/draco_wasm_wrapper.js';
import wasm from 'inline-binary:three/examples/jsm/libs/draco/draco_decoder.wasm';
import { blobUrl } from './decoders';

/** Decodes in workers started from blob: URLs, with the decoder that ships with the extension. */
export function createDracoLoader(): DRACOLoader {
  return new DRACOLoader().setDecoderPath({
    js: blobUrl(wrapper, 'text/javascript'),
    wasm: blobUrl(wasm, 'application/wasm'),
  } as unknown as string);
}
