// Tells, from an animation's keyframes, whether it moves anything: exporters sometimes write a
// clip with two identical keys per channel, which plays without anything moving.
import type { Motion } from '../../shared/protocol';
import { AccessorReader, type Accessor } from './accessors';
import type { Gltf, Part } from './plan';

/** Keyframe data read to tell, over all of a model's animations; past it, motion is unknown. */
export const MOTION_BYTES = 32 * 1024 * 1024;

/** Values closer than this count as the same. */
const EPSILON = 1e-5;

interface Channel {
  sampler?: number;
  target?: { node?: number; path?: string };
}

interface Sampler {
  input?: number;
  output?: number;
  interpolation?: string;
}

interface Node {
  mesh?: number;
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  weights?: number[];
}

/**
 * For each animation, by index: `moves` when some channel's value changes over time, `holds` when
 * none does but some differ from the rest pose the nodes have in the file, `none` when every
 * keyframe matches that rest pose, and null when it can't be told (compressed or sparse data,
 * animation pointers, or past the read budget).
 */
export async function animationMotion(plan: {
  json: Gltf;
  parts: Part[];
}): Promise<(Motion | null)[]> {
  const json = plan.json as Gltf & {
    accessors?: Accessor[];
    nodes?: Node[];
    meshes?: { weights?: number[] }[];
  };
  const reader = new AccessorReader(json, plan.parts, MOTION_BYTES);
  const read = (index: number | undefined) => reader.read(index);

  const results: (Motion | null)[] = [];
  for (const animation of json.animations ?? []) {
    const channels = animation.channels as Channel[];
    const samplers = animation.samplers as Sampler[];
    // Left with no channels: the render plan emptied it, its data couldn't be loaded.
    if (channels.length === 0) {
      results.push(null);
      continue;
    }
    let moves = false;
    let differs = false;
    let unknown = false;
    for (const channel of channels) {
      const sampler = samplers[channel.sampler ?? -1];
      const node = json.nodes?.[channel.target?.node ?? -1];
      const path = channel.target?.path;
      const input = sampler && (json.accessors?.[sampler.input ?? -1]?.count ?? 0);
      const output = sampler && (await read(sampler.output));
      if (!sampler || !node || !path || !input || !output || node.matrix) {
        unknown = true;
        continue;
      }
      const cubic = sampler.interpolation === 'CUBICSPLINE';
      const width = output.length / input / (cubic ? 3 : 1);
      if (!Number.isInteger(width) || width < 1) {
        unknown = true;
        continue;
      }
      const value = (key: number) => {
        const start = key * width * (cubic ? 3 : 1) + (cubic ? width : 0);
        return output.slice(start, start + width);
      };
      // Tangents that aren't zero curve the motion between keys even when the keys agree.
      if (
        cubic &&
        output.some((tangent, i) => Math.floor(i / width) % 3 !== 1 && Math.abs(tangent) > EPSILON)
      ) {
        moves = true;
        break;
      }
      const first = value(0);
      for (let key = 1; key < input && !moves; key++) {
        if (!same(value(key), first, path === 'rotation')) moves = true;
      }
      if (moves) break;
      const rest = restValue(json, node, path, width);
      if (!rest) unknown = true;
      else if (!same(first, rest, path === 'rotation')) differs = true;
    }
    results.push(moves ? 'moves' : unknown ? null : differs ? 'holds' : 'none');
  }
  return results;
}

/** What a node has for an animated path when no animation plays. */
function restValue(
  json: { meshes?: { weights?: number[] }[] },
  node: Node,
  path: string,
  width: number,
): number[] | undefined {
  switch (path) {
    case 'translation':
      return node.translation ?? [0, 0, 0];
    case 'rotation':
      return node.rotation ?? [0, 0, 0, 1];
    case 'scale':
      return node.scale ?? [1, 1, 1];
    case 'weights':
      return (
        node.weights ?? json.meshes?.[node.mesh ?? -1]?.weights ?? new Array<number>(width).fill(0)
      );
    default:
      return undefined;
  }
}

/** Whether two values match; for rotations q and -q are the same turn. */
function same(a: readonly number[], b: readonly number[], rotation: boolean): boolean {
  if (a.length !== b.length) return false;
  if (rotation) {
    const dot = a.reduce((sum, value, i) => sum + value * b[i], 0);
    return 1 - Math.abs(dot) < EPSILON;
  }
  return a.every((value, i) => Math.abs(value - b[i]) <= EPSILON * Math.max(1, Math.abs(b[i])));
}
