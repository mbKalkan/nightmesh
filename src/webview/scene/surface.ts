// What EXT_mesh_features and EXT_structural_metadata give a primitive, as the 3D Tiles renderer's
// glTF plugins attach it to the object they make (`userData.meshFeatures` and
// `userData.structuralMetadata`), and what the picker reads for it under the pointer. Only the
// shapes are named here: the renderer's code loads with the plugins.
import type { Object3D, Texture } from 'three';
import type { Probe } from './picking';

/** A feature ID set of a primitive, with the renderer's defaults filled in. */
export interface FeatureIdSet {
  featureCount: number;
  label: string | null;
  propertyTable: number | null;
  nullFeatureId: number | null;
  attribute?: number;
  texture?: { index: number; texCoord: number; channels: number[] };
}

export interface MeshFeatures {
  featureIds: FeatureIdSet[];
  /** The glTF's textures, by index, where feature IDs are read from them. */
  textures: (Texture | null)[];
}

/** A property of a class, as a property table, texture or attribute gives it. */
export interface MetadataProperty {
  type: string;
  componentType: string | null;
  array: boolean;
  count: number | null;
  /** A property texture's: which texture, by its glTF index, and which channels. */
  index?: number | null;
  texCoord?: number | null;
  channels?: number[];
  /** A property attribute's: which attribute. */
  attribute?: string | null;
}

export interface PropertySet {
  name: string | null;
  count?: number;
  definition: { class: string; properties: Record<string, unknown> };
  /** Every property of the class, given by the set or not. */
  properties: Record<string, MetadataProperty>;
}

export interface PropertyTextureSet extends PropertySet {
  /** The glTF's textures, by index. */
  data: (Texture | null)[];
}

export interface StructuralMetadata {
  tableAccessors: PropertySet[];
  textureAccessors: PropertyTextureSet[];
  attributeAccessors: PropertySet[];
  getPropertyTableData(table: number, id: number): Record<string, unknown>;
}

export interface SurfaceMetadata {
  features?: MeshFeatures;
  metadata?: StructuralMetadata;
}

/** What an object's primitive has of EXT_mesh_features and EXT_structural_metadata, if any. */
export function surfaceMetadata(object: Object3D): SurfaceMetadata | undefined {
  const { meshFeatures, structuralMetadata } = object.userData as {
    meshFeatures?: MeshFeatures;
    structuralMetadata?: StructuralMetadata;
  };
  const features = meshFeatures?.featureIds.length ? meshFeatures : undefined;
  // Property tables are read through feature IDs; textures and attributes on their own.
  const readable =
    features ||
    structuralMetadata?.textureAccessors.length ||
    structuralMetadata?.attributeAccessors.length;
  return readable ? { features, metadata: structuralMetadata } : undefined;
}

/** The probe that reads a feature ID set's feature, if it can be read. */
export function featureProbe(set: FeatureIdSet, textures: MeshFeatures['textures']) {
  if (set.texture) {
    const texture = textures[set.texture.index];
    return texture ? texelProbe(texture, set.texture.index, set.texture.texCoord) : undefined;
  }
  if (set.attribute !== undefined) {
    const attribute = `_feature_id_${set.attribute}`;
    return { key: `attribute:${attribute}`, attribute } satisfies Probe;
  }
  // Without either, a vertex is its own feature.
  return VERTEX;
}

/** The probe that reads a property texture's property, if it can be read. */
export function propertyProbe(set: PropertyTextureSet, property: MetadataProperty) {
  const index = property.index;
  const texture = index === null || index === undefined ? undefined : set.data[index];
  return texture ? texelProbe(texture, index!, property.texCoord ?? 0) : undefined;
}

export const VERTEX = { key: 'vertex', vertex: true } as const satisfies Probe;

const texelProbe = (texture: Texture, index: number, texCoord: number): Probe => ({
  key: `texel:${index}:${texCoord}`,
  texture,
  texCoord,
});

/** Everything the picker reads to tell what an object's metadata says at a point of it. */
export function surfaceProbes(object: Object3D): Probe[] | undefined {
  const surface = surfaceMetadata(object);
  if (!surface) return undefined;
  const probes: Probe[] = [];
  const add = (probe: Probe | undefined) => probe && probes.push(probe);
  for (const set of surface.features?.featureIds ?? []) {
    add(featureProbe(set, surface.features!.textures));
  }
  for (const set of surface.metadata?.textureAccessors ?? []) {
    for (const name of Object.keys(set.definition.properties)) {
      const property = set.properties[name];
      if (property) add(propertyProbe(set, property));
    }
  }
  if (surface.metadata?.attributeAccessors.length) add(VERTEX);
  return probes;
}
