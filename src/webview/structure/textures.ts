import type { ImageInfo } from '../../shared/protocol';
import { isObject, num, type GltfModel } from './gltf';

/** Extensions that give a texture another image, which viewers draw in place of `source`. */
const IMAGE_EXTENSIONS = ['KHR_texture_basisu', 'EXT_texture_webp', 'EXT_texture_avif'];

/** Samplers' minification filters that read only the full-size image: no mipmaps needed. */
const WITHOUT_MIPMAPS = new Set([9728, 9729]);

/** The image a viewer draws for a texture: an extension's when it has one, else `source`. */
export function drawnImage(model: GltfModel, texture: number): number | undefined {
  const item = model.items('textures')[texture];
  if (!item) return undefined;
  const extensions = isObject(item.extensions) ? item.extensions : {};
  for (const name of IMAGE_EXTENSIONS) {
    const extension = extensions[name];
    const image = isObject(extension) ? model.ref('images', extension.source) : undefined;
    if (image !== undefined) return image;
  }
  return model.ref('images', item.source);
}

/**
 * Roughly what a texture takes in GPU memory: four bytes a pixel for PNG, JPEG and the like,
 * about one for KTX2, which stays block-compressed, and a third more for mipmaps.
 */
export function textureMemory(
  model: GltfModel,
  images: readonly (ImageInfo | null)[] | undefined,
  texture: number,
): number | undefined {
  const image = drawnImage(model, texture);
  const info = image === undefined ? undefined : images?.[image];
  if (!info) return undefined;
  const pixels = info.width * info.height;
  if (info.format === 'ktx2') return pixels * ((info.levels ?? 1) > 1 ? 4 / 3 : 1);
  const sampler = model.item(
    'samplers',
    model.ref('samplers', model.items('textures')[texture].sampler),
  );
  const minFilter = num(sampler?.minFilter);
  const mipmaps = minFilter === undefined || !WITHOUT_MIPMAPS.has(minFilter);
  return pixels * 4 * (mipmaps ? 4 / 3 : 1);
}
