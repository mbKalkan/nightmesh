import {
  Color,
  FloatType,
  LineBasicMaterial,
  LinearSRGBColorSpace,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type InstancedMesh,
  type Line,
  type Material,
  type Mesh,
  type Object3D,
  type OrthographicCamera,
  type PerspectiveCamera,
  type SkinnedMesh,
  type WebGLRenderer,
} from 'three';

/** The square around the pointer that is read, so a thin line or a point can still be hit. */
const SIZE = 7;

type PickMaterial = MeshBasicMaterial | LineBasicMaterial | PointsMaterial;

type Camera = PerspectiveCamera | OrthographicCamera;

/** A pixel of the canvas, in drawing-buffer pixels from the top left, and the canvas's size. */
export interface PickRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A point on the model under the pointer, in world space, and what is drawn there. */
export interface SurfacePoint {
  point: Vector3;
  object: Object3D;
}

/**
 * A feature of a 3D Tiles tile drawn under the pointer, by how the tile numbers it: a vertex's
 * batch id (b3dm), an instance (i3dm) or a point (pnts), which the tile's tables then map.
 */
export interface FeatureHit {
  object: Object3D;
  kind: FeatureKind;
  index: number;
}

export type FeatureKind = 'batch' | 'instance' | 'point';

/** How an object's features are numbered: by attribute, instance or point; none for others. */
export function featureKind(object: Object3D): FeatureKind | undefined {
  const drawable = object as Partial<Mesh & Points & InstancedMesh>;
  if (drawable.geometry?.attributes._batchid) return 'batch';
  if (drawable.isInstancedMesh) return 'instance';
  if (drawable.isPoints) return 'point';
  return undefined;
}

/** What each kind writes as its feature's number, in the vertex shader. */
const FEATURE_SOURCE: Record<FeatureKind, string> = {
  batch: '_batchid',
  instance: 'float(gl_InstanceID)',
  point: 'float(gl_VertexID)',
};

/** Writes the feature's number plus one in three bytes, low byte first; 0 is no feature. */
const FEATURE_FRAGMENT = `#include <premultiplied_alpha_fragment>
	float nmValue = nmFeature + 1.0;
	float nmHigh = floor(nmValue / 65536.0);
	float nmMiddle = floor((nmValue - nmHigh * 65536.0) / 256.0);
	gl_FragColor = vec4(vec3(nmValue - nmHigh * 65536.0 - nmMiddle * 256.0, nmMiddle, nmHigh) / 255.0, 1.0);`;

/** The largest number three bytes hold: distances are written in 24 bits. */
const LEVELS = 2 ** 24 - 1;

/**
 * Writes how far each fragment is from the camera, in place of its color: along the ray for a
 * perspective camera, along the view for an orthographic one, as a fraction of `nmRange` in three
 * bytes. The view-space position is interpolated, which is exact across a triangle.
 */
const DISTANCE_VERTEX = '#include <project_vertex>\n\tnmView = mvPosition.xyz;';
const DISTANCE_FRAGMENT = `#include <premultiplied_alpha_fragment>
\tfloat nmDistance = nmOrthographic > 0.5 ? -nmView.z : length(nmView);
\tfloat nmLevel = floor(clamp((nmDistance - nmRange.x) / (nmRange.y - nmRange.x), 0.0, 1.0) * ${LEVELS}.0 + 0.5);
\tfloat nmHigh = floor(nmLevel / 65536.0);
\tfloat nmMiddle = floor((nmLevel - nmHigh * 65536.0) / 256.0);
\tgl_FragColor = vec4(vec3(nmHigh, nmMiddle, nmLevel - nmHigh * 65536.0 - nmMiddle * 256.0) / 255.0, 1.0);`;

/** Writes each vertex's view-space position, and the number of its object, as floats. */
const VERTEX_FRAGMENT = `#include <premultiplied_alpha_fragment>
\tgl_FragColor = vec4(nmView, nmObject);`;

/**
 * Finds what is drawn under the pointer by drawing the scene again, a few pixels of it, with
 * every object in a flat color that encodes its number. Vertex data has left memory once it is
 * on the GPU, so a ray can't be tested against triangles; the GPU still has them all. Where on
 * the object the pointer is comes the same way: from a drawing of how far each pixel is.
 */
