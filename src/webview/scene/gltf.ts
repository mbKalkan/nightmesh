import { GLTFLoader, type GLTF, type GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { Decoders } from './modelView';

/**
 * Builds a three.js scene from glTF JSON and the parts the host sent for it. The parts go into
 * the loader's cache under the keys it looks them up by (`bufferView:3`, `buffer:5`), so it never
 * fetches anything and uses the bytes as they arrived, without copying them.
 */
export function parseModel(
  json: string,
  parts: ReadonlyMap<string, ArrayBuffer>,
  decoders: Decoders = {},
): Promise<GLTF> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  if (decoders.draco) loader.setDRACOLoader(decoders.draco);
  if (decoders.ktx2) loader.setKTX2Loader(decoders.ktx2);
  loader.register((parser) => {
    // The loader maps its objects to glTF indices in `associations`, then cuts that map down to
    // one scene each time a scene finishes loading: with two scenes, one loses its nodes. Keep
    // the full map; selection needs every node of the scene shown.
    const associations = parser.associations;
    Object.defineProperty(parser, 'associations', {
      get: () => associations,
      set: () => {},
      configurable: true,
    });
    return partsPlugin(parser, parts);
  });
  return loader.parseAsync(json, '');
}

/** Hands the host's parts to the loader through its cache. */
function partsPlugin(parser: GLTFParser, parts: ReadonlyMap<string, ArrayBuffer>) {
  return {
    name: 'nightmesh_parts',
    // The parser empties its cache when it starts; this runs right after.
    beforeRoot: async () => {
      const cache = (parser as unknown as { cache: { add(key: string, value: unknown): void } })
        .cache;
      for (const [key, data] of parts) cache.add(key, Promise.resolve(data));
    },
  };
}
