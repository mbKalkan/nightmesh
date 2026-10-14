/**
 * glTF extensions the viewer draws. A model that requires one that isn't listed can't be
 * shown; one that only uses it is drawn without it.
 */
export const DRAWN_EXTENSIONS: ReadonlySet<string> = new Set([
  'EXT_materials_bump',
  'EXT_mesh_gpu_instancing',
  'EXT_meshopt_compression',
  'EXT_texture_avif',
  'EXT_texture_webp',
  'KHR_draco_mesh_compression',
  'KHR_lights_punctual',
  'KHR_materials_anisotropy',
  'KHR_materials_clearcoat',
  'KHR_materials_dispersion',
  'KHR_materials_emissive_strength',
  'KHR_materials_ior',
  'KHR_materials_iridescence',
  'KHR_materials_sheen',
  'KHR_materials_specular',
  'KHR_materials_transmission',
  'KHR_materials_unlit',
  'KHR_materials_variants',
  'KHR_materials_volume',
  'KHR_mesh_quantization',
  'KHR_meshopt_compression',
  'KHR_texture_basisu',
  'KHR_texture_transform',
]);