export class Picker {
  private readonly target = new WebGLRenderTarget(SIZE, SIZE);
  private readonly pixels = new Uint8Array(SIZE * SIZE * 4);
  private readonly materials = new WeakMap<Object3D, PickMaterial>();
  private readonly distanceMaterials = new WeakMap<Object3D, PickMaterial>();
  private readonly depthMaterials = new WeakMap<Object3D, PickMaterial>();
  private readonly featureMaterials = new WeakMap<Object3D, PickMaterial>();
  private readonly vertexMaterials: PointsMaterial[] = [];
  private readonly made: PickMaterial[] = [];
  /** Where vertices near the pointer are drawn, as floats, and how many pixels across. */
  private vertexTarget: WebGLRenderTarget | undefined;
  private vertexPixels = new Float32Array(0);
  private readonly clearColor = new Color();
  /** The distances the distance drawing spans, and whether the camera is orthographic. */
  private readonly range = { value: new Vector2() };
  private readonly orthographic = { value: 0 };

  /** The object drawn at the pixel of `region`, or undefined where only the background shows. */
  pick(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    model: Object3D,
    hidden: readonly Object3D[],
    region: PickRegion,
  ): Object3D | undefined {
    return this.pickPixel(renderer, scene, camera, model, hidden, region)?.object;
  }

  /**
   * The point on the model drawn at the pixel of `region`, or at the nearest pixel around it with
   * something on it, so a thin line or a point can still be hit.
   */
  surfacePoint(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    model: Object3D,
    hidden: readonly Object3D[],
    region: PickRegion,
  ): SurfacePoint | undefined {
    const picked = this.pickPixel(renderer, scene, camera, model, hidden, region);
    if (!picked) return undefined;
    // A perspective camera's rays leave at an angle: a corner is farther than the far plane.
    const near = camera.near;
    const far = camera.far * 2;
    this.range.value.set(near, far);
    this.orthographic.value = (camera as OrthographicCamera).isOrthographicCamera ? 1 : 0;
    this.draw(renderer, scene, camera, model, hidden, region, (object) =>
      this.distanceMaterialFor(object),
    );
    const offset = (picked.row * SIZE + picked.column) * 4;
    const pixels = this.pixels;
    if (pixels[offset + 3] === 0) return undefined;
    const level = pixels[offset] * 65536 + pixels[offset + 1] * 256 + pixels[offset + 2];
    const distance = near + (level / LEVELS) * (far - near);

    // The middle of that pixel, on the near plane, and the way the camera looks through it.
    const half = SIZE >> 1;
    const x = region.x - half + picked.column + 0.5;
    // Rows are read from the bottom up.
    const y = region.y - half + (SIZE - 1 - picked.row) + 0.5;
    const ndc = new Vector3((x / region.width) * 2 - 1, 1 - (y / region.height) * 2, -1);
    camera.updateMatrixWorld();
    const onNear = ndc.clone().unproject(camera);
    let point: Vector3;
    if (this.orthographic.value) {
      const forward = camera.getWorldDirection(new Vector3());
      point = onNear.addScaledVector(forward, distance - near);
    } else {
      const eye = camera.getWorldPosition(new Vector3());
      point = eye.addScaledVector(onNear.sub(eye).normalize(), distance);
    }
    return { point, object: picked.object };
  }

  /**
   * The feature drawn at the pixel of `region`, or at the nearest pixel around it with something
   * on it: the scene drawn once more with each object writing its features' numbers.
   */
  feature(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    model: Object3D,
    hidden: readonly Object3D[],
    region: PickRegion,
  ): FeatureHit | undefined {
    const picked = this.pickPixel(renderer, scene, camera, model, hidden, region);
    const kind = picked && featureKind(picked.object);
    if (!picked || !kind) return undefined;
    this.draw(renderer, scene, camera, model, hidden, region, (object) =>
      this.featureMaterialFor(object),
    );
    const offset = (picked.row * SIZE + picked.column) * 4;
    const pixels = this.pixels;
    const value = pixels[offset] | (pixels[offset + 1] << 8) | (pixels[offset + 2] << 16);
    return value === 0 ? undefined : { object: picked.object, kind, index: value - 1 };
  }

