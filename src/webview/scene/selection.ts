import {
  Box3,
  Box3Helper,
  Group,
  LineBasicMaterial,
  SRGBColorSpace,
  Vector3,
  type Material,
  type Mesh,
  type Object3D,
  type Texture,
} from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Past this many boxes, one box around them all says as much and draws faster. */
const BOX_LIMIT = 300;

/**
 * What each structure entry stands for in the drawn scene: `node:3` its node, `mesh:2` the nodes
 * that use that mesh, `material:5` the primitives drawn with it. Built from the loader's own
 * record of which glTF object made which three.js object.
 */
export class SelectionIndex {
  private readonly byKey = new Map<string, Object3D[]>();
  private readonly nodeOf = new Map<Object3D, number>();
  private readonly textures = new Map<number, Texture>();

  constructor(gltf: GLTF) {
    const associations = gltf.parser.associations;
    const add = (key: string, object: Object3D) => {
      const list = this.byKey.get(key);
      if (!list) this.byKey.set(key, [object]);
      else if (!list.includes(object)) list.push(object);
    };
    for (const [owner, association] of associations) {
      if ((owner as Texture).isTexture && association.textures !== undefined) {
        this.textures.set(association.textures, owner as Texture);
      }
    }
    gltf.scene.traverse((object) => {
      const association = associations.get(object);
      if (association?.nodes !== undefined) {
        add(`node:${association.nodes}`, object);
        this.nodeOf.set(object, association.nodes);
      }
      if (association?.meshes !== undefined) {
        // A mesh with one primitive is its node's object; with more, they share a group.
        const owner = association.nodes !== undefined ? object : (object.parent ?? object);
        add(`mesh:${association.meshes}`, owner);
      }
      const material = (object as Partial<Mesh>).material;
      for (const item of Array.isArray(material) ? material : material ? [material] : []) {
        const index = associations.get(item as Material)?.materials;
        if (index !== undefined) add(`material:${index}`, object);
      }
    });
  }

  /** The loaded texture for a glTF texture index. */
  texture(index: number): Texture | undefined {
    return this.textures.get(index);
  }

  objects(key: string): Object3D[] {
    return this.byKey.get(key) ?? [];
  }

  /** The node an object was drawn for: its own, or the closest one above it. */
  node(object: Object3D): number | undefined {
    for (let current: Object3D | null = object; current; current = current.parent) {
      const node = this.nodeOf.get(current);
      if (node !== undefined) return node;
    }
    return undefined;
  }
}

/** World-space bounds of `objects`, as their geometry's precomputed boxes give them. */
export function boundsOf(objects: readonly Object3D[]): Box3 {
  const box = new Box3();
  for (const object of objects) box.expandByObject(object);
  return box;
}

/**
 * Boxes around what is selected. Edges in front of the model are drawn solid and the ones it
 * hides faintly, through it, so a box shows where it is and how deep. Objects with nothing to
 * draw (a camera, a light) get no box.
 */
export class Highlight {
  readonly group = new Group();
  private readonly front = new LineBasicMaterial({ toneMapped: false });
  private readonly behind = new LineBasicMaterial({
    toneMapped: false,
    transparent: true,
    opacity: 0.35,
    depthTest: false,
    depthWrite: false,
  });

  constructor() {
    this.group.name = 'Nightmesh selection';
    this.setColor([0, 120 / 255, 212 / 255]);
  }

  /** The theme's focus color, as sRGB channels from 0 to 1. */
  setColor([r, g, b]: readonly [number, number, number]): void {
    for (const material of [this.front, this.behind])
      material.color.setRGB(r, g, b, SRGBColorSpace);
  }

  show(objects: readonly Object3D[]): void {
    this.clear();
    const boxes =
      objects.length > BOX_LIMIT
        ? [boundsOf(objects)]
        : objects.map((object) => new Box3().setFromObject(object));
    for (const box of boxes) {
      if (box.isEmpty()) continue;
      // A little larger than the bounds, so edges don't fight the faces they'd lie on.
      box.expandByScalar(Math.max(box.getSize(new Vector3()).length() * 0.005, 1e-5));
      for (const material of [this.front, this.behind]) {
        const helper = new Box3Helper(box);
        (helper.material as Material).dispose();
        helper.material = material;
        // Drawn after the model: Infinity would make the renderer's sort compare NaN.
        helper.renderOrder = 1e9;
        this.group.add(helper);
      }
    }
  }

  clear(): void {
    for (const child of [...this.group.children]) {
      (child as Box3Helper).geometry.dispose();
      this.group.remove(child);
    }
  }

  dispose(): void {
    this.clear();
    this.front.dispose();
    this.behind.dispose();
  }
}

/** Bounds for framing `objects`; ones with nothing to draw count as a small box where they are. */
export function framingBounds(objects: readonly Object3D[], modelRadius: number): Box3 {
  const box = boundsOf(objects);
  if (!box.isEmpty()) return box;
  const around = new Box3();
  const size = new Vector3().setScalar(Math.max(modelRadius * 0.1, 1e-3));
  for (const object of objects) {
    const position = object.getWorldPosition(new Vector3());
    around.expandByPoint(position.clone().sub(size)).expandByPoint(position.add(size));
  }
  return around;
}
