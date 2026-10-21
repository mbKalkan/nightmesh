import {
  Color,
  LineBasicMaterial,
  LinearSRGBColorSpace,
  MeshBasicMaterial,
  PointsMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Line,
  type Material,
  type Mesh,
  type Object3D,
  type OrthographicCamera,
  type PerspectiveCamera,
  type Points,
  type Scene,
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
  private readonly made: PickMaterial[] = [];
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
    { x, y, width, height }: PickRegion,
    materialOf: (object: Object3D, id: number) => PickMaterial,
  ): Object3D[] {
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
    const wasVisible = hidden.map((object) => object.visible);
    hidden.forEach((object) => (object.visible = false));
    const clearColor = renderer.getClearColor(this.clearColor);
    const clearAlpha = renderer.getClearAlpha();
    const previousTarget = renderer.getRenderTarget();

    camera.setViewOffset(width, height, x - (SIZE >> 1), y - (SIZE >> 1), SIZE, SIZE);
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(this.target, 0, 0, SIZE, SIZE, this.pixels);

    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(clearColor, clearAlpha);
    camera.clearViewOffset();
    hidden.forEach((object, index) => (object.visible = wasVisible[index]));
    drawn.forEach((object, index) => ((object as Mesh).material = originals[index]));
    return drawn;
  }

  dispose(): void {
    this.target.dispose();
    for (const material of this.made) material.dispose();
    this.made.length = 0;
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