  /**
   * The vertex nearest the pixel of `region`, at most `radius` pixels from it, that the model
   * doesn't hide: exactly where it is, and its object. Each mesh, line and point cloud is drawn
   * once more as its vertices alone, one pixel each, over the depth of the model, and each pixel
   * written gets its vertex's position: posed as the mesh is, skinned, morphed and instanced. GPUs
   * that can't draw floats get nothing.
   */
  nearestVertex(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    model: Object3D,
    hidden: readonly Object3D[],
    region: PickRegion,
    radius: number,
  ): SurfacePoint | undefined {
    if (!renderer.extensions.has('EXT_color_buffer_float')) return undefined;
    const size = radius * 2 + 1;
    if (this.vertexTarget?.width !== size) {
      this.vertexTarget?.dispose();
      this.vertexTarget = new WebGLRenderTarget(size, size, { type: FloatType });
      this.vertexPixels = new Float32Array(size * size * 4);
    }
    const target = this.vertexTarget;
    const vertices = new Scene();
    const sources: Object3D[] = [];
    model.traverseVisible((object) => {
      const drawable = object as Partial<Mesh & Line & Points & SkinnedMesh & InstancedMesh>;
      if (!(drawable.isMesh || drawable.isLine || drawable.isPoints)) return;
      if (!drawable.geometry) return;
      sources.push(object);
      const points = new Points(drawable.geometry, this.vertexMaterial(sources.length));
      points.matrixAutoUpdate = false;
      points.matrixWorldAutoUpdate = false;
      points.matrixWorld.copy(object.matrixWorld);
      points.frustumCulled = false;
      if (drawable.morphTargetInfluences) {
        points.morphTargetInfluences = drawable.morphTargetInfluences;
        points.morphTargetDictionary = drawable.morphTargetDictionary;
      }
      // three.js skins and instances whatever says it is skinned or instanced, whichever way it
      // draws it: the points take the mesh's bones, or its instances, to be where its faces are.
      if (drawable.isSkinnedMesh) {
        Object.assign(points, {
          isSkinnedMesh: true,
          skeleton: drawable.skeleton,
          bindMode: drawable.bindMode,
          bindMatrix: drawable.bindMatrix,
          bindMatrixInverse: drawable.bindMatrixInverse,
        });
      }
      if (drawable.isInstancedMesh) {
        Object.assign(points, {
          isInstancedMesh: true,
          instanceMatrix: drawable.instanceMatrix,
          instanceColor: null,
          morphTexture: null,
          count: drawable.count,
        });
      }
      vertices.add(points);
    });
    if (sources.length === 0) return undefined;

    this.inRegion(renderer, camera, hidden, target, region, size, () => {
      // The model's depth first, pushed back a hair so its own vertices aren't hidden by it.
      this.withMaterials(
        model,
        (object) => this.depthMaterialFor(object),
        () => renderer.render(scene, camera),
      );
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(vertices, camera);
      renderer.autoClear = autoClear;
      renderer.readRenderTargetPixels(target, 0, 0, size, size, this.vertexPixels);
    });

    const pixels = this.vertexPixels;
    let best: number | undefined;
    let bestDistance = radius * radius + 1e-9;
    for (let row = 0; row < size; row++) {
      for (let column = 0; column < size; column++) {
        const offset = (row * size + column) * 4;
        if (pixels[offset + 3] < 0.5) continue;
        const distance = (row - radius) ** 2 + (column - radius) ** 2;
        if (distance < bestDistance) {
          best = offset;
          bestDistance = distance;
        }
      }
    }
    if (best === undefined) return undefined;
    const object = sources[Math.round(pixels[best + 3]) - 1];
    if (!object) return undefined;
    camera.updateMatrixWorld();
    const point = new Vector3(pixels[best], pixels[best + 1], pixels[best + 2]).applyMatrix4(
      camera.matrixWorld,
    );
    return { point, object };
  }

  /** Draws the patch with each object in an id color, and finds the pixel nearest the middle. */
  private pickPixel(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    model: Object3D,
    hidden: readonly Object3D[],
    region: PickRegion,
  ): { object: Object3D; row: number; column: number } | undefined {
    const drawn = this.draw(renderer, scene, camera, model, hidden, region, (object, id) => {
      const material = this.materialFor(object);
      material.color.setRGB(
        (id & 0xff) / 255,
        ((id >> 8) & 0xff) / 255,
        ((id >> 16) & 0xff) / 255,
        LinearSRGBColorSpace,
      );
      return material;
    });

    // The pixel under the pointer wins; failing that, the nearest one with something on it.
    let best: { object: Object3D; row: number; column: number } | undefined;
    let bestDistance = Infinity;
    for (let row = 0; row < SIZE; row++) {
      for (let column = 0; column < SIZE; column++) {
        const offset = (row * SIZE + column) * 4;
        const id =
          this.pixels[offset] | (this.pixels[offset + 1] << 8) | (this.pixels[offset + 2] << 16);
        if (id === 0 || !drawn[id - 1]) continue;
        const center = SIZE >> 1;
        const distance = (row - center) ** 2 + (column - center) ** 2;
        if (distance < bestDistance) {
          best = { object: drawn[id - 1], row, column };
          bestDistance = distance;
        }
      }
    }
    return best;
  }

