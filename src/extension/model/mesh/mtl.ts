// MTL, the material libraries OBJ files name: what each material says, as written, and the parts
// that become glTF's metallic-roughness material.
import { decodeText } from './text';

export interface MtlMaterial {
  name: string;
  /** Every statement as written, for the inspector. */
  statements: [string, string][];
  /** Kd, as sRGB. */
  diffuse?: [number, number, number];
  /** d, or 1 − Tr. */
  opacity?: number;
  /** Ns: the Phong exponent, 0 to 1000. */
  shininess?: number;
  /** Pr and Pm, from the PBR extension to MTL. */
  roughness?: number;
  metallic?: number;
  /** Ke, as sRGB. */
  emissive?: [number, number, number];
  /** Images, as written, relative to the library. */
  maps: { diffuse?: string; emissive?: string; normal?: string };
}

/** Options texture statements may have before the file name, with how many values each takes. */
const OPTIONS: Readonly<Record<string, [number, number]>> = {
  blendu: [1, 1],
  blendv: [1, 1],
  boost: [1, 1],
  mm: [2, 2],
  o: [1, 3],
  s: [1, 3],
  t: [1, 3],
  texres: [1, 1],
  clamp: [1, 1],
  bm: [1, 1],
  imfchan: [1, 1],
  type: [1, 1],
  cc: [1, 1],
};

/** Libraries larger than this aren't read: real ones are a few kilobytes. */
export const MAX_MTL_BYTES = 16 * 1024 * 1024;

export function parseMtl(bytes: Uint8Array): MtlMaterial[] {
  const materials: MtlMaterial[] = [];
  let material: MtlMaterial | undefined;
  for (const raw of decodeText(bytes).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const space = line.search(/\s/);
    const keyword = space < 0 ? line : line.slice(0, space);
    const value = space < 0 ? '' : line.slice(space).trim();
    if (keyword === 'newmtl') {
      material = { name: value, statements: [], maps: {} };
      materials.push(material);
      continue;
    }
    if (!material) continue;
    material.statements.push([keyword, value]);
    const numbers = value ? value.split(/\s+/).map(Number) : [];
    const color = (): [number, number, number] | undefined => {
      if (numbers.length < 1 || numbers.some((number) => !Number.isFinite(number)))
        return undefined;
      // One value is grey, as the format allows.
      return [numbers[0], numbers[1] ?? numbers[0], numbers[2] ?? numbers[0]];
    };
    const scalar = () => (Number.isFinite(numbers[0]) ? numbers[0] : undefined);
    switch (keyword.toLowerCase()) {
      case 'kd':
        material.diffuse = color() ?? material.diffuse;
        break;
      case 'ke':
        material.emissive = color() ?? material.emissive;
        break;
      case 'd':
        material.opacity = scalar() ?? material.opacity;
        break;
      case 'tr': {
        const transparency = scalar();
        if (transparency !== undefined) material.opacity = 1 - transparency;
        break;
      }
      case 'ns':
        material.shininess = scalar() ?? material.shininess;
        break;
      case 'pr':
        material.roughness = scalar() ?? material.roughness;
        break;
      case 'pm':
        material.metallic = scalar() ?? material.metallic;
        break;
      case 'map_kd':
        material.maps.diffuse = textureFile(value) ?? material.maps.diffuse;
        break;
      case 'map_ke':
        material.maps.emissive = textureFile(value) ?? material.maps.emissive;
        break;
      case 'map_bump':
      case 'bump':
      case 'norm':
        material.maps.normal = textureFile(value) ?? material.maps.normal;
        break;
    }
  }
  return materials;
}

/** The file a texture statement names, after its options (`-bm 0.5`, `-s 1 1 1`…). */
export function textureFile(value: string): string | undefined {
  const words = value.split(/\s+/).filter(Boolean);
  let at = 0;
  while (at < words.length && words[at].startsWith('-') && OPTIONS[words[at].slice(1)]) {
    const [least, most] = OPTIONS[words[at].slice(1)];
    at++;
    let taken = 0;
    while (taken < most && at < words.length) {
      // Past the values an option must have, more are taken only while they are numbers.
      if (taken >= least && !Number.isFinite(Number(words[at]))) break;
      at++;
      taken++;
    }
  }
  const name = words.slice(at).join(' ');
  return name || undefined;
}
