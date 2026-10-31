// The triangles of an OBJ, STL or PLY file, for the check of `shared/meshCheck`.
import type { MeshObject, MeshPart, ParsedMesh } from './geometry';

/** The parts of a mesh that are triangles, in every object. */
export function trianglesOf(mesh: ParsedMesh): MeshPart[] {
  const found: MeshPart[] = [];
  const visit = (objects: readonly MeshObject[]) => {
    for (const object of objects) {
      found.push(...object.parts.filter((part) => part.mode === 'triangles'));
      visit(object.children);
    }
  };
  visit(mesh.objects);
  return found;
}
