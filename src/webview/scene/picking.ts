import {
  BufferAttribute,
  BufferGeometry,
  Color,
  FloatType,
  Line,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  LinearSRGBColorSpace,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Scene,
  Sphere,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type InstancedMesh,
  type Material,
  type Mesh,
  type Object3D,
  type OrthographicCamera,
  type PerspectiveCamera,
  type SkinnedMesh,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { anyFace, nearestWritten, onEdgeOfShape } from './snap';

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

/** A point a click snaps to: a vertex, or a point on an edge. */
export interface SnapPoint extends SurfacePoint {
  kind: 'vertex' | 'edge';
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

/**
 * Something read of the surface drawn under the pointer, for EXT_mesh_features and
 * EXT_structural_metadata: a vertex attribute's value, the number of the vertex, or the texel of
 * a texture there. Probes of the same `key` read the same thing.
 */
export type Probe =
  | { key: string; attribute: string }
  | { key: string; vertex: true }
  | { key: string; texture: Texture; texCoord: number };

/** What each probe read where an object is drawn under the pointer: four bytes, by key. */
export interface ProbeHit {
  object: Object3D;
  bytes: Map<string, Uint8Array>;
}

/** The number an attribute or vertex probe read, or undefined where it read none. */
export function probedNumber(bytes: Uint8Array | undefined): number | undefined {
  const value = bytes ? bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) : 0;
  return value === 0 ? undefined : value - 1;
}

/** Names a shader can declare as an attribute: glTF's are free text. */
const ATTRIBUTE_NAME = /^(?!gl_)(?!.*__)[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Writes the texel of `nmTexture` under each fragment, as it is stored: the texture coordinate
 * wraps, and picks the texel it falls in, as EXT_mesh_features and EXT_structural_metadata read
 * them.
 */
const TEXEL_FRAGMENT = `#include <premultiplied_alpha_fragment>
	ivec2 nmSize = textureSize(nmTexture, 0);
	ivec2 nmTexel = clamp(ivec2(fract(nmUv) * vec2(nmSize)), ivec2(0), nmSize - 1);
	gl_FragColor = texelFetch(nmTexture, nmTexel, 0);`;

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

/**
 * Writes the plane of the face drawn, in view space: its normal, from how the position changes
 * across the pixel, and its distance along it. Zeros where a face is too small to tell.
 */
const PLANE_FRAGMENT = `#include <premultiplied_alpha_fragment>
	vec3 nmNormal = cross(dFdx(nmView), dFdy(nmView));
	float nmLength = length(nmNormal);
	nmNormal = nmLength > 0.0 ? nmNormal / nmLength : vec3(0.0);
	gl_FragColor = vec4(nmNormal, dot(nmNormal, nmView));`;

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
  private readonly probeMaterials = new WeakMap<Object3D, Map<string, PickMaterial>>();
  private readonly planeMaterials = new WeakMap<Object3D, PickMaterial>();
  private readonly vertexMaterials: PointsMaterial[] = [];
  private readonly edgeMaterials: LineBasicMaterial[] = [];
  private readonly made: PickMaterial[] = [];
  /** Where what is near the pointer is drawn to snap to, as floats: vertices, then edges. */
  private snapTarget: WebGLRenderTarget | undefined;
  private snapPixels = new Float32Array(0);
  /** The faces' planes drawn there. */
  private planePixels = new Float32Array(0);
  /** Each mesh geometry's edges while measuring, by the geometry; null for one without. */
  private readonly edges = new Map<BufferGeometry, BufferGeometry | null>();
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
   * What the probes `probesOf` gives for the object drawn at the pixel of `region` (or the
   * nearest pixel with something on it) read there: the scene drawn once more for each, that
   * object writing what its probe reads, the others only hiding it where they are in front.
   */
  probe(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    model: Object3D,
    hidden: readonly Object3D[],
    region: PickRegion,
    probesOf: (object: Object3D) => readonly Probe[] | undefined,
  ): ProbeHit | undefined {
    const picked = this.pickPixel(renderer, scene, camera, model, hidden, region);
    const probes = picked && probesOf(picked.object);
    if (!picked || !probes?.length) return undefined;
    const offset = (picked.row * SIZE + picked.column) * 4;
    const bytes = new Map<string, Uint8Array>();
    for (const probe of probes) {
      if (bytes.has(probe.key)) continue;
      this.draw(renderer, scene, camera, model, hidden, region, (object) =>
        object === picked.object ? this.probeMaterialFor(object, probe) : this.materialFor(object),
      );
      bytes.set(probe.key, this.pixels.slice(offset, offset + 4));
    }
    return { object: picked.object, bytes };
  }

  /**
   * Where a click at the pixel of `region` snaps to, at most `radius` pixels from it, of what
   * the model doesn't hide: the nearest vertex, or else the nearest point on an edge of the shape,
   * exactly, with its object. Over the depth of the model, each mesh, line and point cloud is
   * drawn once more as its vertices alone, one pixel each, and each mesh as its triangles' edges
   * and each line as itself; each pixel written gets its position, posed as the mesh is: skinned,
   * morphed and instanced. Edges are made only once no vertex is near: a dense mesh, with a vertex
   * near every click, never needs them. GPUs that can't draw floats get nothing.
   */
  snapPoint(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    model: Object3D,
    hidden: readonly Object3D[],
    region: PickRegion,
    radius: number,
  ): SnapPoint | undefined {
    if (!renderer.extensions.has('EXT_color_buffer_float')) return undefined;
    const size = radius * 2 + 1;
    if (this.snapTarget?.width !== size) {
      this.snapTarget?.dispose();
      this.snapTarget = new WebGLRenderTarget(size, size, { type: FloatType });
      this.snapPixels = new Float32Array(size * size * 4);
      this.planePixels = new Float32Array(size * size * 4);
    }
    const target = this.snapTarget;
    const vertices = new Scene();
    const vertexSources: Object3D[] = [];
    model.traverseVisible((object) => {
      const drawable = object as Partial<Mesh & Line & Points>;
      if (!(drawable.isMesh || drawable.isLine || drawable.isPoints)) return;
      if (!drawable.geometry) return;
      vertexSources.push(object);
      vertices.add(
        standIn(object, new Points(drawable.geometry, this.vertexMaterial(vertexSources.length))),
      );
    });
    if (vertexSources.length === 0) return undefined;

    const pixels = this.snapPixels;
    const planes = this.planePixels;
    const found = this.inRegion(renderer, camera, hidden, target, region, size, () => {
      // The faces' planes and the model's depth first, pushed back a hair so its own vertices
      // and edges aren't hidden by it.
      this.withMaterials(
        model,
        (object) => this.planeMaterialFor(object),
        () => renderer.render(scene, camera),
      );
      renderer.readRenderTargetPixels(target, 0, 0, size, size, planes);
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      try {
        renderer.clear(true, false, false);
        renderer.render(vertices, camera);
        renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
        const vertex = nearestWritten(pixels, size, radius);
        if (vertex !== undefined) return { offset: vertex, sources: vertexSources, kind: 'vertex' };
        // Off the model, no face's edge is near: only a line's could be.
        const lines = vertexSources.some((object) => (object as Line).isLine);
        if (!anyFace(planes) && !lines) return undefined;
        const { edges, edgeSources } = this.edgesFor(vertexSources);
        if (edgeSources.length === 0) return undefined;
        renderer.clear(true, false, false);
        renderer.render(edges, camera);
        renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
        // A line is an edge wherever it is; a triangle's edge, only where the shape has one.
        const edge = nearestWritten(pixels, size, radius, (offset, row, column) => {
          const object = edgeSources[Math.round(pixels[offset + 3]) - 1];
          if (!object) return false;
          if ((object as Line).isLine) return true;
          const point = [pixels[offset], pixels[offset + 1], pixels[offset + 2]] as const;
          return onEdgeOfShape(planes, size, row, column, point);
        });
        return edge === undefined
          ? undefined
          : { offset: edge, sources: edgeSources, kind: 'edge' };
      } finally {
        renderer.autoClear = autoClear;
      }
    });
    if (!found) return undefined;
    const object = found.sources[Math.round(pixels[found.offset + 3]) - 1];
    if (!object) return undefined;
    camera.updateMatrixWorld();
    const point = new Vector3(
      pixels[found.offset],
      pixels[found.offset + 1],
      pixels[found.offset + 2],
    ).applyMatrix4(camera.matrixWorld);
    return { point, object, kind: found.kind as SnapPoint['kind'] };
  }

  /** The edges of the meshes and lines among `drawn`, standing in for them, and theirs by number. */
  private edgesFor(drawn: readonly Object3D[]): { edges: Scene; edgeSources: Object3D[] } {
    const edges = new Scene();
    const edgeSources: Object3D[] = [];
    const edged = new Set<BufferGeometry>();
    for (const object of drawn) {
      const drawable = object as Partial<Mesh & LineSegments & LineLoop & Points>;
      if (drawable.isPoints || !drawable.geometry) continue;
      const geometry = drawable.isMesh ? this.edgesOf(drawable.geometry) : drawable.geometry;
      if (!geometry) continue;
      edged.add(drawable.geometry);
      edgeSources.push(object);
      const material = this.edgeMaterial(edgeSources.length);
      edges.add(
        standIn(
          object,
          drawable.isMesh || drawable.isLineSegments
            ? new LineSegments(geometry, material)
            : drawable.isLineLoop
              ? new LineLoop(geometry, material)
              : new Line(geometry, material),
        ),
      );
    }
    // Edges of what is no longer drawn, a tileset's tiles that went, leave the GPU.
    this.releaseEdges(edged);
    return { edges, edgeSources };
  }

  /**
   * Lets the GPU drop the edges made to snap to, all but those of `keep`: they hold an index
   * of their own, the size of their mesh's twice over.
   */
  releaseEdges(keep?: ReadonlySet<BufferGeometry>): void {
    for (const [source, edges] of this.edges) {
      if (keep?.has(source)) continue;
      this.edges.delete(source);
      if (!edges) continue;
      // The attributes are the mesh's own, still drawn: only the edges' index goes.
      edges.attributes = {};
      edges.morphAttributes = {};
      edges.dispose();
    }
  }

  /** The edges of a mesh's triangles, made once while measuring; none for a mesh without. */
  private edgesOf(geometry: BufferGeometry): BufferGeometry | undefined {
    let edges = this.edges.get(geometry);
    if (edges === undefined) {
      edges = edgeGeometry(geometry) ?? null;
      this.edges.set(geometry, edges);
    }
    return edges ?? undefined;
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
    this.snapTarget?.dispose();
    this.releaseEdges();
    for (const material of [...this.made, ...this.vertexMaterials, ...this.edgeMaterials]) {
      material.dispose();
    }
    this.made.length = 0;
    this.vertexMaterials.length = 0;
    this.edgeMaterials.length = 0;
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
   * A material that writes what `probe` reads of an object: an attribute's value or the vertex's
   * number plus one in three bytes, from the triangle's last vertex as a feature is numbered for
   * all of it; or the texel of a texture, as it is stored. Black for an attribute a shader can't
   * name.
   */
  private probeMaterialFor(object: Object3D, probe: Probe): PickMaterial {
    let made = this.probeMaterials.get(object);
    if (!made) this.probeMaterials.set(object, (made = new Map()));
    let material = made.get(probe.key);
    if (material) return material;
    material = this.flatMaterial(object);
    material.color.setRGB(0, 0, 0);
    made.set(probe.key, material);
    if ('texture' in probe) {
      const uv = probe.texCoord === 0 ? 'uv' : `uv${probe.texCoord}`;
      const texture = { value: probe.texture };
      material.onBeforeCompile = (shader) => {
        shader.uniforms.nmTexture = texture;
        const declared = probe.texCoord === 0 ? '' : `attribute vec2 ${uv};\n`;
        shader.vertexShader = `${declared}varying vec2 nmUv;\n${shader.vertexShader}`.replace(
          '#include <project_vertex>',
          `#include <project_vertex>\n\tnmUv = ${uv};`,
        );
        shader.fragmentShader =
          `uniform sampler2D nmTexture;\nvarying vec2 nmUv;\n${shader.fragmentShader}`.replace(
            '#include <premultiplied_alpha_fragment>',
            TEXEL_FRAGMENT,
          );
      };
      material.customProgramCacheKey = () => `nightmesh-texel-${uv}`;
      return material;
    }
    const attribute = 'attribute' in probe ? probe.attribute : undefined;
    if (attribute !== undefined && !ATTRIBUTE_NAME.test(attribute)) return material;
    const source = attribute ?? 'float(gl_VertexID)';
    material.onBeforeCompile = (shader) => {
      const declared = attribute ? `attribute float ${attribute};\n` : '';
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
    material.customProgramCacheKey = () => `nightmesh-probe-${attribute ?? 'vertex'}`;
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

  /**
   * A material that writes the plane of each face drawn, in view space, pushed back a hair as
   * the depth material is; lines and points, only their depth.
   */
  private planeMaterialFor(object: Object3D): PickMaterial {
    if (!(object as Mesh).isMesh) return this.depthMaterialFor(object);
    let material = this.planeMaterials.get(object);
    if (material) return material;
    material = this.flatMaterial(object);
    material.polygonOffset = true;
    material.polygonOffsetFactor = 1;
    material.polygonOffsetUnits = 1;
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = `varying vec3 nmView;\n${shader.vertexShader}`.replace(
        '#include <project_vertex>',
        DISTANCE_VERTEX,
      );
      shader.fragmentShader = `varying vec3 nmView;\n${shader.fragmentShader}`.replace(
        '#include <premultiplied_alpha_fragment>',
        PLANE_FRAGMENT,
      );
    };
    material.customProgramCacheKey = () => 'nightmesh-plane';
    this.planeMaterials.set(object, material);
    return material;
  }

  /**
   * Draws lines, writing their view-space position and object `id`. They leave the depth be: a
   * vertex at the end of one is still found.
   */
  private edgeMaterial(id: number): LineBasicMaterial {
    let material = this.edgeMaterials[id - 1];
    if (material) return material;
    const object = { value: id };
    material = new LineBasicMaterial({ depthWrite: false });
    material.toneMapped = false;
    material.fog = false;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.nmObject = object;
      shader.vertexShader = `varying vec3 nmView;\n${shader.vertexShader}`.replace(
        '#include <project_vertex>',
        DISTANCE_VERTEX,
      );
      shader.fragmentShader =
        `varying vec3 nmView;\nuniform float nmObject;\n${shader.fragmentShader}`.replace(
          '#include <premultiplied_alpha_fragment>',
          VERTEX_FRAGMENT,
        );
    };
    material.customProgramCacheKey = () => 'nightmesh-edge';
    this.edgeMaterials[id - 1] = material;
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

/**
 * `drawn` in place of `object`, where the object is and as it is posed: three.js skins and
 * instances whatever says it is skinned or instanced, whichever way it draws it, so points or
 * lines standing in for a mesh take its bones, or its instances, to be where its faces are.
 */
function standIn<T extends Points | Line>(object: Object3D, drawn: T): T {
  const drawable = object as Partial<Mesh & SkinnedMesh & InstancedMesh>;
  drawn.matrixAutoUpdate = false;
  drawn.matrixWorldAutoUpdate = false;
  drawn.matrixWorld.copy(object.matrixWorld);
  drawn.frustumCulled = false;
  if (drawable.morphTargetInfluences) {
    drawn.morphTargetInfluences = drawable.morphTargetInfluences;
    drawn.morphTargetDictionary = drawable.morphTargetDictionary;
  }
  if (drawable.isSkinnedMesh) {
    Object.assign(drawn, {
      isSkinnedMesh: true,
      skeleton: drawable.skeleton,
      bindMode: drawable.bindMode,
      bindMatrix: drawable.bindMatrix,
      bindMatrixInverse: drawable.bindMatrixInverse,
    });
  }
  if (drawable.isInstancedMesh) {
    Object.assign(drawn, {
      isInstancedMesh: true,
      instanceMatrix: drawable.instanceMatrix,
      instanceColor: null,
      morphTexture: null,
      count: drawable.count,
    });
  }
  return drawn;
}

/** Lets an array go once it is on the GPU. */
const release = function (this: { array: unknown }) {
  this.array = null;
};

/**
 * The edges of a mesh's triangles, each triangle's three, as lines over the mesh's own vertex
 * buffers: from its indices, which stay in memory, or from the vertex count alone. Undefined for
 * a mesh with no triangles, or whose indices are gone.
 */
export function edgeGeometry(source: BufferGeometry): BufferGeometry | undefined {
  const position = source.getAttribute('position') as BufferAttribute | undefined;
  if (!position) return undefined;
  const index = source.index;
  const from = index?.array as ArrayLike<number> | null | undefined;
  if (index && !from) return undefined;
  const triangles = Math.floor((index ? index.count : position.count) / 3);
  if (triangles === 0) return undefined;
  const indices =
    position.count > 0xffff ? new Uint32Array(triangles * 6) : new Uint16Array(triangles * 6);
  for (let triangle = 0, at = 0; triangle < triangles; triangle++) {
    const first = triangle * 3;
    const a = from ? from[first] : first;
    const b = from ? from[first + 1] : first + 1;
    const c = from ? from[first + 2] : first + 2;
    indices[at++] = a;
    indices[at++] = b;
    indices[at++] = b;
    indices[at++] = c;
    indices[at++] = c;
    indices[at++] = a;
  }
  const edges = new BufferGeometry();
  for (const name of ['position', 'skinIndex', 'skinWeight']) {
    const attribute = source.getAttribute(name);
    if (attribute) edges.setAttribute(name, attribute);
  }
  edges.morphAttributes = source.morphAttributes;
  edges.morphTargetsRelative = source.morphTargetsRelative;
  // The vertices may have left memory: the bounds three.js sorts by are the mesh's.
  edges.boundingSphere = source.boundingSphere?.clone() ?? new Sphere();
  const attribute = new BufferAttribute(indices, 1);
  attribute.onUpload(release);
  edges.setIndex(attribute);
  return edges;
}
