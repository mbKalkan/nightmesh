// The 3D Tiles renderer's metadata classes, which the tests build primitives' metadata with: the
// renderer declares them beside its glTF plugins, not in their own files.
declare module '3d-tiles-renderer/src/three/plugins/gltf/metadata/classes/StructuralMetadata.js' {
  export { StructuralMetadata } from '3d-tiles-renderer/src/three/plugins/gltf/GLTFStructuralMetadataExtension.js';
}

declare module '3d-tiles-renderer/src/three/plugins/gltf/metadata/classes/MeshFeatures.js' {
  export { MeshFeatures } from '3d-tiles-renderer/src/three/plugins/gltf/GLTFMeshFeaturesExtension.js';
}
