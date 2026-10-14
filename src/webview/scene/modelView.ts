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
  type AnimationClip,
  type BufferAttribute,
  type BufferGeometry,
  type CompressedTexture,
  type InterleavedBufferAttribute,
  type Material,
  type Object3D,
  type Texture,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { Picker } from './picking';
import { Playback } from './playback';
import { Highlight, SelectionIndex, boundsOf, framingBounds, localBox } from './selection';

/** Decoders a model needs, made the first time any model needs them. */
export interface Decoders {
  draco?: DRACOLoader;
  ktx2?: KTX2Loader;
}

export interface ViewEvents {
  /** A click on the model picked the node drawn there, or empty space; `frame` on double-click. */
  picked(node: number | undefined, frame: boolean): void;
  /**
   * The size, in metres along X, Y and Z, of what is selected, or of the whole model when the
   * selection draws nothing; undefined when there is nothing drawn at all.
   */
  measured(size: [number, number, number] | undefined, selection: boolean): void;
  /** Where playback is: undefined when the model has no animations. */
  animation(state: AnimationState | undefined): void;
  /**
   * A right-click that didn't drag, which opens the context menu: the node drawn under the
   * pointer, or undefined over empty space. A right-drag pans, and opens no menu.
   */
  menu(node: number | undefined, x: number, y: number): void;
}

export interface AnimationState {
  /** Each clip's length in seconds, by the glTF animation index. */
  durations: number[];
  clip: number;
  time: number;
  playing: boolean;
  speed: number;
}

/** While playing, the size of the selection is measured again this often, in milliseconds. */
const MEASURE_INTERVAL = 500;

/** The direction the camera looks at a model from when it frames it: front, right, above. */
const VIEW_DIRECTION = new Vector3(1, 0.6, 1.4).normalize();
/** A press that moves less than this, in CSS pixels, is a click rather than a drag. */
const CLICK_SLOP = 4;

/**
 * The 3D view: a model lit by a built-in environment, orbited with the mouse. It draws only
 * when something changes, so an idle view costs nothing. What is selected in the structure shows
 * as boxes over the model; clicking the model selects what is under the pointer.
 */