  /**
   * Draws the few pixels around the one of `region` into the target and reads them, with every
   * object drawn in the material `materialOf` gives it (its number counts from 1). Returns the
   * objects drawn, by number.
   */
  private draw(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    model: Object3D,
    hidden: readonly Object3D[],
    region: PickRegion,
    materialOf: (object: Object3D, id: number) => PickMaterial,
  ): Object3D[] {
    return this.inRegion(renderer, camera, hidden, this.target, region, SIZE, () =>
      this.withMaterials(model, materialOf, (drawn) => {
        renderer.render(scene, camera);
        renderer.readRenderTargetPixels(this.target, 0, 0, SIZE, SIZE, this.pixels);
        return drawn;
      }),
    );
  }

  /**
   * Runs `draw` with the camera seeing only the `size` × `size` pixels around the one of
   * `region`, drawn into `target`, cleared to nothing, and the helpers in `hidden` hidden.
   */
  private inRegion<T>(
    renderer: WebGLRenderer,
    camera: Camera,
    hidden: readonly Object3D[],
    target: WebGLRenderTarget,
    { x, y, width, height }: PickRegion,
    size: number,
    draw: () => T,
  ): T {
    const wasVisible = hidden.map((object) => object.visible);
    hidden.forEach((object) => (object.visible = false));
    const clearColor = renderer.getClearColor(this.clearColor);
    const clearAlpha = renderer.getClearAlpha();
    const previousTarget = renderer.getRenderTarget();
    const half = size >> 1;
    camera.setViewOffset(width, height, x - half, y - half, size, size);
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(target);
    renderer.clear();
    try {
      return draw();
    } finally {
      renderer.setRenderTarget(previousTarget);
      renderer.setClearColor(clearColor, clearAlpha);
      camera.clearViewOffset();
      hidden.forEach((object, index) => (object.visible = wasVisible[index]));
    }
  }

  /**
   * Runs `draw` with every mesh, line and point cloud of `model` in the material `materialOf`
   * gives it, numbered from 1, and its own material back afterwards.
   */
  private withMaterials<T>(
    model: Object3D,
    materialOf: (object: Object3D, id: number) => PickMaterial,
    draw: (drawn: Object3D[]) => T,
  ): T {
    const drawn: Object3D[] = [];
    const originals: (Material | Material[])[] = [];
    model.traverseVisible((object) => {
      const drawable = object as Partial<Mesh & Line & Points>;
      if (!(drawable.isMesh || drawable.isLine || drawable.isPoints)) return;
      drawn.push(object);
      originals.push(drawable.material!);
      const material = materialOf(object, drawn.length);
      // Geometry groups index into an array of materials; every slot gets the same one.
      drawable.material = Array.isArray(drawable.material)
        ? drawable.material.map(() => material)
        : material;
    });
    try {
      return draw(drawn);
    } finally {
      drawn.forEach((object, index) => ((object as Mesh).material = originals[index]));
    }
  }

  dispose(): void {
    this.target.dispose();
    this.vertexTarget?.dispose();
    for (const material of [...this.made, ...this.vertexMaterials]) material.dispose();
    this.made.length = 0;
    this.vertexMaterials.length = 0;
  }

  /** A flat material for an object, drawn like its own: same sides, point size and so on. */
  private materialFor(object: Object3D): PickMaterial {
    let material = this.materials.get(object);
    if (material) return material;
    material = this.flatMaterial(object);
    this.materials.set(object, material);
    return material;
  }

