import {
  Color,
  DoubleSide,
  FrontSide,
  MeshBasicMaterial,
  MeshNormalMaterial,
  type Camera,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type Scene,
  type Side,
  type WebGLRenderer,
} from 'three';
import type { ShadingMode } from '../../shared/protocol';

/** The layer meshes are on too, so the wireframe pass draws them and nothing else. */
const WIREFRAME_LAYER = 1;
const WIREFRAME_OPACITY = 0.45;

/**
 * How the model is drawn: lit by the environment as its materials say, unlit in their base colors
 * and textures, or by the direction its surfaces face. A wireframe can be drawn over any of them.
 * The model's own materials are put back whenever it is drawn lit again.
 */
export class Shading {
  private mode: ShadingMode = 'lit';
  private wireframeShown = false;
  private model: Object3D | undefined;
  /** Parts added after the model, a tileset's tiles: out of it while the renderer hides them. */
  private readonly parts = new Set<Object3D>();
  /** Each mesh's own materials, while another mode shows. */
  private readonly originals = new Map<Mesh, Material | Material[]>();
  private readonly unlit = new Map<Material, MeshBasicMaterial>();
  private readonly normals = new Map<string, MeshNormalMaterial>();
  /** Dark lines, as Blender draws them: they show on the light and middle tones most models have. */
  private readonly wire = new MeshBasicMaterial({
    color: 0x000000,
    wireframe: true,
    transparent: true,
    opacity: WIREFRAME_OPACITY,
    depthWrite: false,
    toneMapped: false,
  });
  /** Materials pushed back in depth while the wireframe shows, so its lines win over them. */
  private readonly offset = new Set<Material>();

  get current(): ShadingMode {
    return this.mode;
  }

  get wireframe(): boolean {
    return this.wireframeShown;
  }

  /** Draws `model` the way the shading is set: called once for each model shown. */
  attach(model: Object3D): void {
    this.detach();
    this.model = model;
    this.add(model);
  }

  /**
   * Draws `part`, just put under the model, the way the shading is set: a tileset's tile as it
   * comes. Its meshes go into the wireframe, and their materials are replaced as the mode says.
   */
  add(part: Object3D): void {
    if (!this.model) return;
    if (part !== this.model) this.parts.add(part);
    part.traverse((object) => {
      if (hasWireframe(object as Mesh)) object.layers.enable(WIREFRAME_LAYER);
    });
    this.applyTo(part);
  }

  /**
   * Gives `part` back its own materials before it is disposed, a tileset's tile as it goes, and
   * frees what was made for them.
   */
  remove(part: Object3D): void {
    this.parts.delete(part);
    part.traverse((object) => {
      const mesh = object as Mesh;
      const original = this.originals.get(mesh);
      if (original) {
        mesh.material = original;
        this.originals.delete(mesh);
      }
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (!material) continue;
        if (this.offset.delete(material)) unpush(material);
        const unlit = this.unlit.get(material);
        if (!unlit) continue;
        this.offset.delete(unlit);
        unlit.dispose();
        this.unlit.delete(material);
      }
    });
  }

  /** Gives the model back its own materials, before it is disposed or lost. */
  detach(): void {
    this.restore();
    this.model = undefined;
    this.parts.clear();
    for (const material of [...this.unlit.values(), ...this.normals.values()]) material.dispose();
    this.unlit.clear();
    this.normals.clear();
  }

  setMode(mode: ShadingMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.apply();
  }

  setWireframe(shown: boolean): void {
    this.wireframeShown = shown;
    this.apply();
  }

  /** Draws the wireframe over what was just drawn, when it shows. */
  drawWireframe(renderer: WebGLRenderer, scene: Scene, camera: Camera): void {
    if (!this.wireframeShown || !this.model) return;
    const { autoClear } = renderer;
    const override = scene.overrideMaterial;
    renderer.autoClear = false;
    scene.overrideMaterial = this.wire;
    camera.layers.set(WIREFRAME_LAYER);
    renderer.render(scene, camera);
    camera.layers.set(0);
    scene.overrideMaterial = override;
    renderer.autoClear = autoClear;
  }

  dispose(): void {
    this.detach();
    this.wire.dispose();
  }

  private apply(): void {
    this.restore();
    if (!this.model) return;
    this.applyTo(this.model);
    for (const part of this.parts) this.applyTo(part);
  }

  private applyTo(root: Object3D): void {
    root.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      // A part under the model is met twice: its own materials are kept once.
      if (this.mode !== 'lit' && !this.originals.has(mesh)) {
        this.originals.set(mesh, mesh.material);
        mesh.material = Array.isArray(mesh.material)
          ? mesh.material.map((material) => this.replace(material, mesh))
          : this.replace(mesh.material, mesh);
      }
      if (this.wireframeShown) {
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          this.pushBack(material);
        }
      }
    });
  }

  private restore(): void {
    for (const [mesh, material] of this.originals) mesh.material = material;
    this.originals.clear();
    for (const material of this.offset) unpush(material);
    this.offset.clear();
  }

  private replace(material: Material, mesh: Mesh): Material {
    return this.mode === 'unlit' ? this.unlitOf(material) : this.normalsFor(material.side, mesh);
  }

  /** The material's base color and texture, its transparency and sides, without lighting. */
  private unlitOf(material: Material): Material {
    if ((material as MeshBasicMaterial).isMeshBasicMaterial) return material;
    let unlit = this.unlit.get(material);
    if (!unlit) {
      const source = material as MeshStandardMaterial;
      unlit = new MeshBasicMaterial({
        color: source.color ? source.color.clone() : new Color(1, 1, 1),
        map: source.map ?? null,
        alphaMap: source.alphaMap ?? null,
        vertexColors: source.vertexColors,
        transparent: source.transparent,
        opacity: source.opacity,
        alphaTest: source.alphaTest,
        side: source.side,
        depthWrite: source.depthWrite,
      });
      unlit.name = material.name;
      this.unlit.set(material, unlit);
    }
    return unlit;
  }

  /** Surfaces colored by the way they face; flat when the mesh has no normals of its own. */
  private normalsFor(side: Side, mesh: Mesh): Material {
    const flat = !mesh.geometry.hasAttribute('normal');
    const key = `${side === DoubleSide ? 'double' : 'front'}${flat ? ':flat' : ''}`;
    let material = this.normals.get(key);
    if (!material) {
      material = new MeshNormalMaterial({
        side: side === DoubleSide ? DoubleSide : FrontSide,
        flatShading: flat,
      });
      this.normals.set(key, material);
    }
    return material;
  }

  private pushBack(material: Material): void {
    material.polygonOffset = true;
    material.polygonOffsetFactor = 1;
    material.polygonOffsetUnits = 1;
    this.offset.add(material);
  }
}

function unpush(material: Material): void {
  material.polygonOffset = false;
  material.polygonOffsetFactor = 0;
  material.polygonOffsetUnits = 0;
}

/**
 * Whether three.js can build a mesh's wireframe: from its indices, kept in memory for this, or
 * from its vertices, which only skinned and morphed meshes keep once they are on the GPU.
 */
function hasWireframe(mesh: Mesh): boolean {
  if (!mesh.isMesh) return false;
  const { geometry } = mesh;
  return (
    geometry.index !== null ||
    (mesh as Mesh & { isSkinnedMesh?: boolean }).isSkinnedMesh === true ||
    Object.keys(geometry.morphAttributes).length > 0
  );
}
