// Points that a pnts tile compresses with Draco (3DTILES_draco_point_compression), decoded with the
// same WebAssembly build the webview decodes glTF meshes with, started once a thread needs it.
import { compileFunction } from 'node:vm';
import wrapper from 'inline-text:three/examples/jsm/libs/draco/draco_wasm_wrapper.js';
import wasm from 'inline-binary:three/examples/jsm/libs/draco/draco_decoder.wasm';
import type { DecodedPoints, PointDecoder } from './pnts';

/** The parts of the decoder's API used here. */
interface DracoModule {
  Decoder: new () => DracoDecoder;
  PointCloud: new () => DracoObject & { num_points(): number };
  POINT_CLOUD: number;
  DT_FLOAT32: number;
  DT_UINT8: number;
  HEAPU8: Uint8Array;
  _malloc(bytes: number): number;
  _free(pointer: number): void;
  destroy(object: DracoObject): void;
}

interface DracoObject {
  ptr: number;
}

interface DracoAttribute extends DracoObject {
  num_components(): number;
}

interface DracoDecoder extends DracoObject {
  GetEncodedGeometryType(data: Int8Array): number;
  DecodeArrayToPointCloud(
    data: Int8Array,
    bytes: number,
    cloud: DracoObject,
  ): DracoObject & { ok(): boolean; error_msg(): string };
  GetAttributeByUniqueId(cloud: DracoObject, id: number): DracoAttribute;
  GetAttributeDataArrayForAllPoints(
    cloud: DracoObject,
    attribute: DracoAttribute,
    type: number,
    bytes: number,
    pointer: number,
  ): boolean;
}

/** What a compressed point property decodes to: numbers for positions and normals, bytes for colors. */
const KINDS: Readonly<Record<keyof DecodedPoints, { components: number; float: boolean }>> = {
  POSITION: { components: 3, float: true },
  NORMAL: { components: 3, float: true },
  RGB: { components: 3, float: false },
  RGBA: { components: 4, float: false },
};

// Wrapped, as the module is a thenable: resolving with it would wait on it again.
let started: Promise<{ draco: DracoModule }> | undefined;

/**
 * The decoder module. Its glue is told there is no `process`, so it doesn't reach for Node's file
 * system: the WebAssembly is handed to it.
 */
async function decoder(): Promise<DracoModule> {
  started ??= new Promise((resolve, reject) => {
    const factory = compileFunction(`${wrapper}\nreturn DracoDecoderModule;`, ['process'])(
      undefined,
    ) as (options: object) => PromiseLike<DracoModule>;
    factory({ wasmBinary: wasm }).then((draco) => resolve({ draco }), reject);
  });
  return (await started).draco;
}

/**
 * Decodes the points of `data`, a Draco point cloud, keeping the `properties` (feature table names
 * to Draco's attribute ids) that are drawn. Throws when the data isn't `points` points or a
 * property isn't there as the tile says.
 */
export const decodePoints: PointDecoder = async (data, properties, points) => {
  const draco = await decoder();
  const bytes = new Int8Array(data.buffer, data.byteOffset, data.byteLength);
  const dracoDecoder = new draco.Decoder();
  const cloud = new draco.PointCloud();
  try {
    if (dracoDecoder.GetEncodedGeometryType(bytes) !== draco.POINT_CLOUD) {
      throw new Error('not a Draco point cloud');
    }
    const status = dracoDecoder.DecodeArrayToPointCloud(bytes, bytes.length, cloud);
    if (!status.ok()) throw new Error(status.error_msg());
    if (cloud.num_points() !== points) {
      throw new Error(`${cloud.num_points()} points, the tile says ${points}`);
    }
    const decoded: Record<string, Float32Array | Uint8Array> = {};
    for (const [name, kind] of Object.entries(KINDS)) {
      const id = properties[name];
      if (typeof id !== 'number') continue;
      const attribute = dracoDecoder.GetAttributeByUniqueId(cloud, id);
      if (!attribute.ptr || attribute.num_components() !== kind.components) {
        throw new Error(`no ${name} with id ${id}`);
      }
      const values = points * kind.components;
      const size = values * (kind.float ? 4 : 1);
      const pointer = draco._malloc(size);
      try {
        dracoDecoder.GetAttributeDataArrayForAllPoints(
          cloud,
          attribute,
          kind.float ? draco.DT_FLOAT32 : draco.DT_UINT8,
          size,
          pointer,
        );
        // The module's memory may have grown while decoding: its view is read after.
        decoded[name] = kind.float
          ? new Float32Array(draco.HEAPU8.buffer, pointer, values).slice()
          : draco.HEAPU8.slice(pointer, pointer + values);
      } finally {
        draco._free(pointer);
      }
    }
    return decoded as DecodedPoints;
  } finally {
    draco.destroy(cloud);
    draco.destroy(dracoDecoder);
  }
};
