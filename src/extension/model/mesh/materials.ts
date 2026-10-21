// The materials of an OBJ or PLY file as glTF has them: OBJ's from the MTL libraries it names,
// PLY's from the texture MeshLab writes in its header. Libraries and images are found next to
// the model by the rules glTF's resources follow (D-005), and where a path is absolute or wrong,
// by its file name next to the library and the model.
import { posix } from 'node:path';
import type { SourceFacts } from '../../../shared/protocol';
import { IMAGE_HEADER_BYTES, readImageInfo } from '../imageInfo';
import type { LoadTexts, ResourceProblem, Resources } from '../load';
import type { ByteSource } from '../sources';
import { linearFactor, type ParsedMesh } from './geometry';
import { MAX_MTL_BYTES, parseMtl, type MtlMaterial } from './mtl';
import type { MaterialSpec } from './toGltf';

export interface MeshMaterials {
  /** One for each of the mesh's materials, in order. */
  specs: MaterialSpec[];
  /** URIs of the images the specs use, relative to the model. */
  images: string[];
  /** The file's facts, with each OBJ material's MTL statements. */
  facts: SourceFacts;
  /** What couldn't be found or shown, for the user; resources not found are in `resources`. */
  notices: string[];
}

/** The grey OBJ materials are when a library doesn't say: MTL's own default for Kd. */
const DEFAULT_DIFFUSE = 0.8;

export async function meshMaterials(
  mesh: ParsedMesh,
  resources: Resources,
  texts: LoadTexts,
): Promise<MeshMaterials> {
  const notices: string[] = [];
  const images: string[] = [];
  const imageIndex = new Map<string, number>();

  /** The image a material names, as an index into `images`, if it can be found and shown. */
  const image = async (written: string, folder: string): Promise<number | undefined> => {
    const found = await find(resources, written, folder);
    if (typeof found === 'string') return undefined;
    const head = await found.source.read(0, Math.min(found.source.size, IMAGE_HEADER_BYTES));
    const info = readImageInfo(head);
    // KTX2 needs glTF's own extension; browsers show the rest.
    if (!info || info.format === 'ktx2') {
      notices.push(texts.imageFormat(posix.basename(normalized(written))));
      return undefined;
    }
    let index = imageIndex.get(found.uri);
    if (index === undefined) {
      index = images.push(found.uri) - 1;
      imageIndex.set(found.uri, index);
    }
    return index;
  };

  const libraries = new Map<string, { material: MtlMaterial; library: string }>();
  let librariesRead = true;
  for (const library of mesh.libraries) {
    const found = await find(resources, library, '');
    if (typeof found === 'string') {
      librariesRead = false;
      continue;
    }
    if (found.source.size > MAX_MTL_BYTES) {
      librariesRead = false;
      continue;
    }
    for (const material of parseMtl(await found.source.read(0, found.source.size))) {
      if (!libraries.has(material.name)) libraries.set(material.name, { material, library });
    }
  }

  if (mesh.facts.format === 'obj' && mesh.materials.length === 0 && libraries.size === 1) {
    adoptOnlyMaterial(mesh, [...libraries.keys()][0]);
  }

  const specs: MaterialSpec[] = [];
  const statements: { library?: string; statements: [string, string][] }[] = [];
  const missing: string[] = [];
  for (const { name, texture } of mesh.materials) {
    if (texture !== undefined) {
      // PLY: the texture over the vertices' own colors, as MeshLab shows it.
      specs.push({
        name,
        baseColor: [1, 1, 1, 1],
        metallic: 0,
        roughness: 0.5,
        baseColorTexture: await image(texture, ''),
      });
      statements.push({ statements: [] });
      continue;
    }
    const entry = libraries.get(name);
    if (!entry) missing.push(name);
    statements.push(
      entry
        ? { library: entry.library, statements: entry.material.statements }
        : { statements: [] },
    );
    specs.push(
      await materialSpec(name, entry?.material, (written) =>
        image(written, posix.dirname(normalized(entry!.library))),
      ),
    );
  }
  // Only when every library was read: a missing one is said already.
  if (missing.length > 0 && mesh.libraries.length > 0 && librariesRead) {
    notices.push(texts.missingMaterials(listed(missing)));
  }
  const facts: SourceFacts =
    mesh.facts.format === 'obj' ? { ...mesh.facts, materials: statements } : mesh.facts;
  return { specs, images, facts, notices };
}

