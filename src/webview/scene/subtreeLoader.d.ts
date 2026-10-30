// 3DTilesRendererJS's loader of implicit tiling subtrees, which its package exports only as source.
declare module '3d-tiles-renderer/src/core/plugins/SUBTREELoader.js' {
  export class SUBTREELoader {
    constructor(tile: object);
    workingPath: string | null;
    fetchOptions: object;
    parse(buffer: ArrayBuffer): Promise<void>;
    getBit(bitstream: unknown, index: number): boolean;
    expandSubtree(subtreeRoot: { children: object[] }, subtree: unknown): void;
    deriveChildTile(
      subtree: unknown,
      parentTile: object,
      childBitIndex: number | null,
      childMortonIndex: number,
    ): object;
  }
}
