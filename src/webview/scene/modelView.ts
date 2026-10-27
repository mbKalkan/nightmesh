import {
  Box3,
  Color,
  CubeUVReflectionMapping,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  Matrix4,
  Mesh,
  NeutralToneMapping,
  OrthographicCamera,
  PMREMGenerator,
  PerspectiveCamera,
  Quaternion,
  REVISION,
  RGBAFormat,
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
  type WebGLRenderTarget,
} from 'three';
import type { TilesRenderer } from '3d-tiles-renderer/three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import type { VariantMaterials } from './gltf';
import { Helpers, type HelperColors } from './helpers';
import { Picker, type PickRegion, type SurfacePoint } from './picking';
import { Playback } from './playback';
import { Ruler, type Measurement } from './ruler';
import {
  Highlight,
  SelectionIndex,
  addDrawn,
  boundsOf,
  framingBounds,
  localBox,
} from './selection';
import { Shading } from './shading';
import { pathOf, tileAt, tileBox, tileState, type RendererTile } from './tileTree';
import type { TilesLive } from '../structure/tileset';
import type {
  CameraState,
  Environment,
  Projection,
  ShadingMode,
  StandardView,
} from '../../shared/protocol';
import { OPPOSITE, Viewpoint } from './viewpoint';
import { sameCamera } from '../cameraState';

/** How the lighting environment is blurred; with three.js's version, what makes it the same. */
const ENVIRONMENT_SIGMA = 0.04;
const ENVIRONMENT_KEY = `room-${ENVIRONMENT_SIGMA}-three-${REVISION}`;

/** Decoders a model needs, made the first time any model needs them. */
export interface Decoders {
  draco?: DRACOLoader;
  ktx2?: KTX2Loader;
}

export interface ViewEvents {
  /**
   * A click on the model picked what is drawn there, by its structure key (`node:3`, or a 3D
   * Tiles `tile:0/2`), or empty space; `frame` on double-click.
   */
  picked(key: string | undefined, frame: boolean): void;
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
  menu(key: string | undefined, x: number, y: number): void;
  /** The camera turned: its rotation as a quaternion, x, y, z and w, for the axes gizmo. */
  turned(rotation: [number, number, number, number]): void;
  /** The camera moved, or zoomed: at most once a frame, after it is drawn. */
  moved(camera: CameraState): void;
  /**
   * While measuring, the measurement as far as it has come, each time it changes; undefined once
   * measuring stops.
   */
  ruled(measurement: Measurement | undefined): void;
  /** A length given in metres, as the view writes it over a measurement: in the unit set. */
  lengthText(metres: number): string;
  /** The tileset's tiles came, went, or were drawn or hidden: what the renderer has changed. */
  tilesChanged(): void;
  /** The view made its lighting environment, which the next views can start with. */
  environment(environment: Environment): void;
}

/** What a comparison found about a structure entry, to box it in the view. */
export type ChangeKind = 'added' | 'removed' | 'changed';

export interface ViewChange {
  key: string;
  kind: ChangeKind;
}

const CHANGE_KINDS: readonly ChangeKind[] = ['added', 'removed', 'changed'];

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

/** A press that moves less than this, in CSS pixels, is a click rather than a drag. */
const CLICK_SLOP = 4;

/** While measuring, a click this many CSS pixels from a vertex places the end on it. */
const SNAP_RADIUS = 8;

/**
 * While measuring, the vertex a click would snap to is looked for once the pointer rests this
 * long, in milliseconds: looking draws the model again, too costly at every move.
 */
const SNAP_HOVER_DELAY = 60;

/**
 * The 3D view: a model lit by a built-in environment, orbited with the mouse. It draws only
 * when something changes, so an idle view costs nothing. What is selected in the structure shows
 * as boxes over the model; clicking the model selects what is under the pointer.
 */
