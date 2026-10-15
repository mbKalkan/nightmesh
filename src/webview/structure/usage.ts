import { isObject, objects, type GltfModel } from './gltf';
import { entryKey, type EntryKey } from './outline';
import { drawnImage } from './textures';

/** What an accessor's data is for. */
export type Role = 'vertices' | 'indices' | 'morphTargets' | 'animation' | 'skins' | 'instancing';

/** Something in the structure that uses an accessor, and what for. */
export interface AccessorUse {
  key: EntryKey;
  role: Role;
}

/** What a bufferView's bytes hold: accessors' data, images, or meshes compressed with Draco. */
export interface ViewContents {
  accessors: number[];
  images: number[];
  /** Meshes whose Draco-compressed primitives are in it. */
  draco: number[];
}

/**
 * Who uses what, for the things the structure tree doesn't list: accessors, bufferViews, images
 * and samplers. Read once from the JSON; every reference is checked.
 */
export class ModelUsage {
  readonly accessors: AccessorUse[][];
  readonly views: ViewContents[];
  /** Textures that draw each image. */
  readonly images: number[][];
  /** Textures that sample with each sampler. */
  readonly samplers: number[][];

  constructor(model: GltfModel) {
    this.accessors = model.items('accessors').map(() => []);
    this.views = model.items('bufferViews').map(() => ({ accessors: [], images: [], draco: [] }));
    this.images = model.items('images').map(() => []);
    this.samplers = model.items('samplers').map(() => []);

    const use = (ref: unknown, key: EntryKey, role: Role) => {
      const accessor = model.ref('accessors', ref);
      if (accessor !== undefined) this.accessors[accessor].push({ key, role });
    };
    model.items('meshes').forEach((mesh, index) => {
      const key = entryKey('mesh', index);
      for (const primitive of objects(mesh.primitives)) {
        const attributes = isObject(primitive.attributes) ? primitive.attributes : {};
        for (const ref of Object.values(attributes)) use(ref, key, 'vertices');
        use(primitive.indices, key, 'indices');
        for (const target of objects(primitive.targets)) {
          for (const ref of Object.values(target)) use(ref, key, 'morphTargets');
        }
        const draco = model.extension(primitive, 'KHR_draco_mesh_compression');
        const view = model.ref('bufferViews', draco?.bufferView);
        if (view !== undefined && !this.views[view].draco.includes(index)) {
          this.views[view].draco.push(index);
        }
      }
    });
    model.items('animations').forEach((animation, index) => {
      const key = entryKey('animation', index);
      for (const sampler of objects(animation.samplers)) {
        use(sampler.input, key, 'animation');
        use(sampler.output, key, 'animation');
      }
    });
    model.items('skins').forEach((skin, index) => {
      use(skin.inverseBindMatrices, entryKey('skin', index), 'skins');
    });
    model.items('nodes').forEach((node, index) => {
      const instancing = model.extension(node, 'EXT_mesh_gpu_instancing');
      const attributes = isObject(instancing?.attributes) ? instancing.attributes : {};
      for (const ref of Object.values(attributes)) use(ref, entryKey('node', index), 'instancing');
    });

    model.items('accessors').forEach((accessor, index) => {
      const sparse = isObject(accessor.sparse) ? accessor.sparse : {};
      const views = [
        accessor.bufferView,
        isObject(sparse.indices) ? sparse.indices.bufferView : undefined,
        isObject(sparse.values) ? sparse.values.bufferView : undefined,
      ];
      for (const ref of views) {
        const view = model.ref('bufferViews', ref);
        if (view !== undefined && !this.views[view].accessors.includes(index)) {
          this.views[view].accessors.push(index);
        }
      }
    });
    model.items('images').forEach((image, index) => {
      const view = model.ref('bufferViews', image.bufferView);
      if (view !== undefined) this.views[view].images.push(index);
    });
    model.items('textures').forEach((texture, index) => {
      const images = new Set([drawnImage(model, index), model.ref('images', texture.source)]);
      for (const image of images) if (image !== undefined) this.images[image].push(index);
      const sampler = model.ref('samplers', texture.sampler);
      if (sampler !== undefined) this.samplers[sampler].push(index);
    });
  }

  /** The first thing in the structure that uses an accessor. */
  accessorOwner(accessor: number): EntryKey | undefined {
    return this.accessors[accessor]?.[0]?.key;
  }

  /** The first thing in the structure that uses a bufferView's bytes. */
  viewOwner(view: number): EntryKey | undefined {
    const contents = this.views[view];
    if (!contents) return undefined;
    for (const accessor of contents.accessors) {
      const owner = this.accessorOwner(accessor);
      if (owner) return owner;
    }
    if (contents.draco.length > 0) return entryKey('mesh', contents.draco[0]);
    for (const image of contents.images) {
      const texture = this.images[image]?.[0];
      if (texture !== undefined) return entryKey('texture', texture);
    }
    return undefined;
  }
}
