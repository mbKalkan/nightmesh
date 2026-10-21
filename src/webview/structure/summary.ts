// A model in short, to compare it with another version of itself: what is in it, keyed by name
// so the two sides can be matched, and what each thing is, written so that equal things read the
// same. Built from the JSON and what the host measured; geometry by its counts and bounds.
import type {
  ImageInfo,
  MeshCheck,
  ModelSummary,
  Motion,
  SummaryCollection,
  SummaryEntry,
} from '../../shared/protocol';
import { sizeOf } from './bounds';
import { isObject, num, numbers, objects, text, type GltfModel, type JsonObject } from './gltf';
import { statistics } from './statistics';

export interface SummaryInputs {
  fileSize: number;
  images?: readonly (ImageInfo | null)[];
  /** Each image's own bytes. */
  imageBytes?: readonly (number | null)[];
  motion?: readonly (Motion | null)[];
  check?: MeshCheck;
}

export function summarize(model: GltfModel, inputs: SummaryInputs): ModelSummary {
  const counts = statistics(model, inputs.images, inputs.motion);
  const keys = {
    meshes: names(model, 'meshes'),
    materials: names(model, 'materials'),
    textures: textureNames(model),
    nodes: nodePaths(model),
  };
  const texture = (index: unknown) =>
    typeof index === 'number' ? (keys.textures[index] ?? `#${index}`) : '';

  const entries: Record<SummaryCollection, SummaryEntry[]> = {
    nodes: model.items('nodes').map((node, index) => ({
      key: keys.nodes[index],
      index,
      facets: {
        transform: transform(node),
        mesh: meshKey(keys.meshes, node.mesh),
        camera: node.camera === undefined ? '' : String(node.camera),
        visible: model.extension(node, 'KHR_node_visibility')?.visible === false ? 'no' : '',
      },
    })),
    meshes: model.items('meshes').map((mesh, index) => ({
      key: keys.meshes[index],
      index,
      facets: {
        primitives: objects(mesh.primitives)
          .map((primitive) => primitiveText(model, primitive, keys.materials))
          .join(' | '),
        bounds: objects(mesh.primitives)
          .map((primitive) => boundsText(model, primitive))
          .join(' | '),
      },
    })),
    materials: model.items('materials').map((material, index) => ({
      key: keys.materials[index],
      index,
      facets: materialFacets(material, texture),
    })),
    textures: model.items('textures').map((item, index) => {
      const image = model.ref('images', item.source);
      const info = image !== undefined ? inputs.images?.[image] : undefined;
      const bytes = image !== undefined ? inputs.imageBytes?.[image] : undefined;
      return {
        key: keys.textures[index],
        index,
        facets: {
          image: [
            image !== undefined ? imageName(model, image) : '',
            info ? `${info.width}×${info.height}` : '',
            bytes ? `${bytes} B` : '',
          ].join(' '),
          sampler: canonical(model.item('samplers', model.ref('samplers', item.sampler))),
        },
      };
    }),
    animations: model.items('animations').map((animation, index) => ({
      key: names(model, 'animations')[index],
      index,
      facets: {
        channels: objects(animation.channels)
          .map((channel) => {
            const target = isObject(channel.target) ? channel.target : {};
            const node = model.ref('nodes', target.node);
            return `${node !== undefined ? keys.nodes[node] : ''}.${text(target.path) ?? ''}`;
          })
          .sort()
          .join(', '),
        duration: round(longest(model, animation)),
      },
    })),
  };

  return {
    totals: {
      fileSize: inputs.fileSize,
      nodes: counts.nodes,
      drawCalls: counts.drawCalls,
      vertices: counts.vertices,
      triangles: counts.triangles,
      materials: counts.materials,
      textures: counts.textures,
    },
    dimensions: counts.bounds && sizeOf(counts.bounds),
    check: inputs.check,
    ...entries,
  };
}

/** Names for a collection's items: their own, made unique, or their index. */
function names(model: GltfModel, collection: 'meshes' | 'materials' | 'animations'): string[] {
  return unique(
    model.items(collection).map((_, index) => model.name(collection, index) ?? `#${index}`),
  );
}

/** A texture is named for itself, or else for its image. */
function textureNames(model: GltfModel): string[] {
  return unique(
    model.items('textures').map((item, index) => {
      const image = model.ref('images', item.source);
      return (
        model.name('textures', index) ??
        (image !== undefined ? imageName(model, image) : undefined) ??
        `#${index}`
      );
    }),
  );
}

function imageName(model: GltfModel, image: number): string {
  const item = model.items('images')[image] ?? {};
  return model.name('images', image) ?? text(item.uri)?.split('/').pop() ?? `#${image}`;
}