export class ModelView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly viewpoint: Viewpoint;
  private readonly resizeObserver: ResizeObserver;
  private readonly highlight = new Highlight();
  private readonly helpers = new Helpers();
  private readonly shading = new Shading();
  private readonly picker = new Picker();
  private readonly ruler: Ruler;
  /** Boxes around what a comparison found added, removed or changed, in Source Control's colors. */
  private readonly changeBoxes: Record<ChangeKind, Highlight> = {
    added: new Highlight('Nightmesh changes'),
    removed: new Highlight('Nightmesh changes'),
    changed: new Highlight('Nightmesh changes'),
  };
  private changes: readonly ViewChange[] = [];
  private changesBoxed = true;
  /** Whether clicks place the ends of a measurement rather than select. */
  private measuring = false;
  /** The measurement last told, to tell only changes. */
  private ruledAs: string | undefined;
  private snapTimer: ReturnType<typeof setTimeout> | undefined;
  private model: Object3D | undefined;
  private index: SelectionIndex | undefined;
  /** The tileset shown in place of a glTF model, whose group is then the model. */
  private tiles: TilesRenderer | undefined;
  /** The camera the tileset picks its tiles for: the one drawn with. */
  private tilesCamera: PerspectiveCamera | OrthographicCamera | undefined;
  /** Bounds of the whole tileset, as its tiles' bounding volumes say, once its root is read. */
  private readonly tilesBox = new Box3();
  /** Each tile's content as drawn, by the tile's path. */
  private tilePaths = new WeakMap<Object3D, string>();
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
  /** The cameras in the model, to look through. */
  private cameras: (PerspectiveCamera | OrthographicCamera)[] = [];
  private cameraIndex = -1;
  private variantNames: (string | undefined)[] = [];
  private variantIndex: number | undefined;
  /** Each mesh with variants and its own material, for when no variant is picked. */
  private readonly ownMaterials = new Map<Mesh, Material | Material[]>();
  /** The camera's rotation when the gizmo was last told. */
  private readonly turnedTo = new Quaternion(Number.NaN);
  /** The camera last said to have moved, so a frame drawn without moving says nothing. */
  private movedTo: CameraState | undefined;

  constructor(
    private readonly container: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    context: WebGL2RenderingContext,
    private readonly events: ViewEvents,
    /** The lighting environment a view made before, if the host kept one. */
    environment?: Environment,
  ) {
    this.renderer = new WebGLRenderer({ canvas, context });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    // Khronos PBR Neutral keeps base colors close to what the file says.
    this.renderer.toneMapping = NeutralToneMapping;
    this.scene.environment = this.environmentTexture(environment);
    this.ruler = new Ruler(container);
    this.scene.add(
      this.highlight.group,
      this.helpers.group,
      this.ruler.group,
      ...CHANGE_KINDS.map((kind) => this.changeBoxes[kind].group),
    );

    this.viewpoint = new Viewpoint(canvas, this.modelSphere, () => this.requestRender());
    this.listenForClicks();
    // Vertex data left memory once it was on the GPU, so a lost context can't redraw the model:
    // drop it, and draw again once the model comes back.
    canvas.addEventListener('webglcontextlost', () => {
      this.removeModel();
      this.index = undefined;
      this.highlight.clear();
      for (const kind of CHANGE_KINDS) this.changeBoxes[kind].clear();
      this.ruler.clear();
      this.stopPlaying();
    });
    canvas.addEventListener('webglcontextrestored', () => this.requestRender());
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  /**
   * The room the view lights models with (D-047): the one given, if it was made the same way;
   * otherwise made here, and told to the host once the first frame is drawn.
   */
  private environmentTexture(given: Environment | undefined): Texture {
    if (
      given?.key === ENVIRONMENT_KEY &&
      given.data.byteLength === given.width * given.height * 8
    ) {
      const data = given.data.byteOffset % 2 === 0 ? given.data : given.data.slice();
      const texture = new DataTexture(
        new Uint16Array(data.buffer, data.byteOffset, data.byteLength / 2),
        given.width,
        given.height,
        RGBAFormat,
        HalfFloatType,
      );
      texture.mapping = CubeUVReflectionMapping;
      texture.colorSpace = LinearSRGBColorSpace;
      texture.magFilter = LinearFilter;
      texture.minFilter = LinearFilter;
      texture.generateMipmaps = false;
      texture.needsUpdate = true;
      return texture;
    }
    const pmrem = new PMREMGenerator(this.renderer);
    const target = pmrem.fromScene(new RoomEnvironment(), ENVIRONMENT_SIGMA);
    pmrem.dispose();
    setTimeout(() => {
      const made = this.readEnvironment(target);
      if (made) this.events.environment(made);
    });
    return target.texture;
  }

  /**
   * The environment's texels as half floats. They are read as floats, which every WebGL 2 GPU
   * that renders to half floats can give, and are halves already.
   */
  private readEnvironment(target: WebGLRenderTarget): Environment | undefined {
    const { width, height } = target;
    const floats = new Float32Array(width * height * 4);
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const previous = this.renderer.getRenderTarget();
    try {
      this.renderer.setRenderTarget(target);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, floats);
      if (gl.getError() !== gl.NO_ERROR) return undefined;
    } finally {
      this.renderer.setRenderTarget(previous);
    }
    const halves = new Uint16Array(floats.length);
    for (let i = 0; i < floats.length; i++) halves[i] = DataUtils.toHalfFloat(floats[i]);
    return { key: ENVIRONMENT_KEY, width, height, data: new Uint8Array(halves.buffer) };
  }

  /** Clears to this color, given as sRGB channels from 0 to 1. */
  setBackground([r, g, b]: readonly [number, number, number]): void {
    this.renderer.setClearColor(new Color().setRGB(r, g, b, SRGBColorSpace), 1);
    this.requestRender();
  }

  /** The highlight's color, as sRGB channels from 0 to 1. */
  setHighlightColor(color: readonly [number, number, number]): void {
    this.highlight.setColor(color);
    this.ruler.setColor(color);
    this.requestRender();
  }

  /**
   * Boxes what a comparison found added, removed or changed, given as structure entries, in the
   * colors Source Control marks files with; none takes the boxes away.
   */
  setChanges(changes: readonly ViewChange[]): void {
    this.changes = changes;
    this.showChanges();
    this.requestRender();
  }

  /** Whether the changes a comparison found are boxed. */
  get changesShown(): boolean {
    return this.changesBoxed;
  }

  setChangesShown(shown: boolean): void {
    this.changesBoxed = shown;
    this.showChanges();
    this.requestRender();
  }

  /** The colors of added, removed and changed, as sRGB channels from 0 to 1. */
  setChangeColors(colors: Record<ChangeKind, readonly [number, number, number]>): void {
    for (const kind of CHANGE_KINDS) this.changeBoxes[kind].setColor(colors[kind]);
    this.requestRender();
  }

  private showChanges(): void {
    for (const kind of CHANGE_KINDS) {
      const objects = this.changesBoxed
        ? this.changes
            .filter((change) => change.kind === kind)
            .flatMap((change) => this.index?.objects(change.key) ?? [])
        : [];
      this.changeBoxes[kind].show(objects);
    }
  }

  /** Boxes follow their objects, after an animation or a change of units moved them. */
  private updateBoxes(): void {
    this.highlight.update();
    for (const kind of CHANGE_KINDS) this.changeBoxes[kind].update();
  }

  /** What is drawn over the model: left out when picking what is under the pointer. */
  private overlays(): Object3D[] {
    return [
      this.highlight.group,
      this.helpers.group,
      this.ruler.group,
      ...CHANGE_KINDS.map((kind) => this.changeBoxes[kind].group),
    ];
  }

  /**
   * Starts or stops measuring: while it lasts, a click on the model places an end of the
   * measurement instead of selecting what is there.
   */
  setMeasuring(measuring: boolean): void {
    if (measuring === this.measuring) return;
    this.measuring = measuring;
    clearTimeout(this.snapTimer);
    this.ruler.clear();
    this.render();
  }

  get isMeasuring(): boolean {
    return this.measuring;
  }

  /** Shows or hides the ground grid, the origin axes and the bounding box. */
  setHelpers({ grid, axes, bounds }: { grid: boolean; axes: boolean; bounds: boolean }): void {
    this.helpers.gridShown = grid;
    this.helpers.axesShown = axes;
    this.helpers.boundsShown = bounds;
    this.updateBounds();
    this.requestRender();
  }

  /** Fits the bounding box to the model as it is posed now, when it shows. */
  private updateBounds(): void {
    if (this.helpers.boundsShown && this.model) {
      this.helpers.setBounds(visibleBox(this.model));
    }
  }

  setHelperColors(colors: HelperColors): void {
    this.helpers.setColors(colors);
    this.requestRender();
  }

  /**
   * The glTF node of each camera in the model, in the order they are in its scene: the loader
   * changes names to suit animation paths, so the structure has the names to show.
   */
  get cameraNodes(): (number | undefined)[] {
    return this.cameras.map((camera) => this.index?.node(camera));
  }

  /** Looks through camera `index` of the model. */
  lookThrough(index: number): void {
    const camera = this.cameras[index];
    if (!camera) return;
    this.cameraIndex = index;
    this.viewpoint.lookThrough(camera);
  }

  /** Looks through the model's next camera, as 0 does. */
  nextCamera(): void {
    if (this.cameras.length > 0) this.lookThrough((this.cameraIndex + 1) % this.cameras.length);
  }

  /** The KHR_materials_variants the model has, by name where it gives one. */
  get variants(): readonly (string | undefined)[] {
    return this.variantNames;
  }

  /** The variant shown; undefined when the model shows its own materials. */
  get variant(): number | undefined {
    return this.variantIndex;
  }

  setVariant(index: number | undefined): void {
    if (!this.model || index === this.variantIndex) return;
    this.shading.detach();
    this.applyVariant(index);
    this.shading.attach(this.model);
    this.requestRender();
  }

  private applyVariant(index: number | undefined): void {
    this.variantIndex = index;
    for (const [mesh, own] of this.ownMaterials) {
      const materials = mesh.userData.variantMaterials as VariantMaterials;
      mesh.material = (index !== undefined && materials.get(index)) || own;
    }
  }

  get shadingMode(): ShadingMode {
    return this.shading.current;
  }

  setShadingMode(mode: ShadingMode): void {
    this.shading.setMode(mode);
    this.requestRender();
  }

  get wireframe(): boolean {
    return this.shading.wireframe;
  }

  setWireframe(shown: boolean): void {
    this.shading.setWireframe(shown);
    this.requestRender();
  }

  /** The grid's cell size in metres, once there is a model. */
  get gridCell(): number | undefined {
    return this.helpers.cell;
  }

  /** Draws the grid in squares of a power of ten of `unit` metres: the file's length unit. */
  setGridUnit(unit: number): void {
    this.helpers.setUnit(unit);
    this.requestRender();
  }

  /** Shows a loaded model in place of the one before; `keepCamera` keeps the view the user had. */
  show(gltf: GLTF, keepCamera: boolean): void {
    const model = gltf.scene;
    prepareForUpload(model);
    this.removeModel();
    this.model = model;
    this.index = new SelectionIndex(gltf);
    this.scene.add(model);
    // What was measured was on the model before.
    this.ruler.clear();
    this.cameras = [];
    this.cameraIndex = -1;
    model.traverse((object) => {
      if ((object as PerspectiveCamera).isPerspectiveCamera) {
        this.cameras.push(object as PerspectiveCamera);
      } else if ((object as OrthographicCamera).isOrthographicCamera) {
        this.cameras.push(object as OrthographicCamera);
      }
    });
    const keepVariant =
      keepCamera && sameNames(this.variantNames, (gltf.userData.variants as string[]) ?? []);
    this.variantNames = (gltf.userData.variants as (string | undefined)[]) ?? [];
    this.ownMaterials.clear();
    model.traverse((object) => {
      if ((object as Mesh).userData.variantMaterials) {
        this.ownMaterials.set(object as Mesh, (object as Mesh).material);
      }
    });
    if (keepVariant && this.variantIndex !== undefined) this.applyVariant(this.variantIndex);
    else this.variantIndex = undefined;
    this.shading.attach(model);
    this.modelBox().getBoundingSphere(this.modelSphere);
    this.helpers.fit(this.modelBox());
    this.updateBounds();
    if (!keepCamera || !this.framed) this.viewpoint.frame(this.modelBox());
    this.framed = true;
    this.startAnimations(model, gltf.animations, keepCamera);
    this.select(this.selected);
    this.showChanges();
    this.viewpoint.updateClipping();
    this.render();
  }

  /**
   * Shows a tileset in place of the model before (D-046), framed once its root is read; tiles
   * come and go as the camera moves. `keepCamera` keeps the view the user had.
   */
  showTiles(tiles: TilesRenderer, keepCamera: boolean): void {
    this.removeModel();
    this.tiles = tiles;
    this.model = tiles.group;
    this.index = undefined;
    this.scene.add(tiles.group);
    this.ruler.clear();
    this.cameras = [];
    this.cameraIndex = -1;
    this.variantNames = [];
    this.variantIndex = undefined;
    this.ownMaterials.clear();
    this.tilesBox.makeEmpty();
    this.tilePaths = new WeakMap();
    const redraw = () => this.requestRender();
    const changed = () => {
      // A tile selected before the renderer read it gets its box once it has.
      if (this.selected.startsWith('tile:')) this.showSelection();
      this.events.tilesChanged();
    };
    tiles.addEventListener('needs-render', redraw);
    tiles.addEventListener('needs-update', redraw);
    tiles.addEventListener('load-model', ({ scene, tile }) => {
      prepareForUpload(scene);
      this.tilePaths.set(scene, pathOf(tile as RendererTile));
      redraw();
      changed();
    });
    for (const type of ['dispose-model', 'tile-visibility-change', 'load-error'] as const) {
      tiles.addEventListener(type, changed);
    }
    tiles.addEventListener('load-root-tileset', () => {
      // The box in the tileset's own frame: one along the globe's axes would be far larger.
      tiles.group.updateMatrixWorld(true);
      const frame = new Matrix4();
      if (tiles.getOrientedBoundingBox(this.tilesBox, frame)) {
        this.tilesBox.applyMatrix4(frame.premultiply(tiles.group.matrixWorld));
      } else {
        this.tilesBox.makeEmpty();
      }
      this.modelBox().getBoundingSphere(this.modelSphere);
      this.helpers.fit(this.modelBox());
      this.updateBounds();
      if (!keepCamera || !this.framed) this.viewpoint.frame(this.modelBox());
      this.framed = true;
      this.viewpoint.updateClipping();
      redraw();
    });
    this.select(this.selected);
    this.render();
  }

  /** Takes the model shown out of the scene and frees what it holds. */
  private removeModel(): void {
    const previous = this.model;
    // Its own materials back first, to be disposed with it.
    this.shading.detach();
    if (this.tiles) {
      if (this.tilesCamera) this.tiles.deleteCamera(this.tilesCamera);
      this.tiles.dispose();
      this.scene.remove(this.tiles.group);
    } else if (previous) {
      this.scene.remove(previous);
      disposeObject(previous);
    }
    this.tiles = undefined;
    this.tilesCamera = undefined;
    this.model = undefined;
  }

  /**
   * Scales and turns the model's top node, as the units and up axis of an OBJ, STL or PLY file
   * say, and frames it again from where the camera looks.
   */
  setFileTransform(scale: number, rotation: readonly [number, number, number, number]): void {
    const [file] = this.index?.objects('node:0') ?? [];
    if (!file || !this.model) return;
    file.scale.setScalar(scale);
    file.quaternion.set(...rotation);
    this.model.updateMatrixWorld(true);
    this.modelBox().getBoundingSphere(this.modelSphere);
    this.helpers.fit(this.modelBox());
    this.updateBounds();
    this.updateBoxes();
    this.viewpoint.frame(this.modelBox(), this.viewpoint.direction());
    this.viewpoint.updateClipping();
    this.measure();
    this.requestRender();
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
      this.updateBoxes();
      this.render();
      if (now - this.lastMeasure > MEASURE_INTERVAL) {
        this.lastMeasure = now;
        this.measure();
        this.updateBounds();
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
    this.updateBoxes();
    this.updateBounds();
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
    this.showSelection();
    this.measure();
  }

  private showSelection(): void {
    const tile = this.selectedTile();
    if (tile) this.highlight.showBox(tile.box, tile.matrix);
    else this.highlight.show(this.index?.objects(this.selected) ?? []);
    this.requestRender();
  }

  /** The selected tile's bounding volume, as the renderer has it. */
  private selectedTile(): { box: Box3; matrix: Matrix4 } | undefined {
    const path = this.selected.startsWith('tile:') ? this.selected.slice(5) : undefined;
    const tile = this.tiles && path !== undefined ? tileAt(this.tiles.root, path) : undefined;
    return tile && this.tiles && tileBox(tile, this.tiles.group);
  }

  /** What the renderer has of the tileset shown, for the inspector. */
  tilesLive(): TilesLive | undefined {
    const tiles = this.tiles;
    if (!tiles) return undefined;
    return {
      tile: (path) => {
        const tile = tileAt(tiles.root, path);
        return tile && tileState(tile);
      },
      stats: () => {
        // Kept up to date by the renderer, though its types leave them out.
        const { stats, lruCache } = tiles as unknown as {
          stats: Record<'loaded' | 'queued' | 'downloading' | 'parsing' | 'failed', number>;
          lruCache: { cachedBytes: number };
        };
        return {
          loaded: stats.loaded,
          drawn: tiles.visibleTiles.size,
          downloading: stats.queued + stats.downloading + stats.parsing,
          failed: stats.failed,
          bytes: lruCache.cachedBytes,
        };
      },
    };
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

  /**
   * Frames what is selected, or the whole model when nothing drawn is, from where the camera
   * looks now.
   */
  frameSelection(): void {
    if (!this.model) return;
    const objects = this.index?.objects(this.selected) ?? [];
    const tile = this.selectedTile();
    const box = tile
      ? tile.box.clone().applyMatrix4(tile.matrix)
      : objects.length > 0
        ? framingBounds(objects, this.modelSphere.radius)
        : this.modelBox();
    this.viewpoint.frame(box, this.viewpoint.direction());
  }

  /** Turns to look from a standard view. */
  look(view: StandardView): void {
    this.viewpoint.look(view);
  }

  /** Turns to look from the other side of the standard view it is in, or from the back. */
  lookOpposite(): void {
    this.viewpoint.look(OPPOSITE[this.viewpoint.view ?? 'front']);
  }

  get projection(): Projection {
    return this.viewpoint.projection;
  }

  setProjection(projection: Projection): void {
    this.viewpoint.setProjection(projection);
  }

  /** Orbits by angles in radians, as the arrow keys do. */
  orbit(left: number, up: number): void {
    this.viewpoint.orbit(left, up);
  }

  /** Zooms in by `factor`, or out below 1, as + and - do. */
  zoom(factor: number): void {
    this.viewpoint.zoom(factor);
  }

  /**
   * The view as it is now, as a PNG. WebGL keeps no copy of what it showed, so the model is
   * drawn again and read in the same task.
   */
  async screenshot(): Promise<Uint8Array | undefined> {
    this.render();
    const blob = await new Promise<Blob | null>((resolve) =>
      this.renderer.domElement.toBlob(resolve, 'image/png'),
    );
    return blob ? new Uint8Array(await blob.arrayBuffer()) : undefined;
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
    clearTimeout(this.snapTimer);
    this.resizeObserver.disconnect();
    this.viewpoint.dispose();
    this.picker.dispose();
    this.ruler.dispose();
    this.highlight.dispose();
    for (const kind of CHANGE_KINDS) this.changeBoxes[kind].dispose();
    this.helpers.dispose();
    this.removeModel();
    this.shading.dispose();
    this.renderer.dispose();
  }

  /**
   * Reports the size of the selection, or of the model, to whoever shows it: a single node along
   * its own axes, as Blender gives an object's dimensions; anything else along the world's.
   */
  private measure(): void {
    const objects = this.index?.objects(this.selected) ?? [];
    const tile = this.selectedTile();
    let size = tile
      ? (tile.box.getSize(new Vector3()).toArray() as [number, number, number])
      : objects.length === 1 && this.selected.startsWith('node:')
        ? ownSize(objects[0])
        : undefined;
    if (!size && objects.length > 0) size = worldSize(boundsOf(objects));
    const selection = size !== undefined;
    if (!size && this.model) size = worldSize(this.tiles ? this.tilesBox : visibleBox(this.model));
    this.events.measured(size, selection);
  }

  private modelBox(): Box3 {
    const box = this.tiles
      ? this.tilesBox.clone()
      : this.model
        ? visibleBox(this.model)
        : new Box3();
    if (box.isEmpty()) box.set(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
    return box;
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
      if (event.button === 2) this.events.menu(this.pickAt(event), event.clientX, event.clientY);
      else if (this.measuring) this.placeEnd(event);
      else this.events.picked(this.pickAt(event), false);
    });
    this.canvas.addEventListener('dblclick', (event) => {
      if (!this.measuring) this.events.picked(this.pickAt(event), true);
    });
    // While measuring, a ring shows the vertex a click would snap to.
    this.canvas.addEventListener('pointermove', (event) => {
      clearTimeout(this.snapTimer);
      if (!this.measuring) return;
      if (event.buttons !== 0) return this.showSnap(undefined);
      const { clientX, clientY } = event;
      this.snapTimer = setTimeout(
        () => this.showSnap(this.vertexAt({ clientX, clientY })?.point),
        SNAP_HOVER_DELAY,
      );
    });
    this.canvas.addEventListener('pointerleave', () => {
      clearTimeout(this.snapTimer);
      this.showSnap(undefined);
    });
  }

  private showSnap(point: Vector3 | undefined): void {
    if (this.ruler.setSnap(point)) this.requestRender();
  }

  /** The vertex near the pointer that a click would snap to, while measuring. */
  private vertexAt(event: Pick<MouseEvent, 'clientX' | 'clientY'>): SurfacePoint | undefined {
    if (!this.model || !this.measuring) return undefined;
    const region = this.regionAt(event);
    const scale = region.width / Math.max(1, this.canvas.getBoundingClientRect().width);
    return this.picker.nearestVertex(
      this.renderer,
      this.scene,
      this.viewpoint.camera,
      this.model,
      this.overlays(),
      region,
      Math.max(1, Math.round(SNAP_RADIUS * scale)),
    );
  }

  /** What is drawn under the pointer, if anything: a node, or a tileset's tile. */
  private pickAt(event: MouseEvent): string | undefined {
    if (!this.model || !(this.index || this.tiles)) return undefined;
    const object = this.picker.pick(
      this.renderer,
      this.scene,
      this.viewpoint.camera,
      this.model,
      this.overlays(),
      this.regionAt(event),
    );
    if (!object) return undefined;
    if (this.tiles) {
      for (let above: Object3D | null = object; above; above = above.parent) {
        const path = this.tilePaths.get(above);
        if (path !== undefined) return `tile:${path}`;
      }
      return undefined;
    }
    const node = this.index?.node(object);
    return node === undefined ? undefined : `node:${node}`;
  }

  /**
   * Places an end of the measurement on the vertex near the pointer, or else where the pointer
   * is on the model; nothing off it.
   */
  private placeEnd(event: MouseEvent): void {
    if (!this.model) return;
    const hit =
      this.vertexAt(event) ??
      this.picker.surfacePoint(
        this.renderer,
        this.scene,
        this.viewpoint.camera,
        this.model,
        this.overlays(),
        this.regionAt(event),
      );
    if (!hit) return;
    this.ruler.add(hit.point, hit.object);
    this.render();
  }

  /** The drawing-buffer pixel under the pointer. */
  private regionAt(event: Pick<MouseEvent, 'clientX' | 'clientY'>): PickRegion {
    const rect = this.canvas.getBoundingClientRect();
    const scale = this.canvas.width / Math.max(1, rect.width);
    return {
      x: Math.floor((event.clientX - rect.left) * scale),
      y: Math.floor((event.clientY - rect.top) * scale),
      width: this.canvas.width,
      height: this.canvas.height,
    };
  }

  private render(): void {
    const camera = this.viewpoint.camera;
    const measurement = this.measuring
      ? this.ruler.update(camera, (metres) => this.events.lengthText(metres))
      : undefined;
    if (this.tiles) this.updateTiles(this.tiles, camera);
    this.renderer.render(this.scene, camera);
    this.shading.drawWireframe(this.renderer, this.scene, camera);
    if (!camera.quaternion.equals(this.turnedTo)) {
      this.turnedTo.copy(camera.quaternion);
      this.events.turned(camera.quaternion.toArray() as [number, number, number, number]);
    }
    if (this.model) {
      const state = this.viewpoint.state();
      if (!this.movedTo || !sameCamera(state, this.movedTo)) {
        this.movedTo = state;
        this.events.moved(state);
      }
    }
    // Told when it changes: an end placed, the model moved or scaled, measuring stopped.
    const ruled =
      measurement &&
      JSON.stringify(measurement, (_, value: unknown) =>
        typeof value === 'number' ? Number(value.toPrecision(9)) : value,
      );
    if (ruled !== this.ruledAs) {
      this.ruledAs = ruled;
      this.events.ruled(measurement);
    }
  }

  /** Picks the tiles to draw for where the camera is now, and asks for the ones missing. */
  private updateTiles(tiles: TilesRenderer, camera: PerspectiveCamera | OrthographicCamera): void {
    if (this.tilesCamera !== camera) {
      if (this.tilesCamera) tiles.deleteCamera(this.tilesCamera);
      tiles.setCamera(camera);
      this.tilesCamera = camera;
    }
    tiles.setResolutionFromRenderer(camera, this.renderer);
    camera.updateMatrixWorld();
    tiles.update();
  }

  /** Where the camera is and what it sees. */
  cameraState(): CameraState {
    return this.viewpoint.state();
  }

  /** Puts the camera where the other side of a comparison has it. */
  setCameraState(state: CameraState): void {
    this.viewpoint.setState(state);
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.viewpoint.setAspect(width / height);
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
    const variants = (object.userData.variantMaterials as VariantMaterials | undefined)?.values();
    for (const item of [material, ...(variants ?? [])].flat()) if (item) disposeMaterial(item);
  });
}

function sameNames(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((name, index) => name === b[index]);
}

function disposeMaterial(material: Material): void {
  for (const value of Object.values(material)) {
    if ((value as Texture | null)?.isTexture) (value as Texture).dispose();
  }
  material.dispose();
}

/**
 * The world box around what is drawn of `root`: as three.js measures objects, but without those
 * hidden, as KHR_node_visibility hides them, so the view frames what can be seen.
 */
function visibleBox(root: Object3D): Box3 {
  const box = new Box3();
  root.updateWorldMatrix(true, true);
  root.traverseVisible((object) => addDrawn(box, object));
  return box;
}
