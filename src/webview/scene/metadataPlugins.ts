// glTF loader plugins for EXT_mesh_features and EXT_structural_metadata, from the 3D Tiles
// renderer: they give each primitive its feature ID sets and metadata, which a click reads.
// Loaded only for a model that uses them.
import { GLTFMeshFeaturesExtension } from '3d-tiles-renderer/src/three/plugins/gltf/GLTFMeshFeaturesExtension.js';
import { GLTFStructuralMetadataExtension } from '3d-tiles-renderer/src/three/plugins/gltf/GLTFStructuralMetadataExtension.js';
import type { GLTFLoaderPlugin, GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';

type Plugin = new (parser: GLTFParser) => GLTFLoaderPlugin;

/**
 * The plugin, made to leave its metadata out when it can't read it: it reads the file's metadata
 * as it is, and would otherwise fail the whole model on a damaged table or index.
 */
export function forgiving(plugin: GLTFLoaderPlugin): GLTFLoaderPlugin {
  const afterRoot = plugin.afterRoot?.bind(plugin);
  if (afterRoot) {
    plugin.afterRoot = async (result) => {
      try {
        await afterRoot(result);
      } catch {
        // The model is drawn; what it says of its features isn't shown.
      }
    };
  }
  return plugin;
}

export const metadataPlugins: ((parser: GLTFParser) => GLTFLoaderPlugin)[] = [
  (parser) => forgiving(new (GLTFMeshFeaturesExtension as unknown as Plugin)(parser)),
  (parser) => forgiving(new (GLTFStructuralMetadataExtension as unknown as Plugin)(parser)),
];
