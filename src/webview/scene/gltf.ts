import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/**
 * Builds a three.js scene from glTF JSON and the parts the host sent for it. The parts go into
 * the loader's cache under the keys it looks them up by (`bufferView:3`, `buffer:5`), so it never
 * fetches anything and uses the bytes as they arrived, without copying them.
 */
export function parseModel(json: string, parts: ReadonlyMap<string, ArrayBuffer>): Promise<GLTF> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  loader.register((parser) => ({
    name: 'nightmesh_parts',
    // The parser empties its cache when it starts; this runs right after.
    beforeRoot: async () => {
      const cache = (parser as unknown as { cache: { add(key: string, value: unknown): void } })
        .cache;
      for (const [key, data] of parts) cache.add(key, Promise.resolve(data));
    },
  }));
  return loader.parseAsync(json, '');
}
