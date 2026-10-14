import {
  Box3,
  Color,
  Mesh,
  NeutralToneMapping,
  PMREMGenerator,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  SkinnedMesh,
  Sphere,
  Vector3,
  WebGLRenderer,
  type BufferAttribute,
  type BufferGeometry,
  type InterleavedBufferAttribute,
  type Material,
  type Object3D,
  type Texture,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import type { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

/** Decoders a model needs, made the first time any model needs them. */
export interface Decoders {
  draco?: DRACOLoader;
  ktx2?: KTX2Loader;
}

/** The direction the camera looks at a model from when it frames it: front, right, above. */
const VIEW_DIRECTION = new Vector3(1, 0.6, 1.4).normalize();

/**
 * The 3D view: a model lit by a built-in environment, orbited with the mouse. It draws only
 * when something changes, so an idle view costs nothing.
 */
export class ModelView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(45, 1, 0.01, 1000);
  private readonly controls: OrbitControls;
  private readonly resizeObserver: ResizeObserver;
  private model: Object3D | undefined;
  /** Whether the camera was ever pointed at a model; a reload keeps that view. */
  private framed = false;
  private frameRequest = 0;
  private draco: Promise<DRACOLoader> | undefined;
  private ktx2: Promise<KTX2Loader> | undefined;

  constructor(
    private readonly container: HTMLElement,
    canvas: HTMLCanvasElement,
    context: WebGL2RenderingContext,
  ) {
    this.renderer = new WebGLRenderer({ canvas, context });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    // Khronos PBR Neutral keeps base colors close to what the file says.
    this.renderer.toneMapping = NeutralToneMapping;
    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.addEventListener('change', () => this.requestRender());
    // Vertex data left memory once it was on the GPU, so a lost context can't redraw the model:
    // drop it, and draw again once the model comes back.
    canvas.addEventListener('webglcontextlost', () => {
      if (this.model) this.scene.remove(this.model);
      this.model = undefined;
    });
    canvas.addEventListener('webglcontextrestored', () => this.requestRender());
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  /** Clears to this color, given as sRGB channels from 0 to 1. */
  setBackground([r, g, b]: readonly [number, number, number]): void {
    this.renderer.setClearColor(new Color().setRGB(r, g, b, SRGBColorSpace), 1);
    this.requestRender();
  }

  /** Shows `model` in place of the one before; `keepCamera` keeps the view the user had. */
  show(model: Object3D, keepCamera: boolean): void {
    prepareForUpload(model);
    const previous = this.model;
    if (previous) {
      this.scene.remove(previous);
      disposeObject(previous);
    }
    this.model = model;
    this.scene.add(model);
    if (!keepCamera || !this.framed) this.frame();
    this.framed = true;
    this.render();
  }

  /**
   * Points the camera at the whole model, from the front, right and above, as close as it can
   * while every corner of the model's bounding box stays in view.
   */
  frame(): void {
    if (!this.model) return;
    const box = new Box3().setFromObject(this.model);
    if (box.isEmpty()) box.set(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
    const center = box.getCenter(new Vector3());
    const radius = box.getBoundingSphere(new Sphere()).radius || 1;

    // Camera axes for the view direction; corners are measured along them from the center.
    const forward = VIEW_DIRECTION.clone().negate();
    const right = new Vector3().crossVectors(forward, this.camera.up).normalize();
    const up = new Vector3().crossVectors(right, forward);
    const tanY = Math.tan((this.camera.fov * Math.PI) / 360);
    const tanX = tanY * this.camera.aspect;
    let distance = 0;
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          const corner = new Vector3(x, y, z).sub(center);
          // A corner closer to the camera needs the camera further back to stay in the frustum.
          const toward = -corner.dot(forward);
          distance = Math.max(
            distance,
            toward + Math.abs(corner.dot(right)) / tanX,
            toward + Math.abs(corner.dot(up)) / tanY,
          );
        }
      }
    }
    distance *= 1.08;

    this.camera.position.copy(center).addScaledVector(VIEW_DIRECTION, distance);
    this.camera.near = Math.max(distance - radius * 4, distance / 1000, 1e-4);
    this.camera.far = distance + radius * 10;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.update();
    this.requestRender();
  }

  requestRender(): void {
    if (this.frameRequest) return;
    this.frameRequest = requestAnimationFrame(() => {
      this.frameRequest = 0;
      this.render();
    });
  }

  /**
   * The decoders for a model using `extensions`. Each is a chunk of its own, with WebAssembly
   * inside, loaded only once a model uses it.
   */
  async decoders(extensions: readonly string[]): Promise<Decoders> {
    const decoders: Decoders = {};
    if (extensions.includes('KHR_draco_mesh_compression')) {
      this.draco ??= import('./draco').then(({ createDracoLoader }) => createDracoLoader());
      decoders.draco = await this.draco;
    }
    if (extensions.includes('KHR_texture_basisu')) {
      // Transcoding targets a format this GPU supports, so it needs the renderer.
      this.ktx2 ??= import('./ktx2').then(({ createKtx2Loader }) =>
        createKtx2Loader(this.renderer),
      );
      decoders.ktx2 = await this.ktx2;
    }
    return decoders;
  }

  dispose(): void {
    void this.draco?.then((loader) => loader.dispose());
    void this.ktx2?.then((loader) => loader.dispose());
    cancelAnimationFrame(this.frameRequest);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    if (this.model) disposeObject(this.model);
    this.renderer.dispose();
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    // Draw right away: waiting a frame would show a stretched image while resizing.
    this.render();
  }
}

/**
 * Computes bounds while the vertex data is still in memory, then lets plain meshes drop it once
 * it is on the GPU: a large model would otherwise be held twice. Skinned and morphed meshes keep
 * theirs, as three.js reads it to bound their poses.
 */
function prepareForUpload(model: Object3D): void {
  const release = function (this: { array: unknown }) {
    this.array = null;
  };
  model.traverse((object) => {
    const geometry = (object as Partial<Mesh>).geometry as BufferGeometry | undefined;
    if (!geometry) return;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const deformed =
      object instanceof SkinnedMesh || Object.keys(geometry.morphAttributes).length > 0;
    if (!(object instanceof Mesh) || deformed) return;
    // Index data stays: wireframe drawing builds its lines from it.
    for (const attribute of Object.values(geometry.attributes)) {
      // Interleaved attributes share one buffer, which is what gets uploaded.
      const uploaded = (attribute as InterleavedBufferAttribute).isInterleavedBufferAttribute
        ? (attribute as InterleavedBufferAttribute).data
        : (attribute as BufferAttribute);
      uploaded.onUpload(release);
    }
  });
}

function disposeObject(root: Object3D): void {
  root.traverse((object) => {
    const { geometry, material } = object as Partial<Mesh>;
    geometry?.dispose();
    for (const item of Array.isArray(material) ? material : material ? [material] : []) {
      disposeMaterial(item);
    }
  });
}

function disposeMaterial(material: Material): void {
  for (const value of Object.values(material)) {
    if ((value as Texture | null)?.isTexture) (value as Texture).dispose();
  }
  material.dispose();
}