  /** A material for an object that writes how far each of its pixels is from the camera. */
  private distanceMaterialFor(object: Object3D): PickMaterial {
    let material = this.distanceMaterials.get(object);
    if (material) return material;
    material = this.flatMaterial(object);
    material.onBeforeCompile = (shader) => {
      shader.uniforms.nmRange = this.range;
      shader.uniforms.nmOrthographic = this.orthographic;
      shader.vertexShader = `varying vec3 nmView;\n${shader.vertexShader}`.replace(
        '#include <project_vertex>',
        DISTANCE_VERTEX,
      );
      shader.fragmentShader =
        `varying vec3 nmView;\nuniform vec2 nmRange;\nuniform float nmOrthographic;\n${shader.fragmentShader}`.replace(
          '#include <premultiplied_alpha_fragment>',
          DISTANCE_FRAGMENT,
        );
    };
    material.customProgramCacheKey = () => 'nightmesh-distance';
    this.distanceMaterials.set(object, material);
    return material;
  }

  /**
   * A material that writes the number of each pixel's feature, as `featureKind` says the object
   * numbers them; black, no feature, for an object without any.
   */
  private featureMaterialFor(object: Object3D): PickMaterial {
    let material = this.featureMaterials.get(object);
    if (material) return material;
    material = this.flatMaterial(object);
    material.color.setRGB(0, 0, 0);
    const kind = featureKind(object);
    if (kind) {
      const source = FEATURE_SOURCE[kind];
      material.onBeforeCompile = (shader) => {
        const declared = kind === 'batch' ? 'attribute float _batchid;\n' : '';
        shader.vertexShader =
          `${declared}flat varying float nmFeature;\n${shader.vertexShader}`.replace(
            '#include <project_vertex>',
            `#include <project_vertex>\n\tnmFeature = ${source};`,
          );
        shader.fragmentShader = `flat varying float nmFeature;\n${shader.fragmentShader}`.replace(
          '#include <premultiplied_alpha_fragment>',
          FEATURE_FRAGMENT,
        );
      };
      material.customProgramCacheKey = () => `nightmesh-feature-${kind}`;
    }
    this.featureMaterials.set(object, material);
    return material;
  }

  /**
   * A material that draws an object's depth and no color, pushed back a hair: its vertices,
   * drawn over it, aren't hidden by its own faces.
   */
  private depthMaterialFor(object: Object3D): PickMaterial {
    let material = this.depthMaterials.get(object);
    if (material) return material;
    material = this.flatMaterial(object);
    material.colorWrite = false;
    material.polygonOffset = true;
    material.polygonOffsetFactor = 1;
    material.polygonOffsetUnits = 1;
    this.depthMaterials.set(object, material);
    return material;
  }

  /** Draws vertices a pixel each, writing their view-space position and object `id`. */
  private vertexMaterial(id: number): PointsMaterial {
    let material = this.vertexMaterials[id - 1];
    if (material) return material;
    const object = { value: id };
    material = new PointsMaterial({ size: 1, sizeAttenuation: false });
    material.toneMapped = false;
    material.fog = false;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.nmObject = object;
      // Points have no skinning of their own: the mesh's, for points standing in for a mesh.
      shader.vertexShader = `varying vec3 nmView;\n${shader.vertexShader}`
        .replace(
          '#include <morphtarget_pars_vertex>',
          '#include <morphtarget_pars_vertex>\n#include <skinning_pars_vertex>',
        )
        .replace(
          '#include <morphtarget_vertex>',
          '#include <morphtarget_vertex>\n\t#include <skinbase_vertex>\n\t#include <skinning_vertex>',
        )
        .replace('#include <project_vertex>', DISTANCE_VERTEX);
      shader.fragmentShader =
        `varying vec3 nmView;\nuniform float nmObject;\n${shader.fragmentShader}`.replace(
          '#include <premultiplied_alpha_fragment>',
          VERTEX_FRAGMENT,
        );
    };
    material.customProgramCacheKey = () => 'nightmesh-vertex';
    this.vertexMaterials[id - 1] = material;
    return material;
  }

  private flatMaterial(object: Object3D): PickMaterial {
    let material: PickMaterial;
    const original = (object as Mesh).material;
    const first = (Array.isArray(original) ? original[0] : original) as Partial<PointsMaterial>;
    const drawable = object as Partial<Line & Points>;
    if (drawable.isPoints) {
      material = new PointsMaterial({
        size: first.size ?? 1,
        sizeAttenuation: first.sizeAttenuation ?? true,
      });
    } else if (drawable.isLine) {
      material = new LineBasicMaterial();
    } else {
      material = new MeshBasicMaterial({ side: (first as Material).side });
    }
    material.toneMapped = false;
    material.fog = false;
    this.made.push(material);
    return material;
  }
}