/** An MTL material as glTF's metallic-roughness one, as Blender imports it. */
async function materialSpec(
  name: string,
  mtl: MtlMaterial | undefined,
  image: (written: string) => Promise<number | undefined>,
): Promise<MaterialSpec> {
  const diffuse = mtl?.diffuse ?? [DEFAULT_DIFFUSE, DEFAULT_DIFFUSE, DEFAULT_DIFFUSE];
  const opacity = Math.min(1, Math.max(0, mtl?.opacity ?? 1));
  const baseColorTexture = mtl?.maps.diffuse ? await image(mtl.maps.diffuse) : undefined;
  const shininess = mtl?.shininess;
  const spec: MaterialSpec = {
    name,
    // With an image, Kd is often a placeholder exporters write; the image is the color.
    baseColor:
      baseColorTexture !== undefined
        ? [1, 1, 1, opacity]
        : [linearFactor(diffuse[0]), linearFactor(diffuse[1]), linearFactor(diffuse[2]), opacity],
    metallic: clamp(mtl?.metallic ?? 0),
    roughness: clamp(
      mtl?.roughness ??
        (shininess !== undefined
          ? 1 - Math.sqrt(Math.min(1000, Math.max(0, shininess)) / 1000)
          : 0.5),
    ),
  };
  if (baseColorTexture !== undefined) spec.baseColorTexture = baseColorTexture;
  if (mtl?.emissive) spec.emissive = mtl.emissive.map(linearFactor) as [number, number, number];
  if (mtl?.maps.emissive) spec.emissiveTexture = await image(mtl.maps.emissive);
  if (mtl?.maps.normal) spec.normalTexture = await image(mtl.maps.normal);
  return spec;
}

/**
 * An OBJ file with a material library and no `usemtl` at all, its library defining a single
 * material: the faces are taken to be in that material, as Open3D reads them.
 */
function adoptOnlyMaterial(mesh: ParsedMesh, name: string): void {
  const index = mesh.materials.push({ name }) - 1;
  const visit = (objects: ParsedMesh['objects']) => {
    for (const object of objects) {
      for (const part of object.parts) {
        if (part.mode === 'triangles' && part.material === undefined) part.material = index;
      }
      visit(object.children);
    }
  };
  visit(mesh.objects);
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** Names in a sentence: the first few, then how many more. */
function listed(names: readonly string[]): string {
  const shown = names.slice(0, 5).join(', ');
  return names.length > 5 ? `${shown} (+${names.length - 5})` : shown;
}

/** A path as written, with Windows' backslashes as slashes. */
function normalized(written: string): string {
  return written.trim().replace(/\\/g, '/');
}

/**
 * Finds a file a model or library names, `written` relative to `folder` (relative to the
 * model's own): as written, then by its file name next to the library and the model. Absolute
 * paths are only tried that way. The URI found, or the problem with the path as written.
 */
async function find(
  resources: Resources,
  written: string,
  folder: string,
): Promise<{ uri: string; source: ByteSource } | ResourceProblem> {
  const path = normalized(written);
  const absolute = /^([a-z]:)?\//i.test(path);
  const name = posix.basename(path);
  const candidates = [
    ...(absolute ? [] : [posix.join(folder, path)]),
    posix.join(folder, name),
    name,
  ].filter((candidate, index, all) => candidate && all.indexOf(candidate) === index);
  let first: ResourceProblem | undefined;
  for (const candidate of candidates) {
    const uri = candidate.split('/').map(encodeURIComponent).join('/');
    const result = await resources.open(uri);
    if (typeof result !== 'string') return { uri, source: result };
    first ??= result;
  }
  const problem = absolute ? 'absolute' : (first ?? 'missing');
  resources.problem(written, problem, name || written);
  return problem;
}
