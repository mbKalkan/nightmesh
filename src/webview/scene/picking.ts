import {
  Color,
  LineBasicMaterial,
  LinearSRGBColorSpace,
  MeshBasicMaterial,
  PointsMaterial,
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

/**
 * Finds what is drawn under the pointer by drawing the scene again, a few pixels of it, with
 * every object in a flat color that encodes its number. Vertex data has left memory once it is
 * on the GPU, so a ray can't be tested against triangles; the GPU still has them all.
 */
export class Picker {
  private readonly target = new WebGLRenderTarget(SIZE, SIZE);
  private readonly pixels = new Uint8Array(SIZE * SIZE * 4);
  private readonly materials = new WeakMap<Object3D, PickMaterial>();
  private readonly made: PickMaterial[] = [];
  private readonly clearColor = new Color();

  /**
   * The object drawn at (x, y), in drawing-buffer pixels from the top left of a `width` ×
   * `height` canvas, or undefined where only the background shows.
   */
  pick(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: PerspectiveCamera | OrthographicCamera,
    model: Object3D,
    hidden: readonly Object3D[],
    { x, y, width, height }: { x: number; y: number; width: number; height: number },
  ): Object3D | undefined {
    const drawn: Object3D[] = [];
    const originals: (Material | Material[])[] = [];
    model.traverseVisible((object) => {
      const drawable = object as Partial<Mesh & Line & Points>;
      if (!(drawable.isMesh || drawable.isLine || drawable.isPoints)) return;
      drawn.push(object);
      originals.push(drawable.material!);
      const material = this.materialFor(object);
      const id = drawn.length;
      material.color.setRGB(
        (id & 0xff) / 255,
        ((id >> 8) & 0xff) / 255,
        ((id >> 16) & 0xff) / 255,
        LinearSRGBColorSpace,
      );
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

    // The pixel under the pointer wins; failing that, the nearest one with something on it.
    let best: Object3D | undefined;
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
          best = drawn[id - 1];
          bestDistance = distance;
        }
      }
    }
    return best;
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
    this.materials.set(object, material);
    this.made.push(material);
    return material;
  }
}