/** Each node by the names on the way to it from the top: `Car/Body/Wheel`. */
function nodePaths(model: GltfModel): string[] {
  const nodes = model.items('nodes');
  const paths: string[] = new Array<string>(nodes.length);
  const visit = (node: number, above: string, siblings: Map<string, number>) => {
    if (paths[node] !== undefined) return;
    const name = model.name('nodes', node) ?? `#${node}`;
    // Siblings with the same name are told apart by their order.
    const seen = (siblings.get(name) ?? 0) + 1;
    siblings.set(name, seen);
    paths[node] = `${above}${name}${seen > 1 ? ` (${seen})` : ''}`;
    const below = new Map<string, number>();
    for (const child of model.children(node)) visit(child, `${paths[node]}/`, below);
  };
  const tops = new Map<string, number>();
  for (const root of model.items('scenes').flatMap((_, scene) => model.sceneRoots(scene))) {
    visit(root, '', tops);
  }
  for (const root of model.unreachedRoots()) visit(root, '', tops);
  return paths.map((path, node) => path ?? `#${node}`);
}

function unique(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return count > 1 ? `${name} (${count})` : name;
  });
}

const meshKey = (keys: readonly string[], mesh: unknown) =>
  typeof mesh === 'number' ? (keys[mesh] ?? `#${mesh}`) : '';

function transform(node: JsonObject): string {
  const matrix = numbers(node.matrix, 16);
  if (matrix) return `matrix ${matrix.map(round).join(' ')}`;
  return ['translation', 'rotation', 'scale']
    .map((property) => numbers(node[property]))
    .map((values) => values?.map(round).join(' ') ?? '')
    .join(' / ');
}

/** A primitive's mode, attributes with their counts, indices and material. */
function primitiveText(model: GltfModel, primitive: JsonObject, materials: string[]): string {
  const count = (accessor: unknown) =>
    num(model.item('accessors', model.ref('accessors', accessor))?.count) ?? 0;
  const attributes = isObject(primitive.attributes) ? primitive.attributes : {};
  const listed = Object.keys(attributes)
    .sort()
    .map((name) => `${name}:${count(attributes[name])}`)
    .join(',');
  const indices = primitive.indices !== undefined ? count(primitive.indices) : '';
  const material =
    typeof primitive.material === 'number' ? (materials[primitive.material] ?? '') : '';
  const targets = objects(primitive.targets).length;
  return `${num(primitive.mode) ?? 4} ${listed} ${indices} ${material} ${targets}`;
}

/** Where a primitive's vertices are: its POSITION bounds, which glTF requires. */
function boundsText(model: GltfModel, primitive: JsonObject): string {
  const attributes = isObject(primitive.attributes) ? primitive.attributes : {};
  const accessor = model.item('accessors', model.ref('accessors', attributes.POSITION));
  const min = numbers(accessor?.min, 3);
  const max = numbers(accessor?.max, 3);
  return min && max ? `${min.map(round).join(' ')} ${max.map(round).join(' ')}` : '';
}

/** A material's properties in groups, with texture references by the texture's name. */
function materialFacets(
  material: JsonObject,
  texture: (index: unknown) => string,
): Record<string, string> {
  const { name: _name, extras: _extras, extensions, ...core } = material;
  const facets: Record<string, string> = {};
  for (const [property, value] of Object.entries(core)) {
    facets[property] = canonical(value, texture);
  }
  if (isObject(extensions)) {
    for (const [name, value] of Object.entries(extensions))
      facets[name] = canonical(value, texture);
  }
  return facets;
}

/**
 * A value as text that is the same for equal values: keys in order, numbers to six significant
 * digits, and a texture's index as its name, since indices shift between versions.
 */
function canonical(value: unknown, texture?: (index: unknown) => string): string {
  if (value === undefined) return '';
  if (typeof value === 'number') return round(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item, texture)).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => {
        const item = value[key];
        // A texture reference: `{ index, texCoord }` under a material's texture properties.
        if (key === 'index' && texture && typeof item === 'number')
          return `texture:${texture(item)}`;
        return `${key}:${canonical(item, texture)}`;
      })
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const round = (value: number | undefined): string =>
  value === undefined || !Number.isFinite(value) ? '' : String(Number(value.toPrecision(6)));

/** The last keyframe time of an animation's samplers, in seconds. */
function longest(model: GltfModel, animation: JsonObject): number | undefined {
  let last: number | undefined;
  for (const sampler of objects(animation.samplers)) {
    const input = model.item('accessors', model.ref('accessors', sampler.input));
    const max = numbers(input?.max)?.[0];
    if (max !== undefined) last = Math.max(last ?? max, max);
  }
  return last;
}