export class ModelView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(45, 1, 0.01, 1000);
  private readonly controls: OrbitControls;
  private readonly resizeObserver: ResizeObserver;
  private readonly highlight = new Highlight();
  private readonly picker = new Picker();
  private model: Object3D | undefined;
  private index: SelectionIndex | undefined;
  /** The structure entry selected, whose objects are highlighted. */
  private selected = 'model';
  /** Bounds of the whole model, which the clipping planes keep in view. */
  private readonly modelSphere = new Sphere(new Vector3(), 1);
  /** Whether the camera was ever pointed at a model; a reload keeps that view. */
  private framed = false;
  private frameRequest = 0;
  private playback: Playback | undefined;
  /** The animation frame that plays the clip, while it plays. */
  private playRequest = 0;
  private lastFrame = 0;
  private lastMeasure = 0;
  private draco: Promise<DRACOLoader> | undefined;
  private ktx2: Promise<KTX2Loader> | undefined;

  constructor(
    private readonly container: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    context: WebGL2RenderingContext,
    private readonly events: ViewEvents,
  ) {
    this.renderer = new WebGLRenderer({ canvas, context });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    // Khronos PBR Neutral keeps base colors close to what the file says.
    this.renderer.toneMapping = NeutralToneMapping;
    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.add(this.highlight.group);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.addEventListener('change', () => {
      this.updateClipping();
      this.requestRender();
    });
    this.listenForClicks();
    // Vertex data left memory once it was on the GPU, so a lost context can't redraw the model:
    // drop it, and draw again once the model comes back.
    canvas.addEventListener('webglcontextlost', () => {
      if (this.model) this.scene.remove(this.model);
      this.model = undefined;
      this.index = undefined;
      this.highlight.clear();
      this.stopPlaying();
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

  /** The highlight's color, as sRGB channels from 0 to 1. */
  setHighlightColor(color: readonly [number, number, number]): void {
    this.highlight.setColor(color);
    this.requestRender();
  }

  /** Shows a loaded model in place of the one before; `keepCamera` keeps the view the user had. */
  show(gltf: GLTF, keepCamera: boolean): void {
    const model = gltf.scene;
    prepareForUpload(model);
    const previous = this.model;
    if (previous) {
      this.scene.remove(previous);
      disposeObject(previous);
    }
    this.model = model;
    this.index = new SelectionIndex(gltf);
    this.scene.add(model);
    this.modelBox().getBoundingSphere(this.modelSphere);
    if (!keepCamera || !this.framed) this.frame();
    this.framed = true;
    this.startAnimations(model, gltf.animations, keepCamera);
    this.select(this.selected);
    this.updateClipping();
    this.render();
  }

  /** Plays clip `index` from where it is now, or from the start if it is another clip. */
  setClip(index: number): void {
    if (!this.playback || index === this.playback.clip) return;
    this.playback.select(index);
    this.afterPose();
    this.reportAnimation();
  }

  setPlaying(playing: boolean): void {
    if (!this.playback) return;
    this.playback.setPlaying(playing);
    if (this.playback.playing) this.startPlaying();
    else this.stopPlaying();
    this.reportAnimation();
  }

  togglePlaying(): void {
    this.setPlaying(!this.playback?.playing);
  }

  /** Shows the pose `time` seconds into the clip. */
  seek(time: number): void {
    if (!this.playback) return;
    this.playback.seek(time);
    this.afterPose();
    this.reportAnimation();
  }

  setSpeed(speed: number): void {
    if (!this.playback) return;
    this.playback.speed = speed;
    this.reportAnimation();
  }

  /**
   * Sets up playback for a model's clips, picking up where the last model left off when the
   * file changed: same clip, same time, still playing if it was.
   */
  private startAnimations(model: Object3D, clips: readonly AnimationClip[], keep: boolean): void {
    const before = keep ? this.playback : undefined;
    const state = before && {
      clip: before.clip,
      time: before.time,
      playing: before.playing,
      speed: before.speed,
    };
    this.stopPlaying();
    this.playback?.dispose();
    this.playback = undefined;
    // Skinned meshes are bounded in their rest pose; animated, they can leave that sphere.
    model.traverse((object) => {
      if ((object as SkinnedMesh).isSkinnedMesh) object.frustumCulled = false;
    });
    if (clips.length === 0) return this.events.animation(undefined);
    this.playback = new Playback(model, clips);
    this.playback.speed = state?.speed ?? 1;
    this.playback.setPlaying(state?.playing ?? false);
    this.playback.select(state && state.clip < clips.length ? state.clip : 0, state?.time ?? 0);
    if (this.playback.playing) this.startPlaying();
    this.reportAnimation();
  }

  private startPlaying(): void {
    if (this.playRequest) return;
    this.lastFrame = performance.now();
    const step = (now: number) => {
      if (!this.playback?.playing) return void (this.playRequest = 0);
      this.playback.advance(Math.min((now - this.lastFrame) / 1000, 0.25));
      this.lastFrame = now;
      this.highlight.update();
      this.render();
      if (now - this.lastMeasure > MEASURE_INTERVAL) {
        this.lastMeasure = now;
        this.measure();
      }
      this.reportAnimation();
      this.playRequest = requestAnimationFrame(step);
    };
    this.playRequest = requestAnimationFrame(step);
  }

  private stopPlaying(): void {
    cancelAnimationFrame(this.playRequest);
    this.playRequest = 0;
    this.measure();
  }

  /** After the model moved: boxes follow it, the size is measured again, the view redrawn. */
  private afterPose(): void {
    this.model?.updateMatrixWorld(true);
    this.highlight.update();
    this.measure();
    this.requestRender();
  }

  private reportAnimation(): void {
    const playback = this.playback;
    this.events.animation(
      playback && {
        durations: playback.clips.map((clip) => clip.duration),
        clip: playback.clip,
        time: playback.time,
        playing: playback.playing,
        speed: playback.speed,
      },
    );
  }

  /** Highlights what a structure entry stands for: a node, a mesh's nodes, a material's uses. */
  select(key: string): void {
    this.selected = key;
    this.highlight.show(this.index?.objects(key) ?? []);
    this.measure();
    this.requestRender();
  }

  /**
   * A texture's image as loaded, to preview: `compressed` for KTX2, whose data stays in GPU
   * formats, and undefined before the model is drawn.
   */
  textureImage(
    index: number,
  ): { image: CanvasImageSource; width: number; height: number } | 'compressed' | undefined {
    const texture = this.index?.texture(index);
    if (!texture) return undefined;
    if ((texture as CompressedTexture).isCompressedTexture) return 'compressed';
    const image = texture.image as (CanvasImageSource & { width: number; height: number }) | null;
    return image && image.width > 0
      ? { image, width: image.width, height: image.height }
      : undefined;
  }

  /** Frames what is selected, or the whole model when nothing drawn is. */
  frameSelection(): void {
    const objects = this.index?.objects(this.selected) ?? [];
    if (objects.length === 0) return this.frame();
    this.frameBox(framingBounds(objects, this.modelSphere.radius));
  }

  /** Points the camera at the whole model. */
  frame(): void {
    if (this.model) this.frameBox(this.modelBox());
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
    this.stopPlaying();
    this.playback?.dispose();
    void this.draco?.then((loader) => loader.dispose());
    void this.ktx2?.then((loader) => loader.dispose());
    cancelAnimationFrame(this.frameRequest);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.picker.dispose();
    this.highlight.dispose();
    if (this.model) disposeObject(this.model);
    this.renderer.dispose();
  }

  /**
   * Reports the size of the selection, or of the model, to whoever shows it: a single node along
   * its own axes, as Blender gives an object's dimensions; anything else along the world's.
   */
  private measure(): void {
    const objects = this.index?.objects(this.selected) ?? [];
    let size =
      objects.length === 1 && this.selected.startsWith('node:') ? ownSize(objects[0]) : undefined;
    if (!size && objects.length > 0) size = worldSize(boundsOf(objects));
    const selection = size !== undefined;
    if (!size && this.model) size = worldSize(new Box3().setFromObject(this.model));
    this.events.measured(size, selection);
  }

  private modelBox(): Box3 {
    const box = this.model ? new Box3().setFromObject(this.model) : new Box3();
    if (box.isEmpty()) box.set(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
    return box;
  }

  /**
   * Points the camera at `box`, from the front, right and above, as close as it can while every
   * corner of the box stays in view.
   */
  private frameBox(box: Box3): void {
    const center = box.getCenter(new Vector3());
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
    distance = Math.max(distance * 1.08, 1e-3);

    this.camera.position.copy(center).addScaledVector(VIEW_DIRECTION, distance);
    this.controls.target.copy(center);
    this.controls.update();
    this.updateClipping();
    this.requestRender();
  }

  /**
   * Keeps the whole model between the clipping planes wherever the camera is: the far plane past
   * its farthest side, the near one well short of the point orbited, so a part zoomed in on is
   * never cut and the rest of the model doesn't disappear behind it.
   */
  private updateClipping(): void {
    const toModel = this.camera.position.distanceTo(this.modelSphere.center);
    const far = Math.max(toModel + this.modelSphere.radius * 2, 1e-2);
    const toTarget = this.camera.position.distanceTo(this.controls.target);
    this.camera.far = far;
    this.camera.near = Math.max(Math.min(toTarget / 100, far / 1000), far / 1e6);
    this.camera.updateProjectionMatrix();
  }

  /**
   * A click picks what is under the pointer; a double-click also frames it. A right-click opens
   * the context menu once the button is released, as the orbit controls keep the browser's own
   * menu from opening: on some systems it opens on press, before a right-drag pans.
   */
  private listenForClicks(): void {
    let down: { x: number; y: number; button: number } | undefined;
    this.canvas.addEventListener('pointerdown', (event) => {
      down =
        event.button === 0 || event.button === 2
          ? { x: event.clientX, y: event.clientY, button: event.button }
          : undefined;
    });
    this.canvas.addEventListener('pointerup', (event) => {
      if (!down || event.button !== down.button) return;
      const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      down = undefined;
      if (moved > CLICK_SLOP) return;
      if (event.button === 0) this.events.picked(this.pickAt(event), false);
      else this.events.menu(this.pickAt(event), event.clientX, event.clientY);
    });
    this.canvas.addEventListener('dblclick', (event) => {
      this.events.picked(this.pickAt(event), true);
    });
  }

  /** The node drawn under the pointer, if any. */
  private pickAt(event: MouseEvent): number | undefined {
    if (!this.model || !this.index) return undefined;
    const rect = this.canvas.getBoundingClientRect();
    const scale = this.canvas.width / Math.max(1, rect.width);
    const object = this.picker.pick(
      this.renderer,
      this.scene,
      this.camera,
      this.model,
      [this.highlight.group],
      {
        x: Math.floor((event.clientX - rect.left) * scale),
        y: Math.floor((event.clientY - rect.top) * scale),
        width: this.canvas.width,
        height: this.canvas.height,
      },
    );
    return object ? this.index.node(object) : undefined;
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

function worldSize(box: Box3): [number, number, number] | undefined {
  return box.isEmpty()
    ? undefined
    : (box.getSize(new Vector3()).toArray() as [number, number, number]);
}

/** An object's size along its own axes, scaled as the scene scales it. */
function ownSize(object: Object3D): [number, number, number] | undefined {
  const box = localBox(object);
  if (!box) return undefined;
  const size = box.getSize(new Vector3()).multiply(object.getWorldScale(new Vector3()));
  return [Math.abs(size.x), Math.abs(size.y), Math.abs(size.z)];
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
