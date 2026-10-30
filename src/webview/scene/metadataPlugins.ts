// glTF loader plugins for EXT_mesh_features and EXT_structural_metadata, from the 3D Tiles
// renderer: they give each primitive its feature ID sets and metadata, which a click reads.
// Loaded only for a model that uses them.
import { GLTFMeshFeaturesExtension } from '3d-tiles-renderer/src/three/plugins/gltf/GLTFMeshFeaturesExtension.js';
import { GLTFStructuralMetadataExtension } from '3d-tiles-renderer/src/three/plugins/gltf/GLTFStructuralMetadataExtension.js';
import type { GLTFLoaderPlugin, GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';

type Plugin = new (parser: GLTFParser) => GLTFLoaderPlugin;

export const metadataPlugins: ((parser: GLTFParser) => GLTFLoaderPlugin)[] = [
  (parser) => new (GLTFMeshFeaturesExtension as unknown as Plugin)(parser),
  (parser) => new (GLTFStructuralMetadataExtension as unknown as Plugin)(parser),
];
