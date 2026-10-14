// Reads an image's size from the first bytes of its file, without decoding it: enough to show
// texture sizes and estimate GPU memory as soon as a model opens.

import type { ImageInfo } from '../../shared/protocol';

/** Bytes read from the start of an image; JPEG's size can follow a long EXIF block. */
export const IMAGE_HEADER_BYTES = 256 * 1024;

/** The largest side accepted; anything bigger is a damaged header. */
const MAX_SIDE = 1 << 16;

/** The size and format of the image starting at `bytes`, or undefined if it can't be told. */
export function readImageInfo(bytes: Uint8Array): ImageInfo | undefined {
  const info = png(bytes) ?? jpeg(bytes) ?? webp(bytes) ?? ktx2(bytes) ?? avif(bytes) ?? gif(bytes);
  if (!info) return undefined;
  const valid = (side: number) => Number.isInteger(side) && side > 0 && side <= MAX_SIDE;
  return valid(info.width) && valid(info.height) ? info : undefined;
}

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const ascii = (bytes: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...bytes.subarray(at, at + length));
const starts = (bytes: Uint8Array, signature: number[], at = 0) =>
  bytes.length >= at + signature.length && signature.every((byte, i) => bytes[at + i] === byte);

function png(bytes: Uint8Array): ImageInfo | undefined {
  if (!starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) || bytes.length < 24) {
    return undefined;
  }
  if (ascii(bytes, 12, 4) !== 'IHDR') return undefined;
  const data = view(bytes);
  return { format: 'png', width: data.getUint32(16), height: data.getUint32(20) };
}

/** Start-of-frame markers, which carry the size: all of C0–CF but DHT, JPG and DAC. */
const START_OF_FRAME = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function jpeg(bytes: Uint8Array): ImageInfo | undefined {
  if (!starts(bytes, [0xff, 0xd8])) return undefined;
  const data = view(bytes);
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return undefined;
    const marker = bytes[at + 1];
    if (marker === 0xff) {
      at++;
      continue;
    }
    // Markers without a length: restart markers, start and end of image, TEM.
    if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
      at += 2;
      continue;
    }
    if (START_OF_FRAME.has(marker)) {
      if (at + 9 > bytes.length) return undefined;
      return { format: 'jpeg', height: data.getUint16(at + 5), width: data.getUint16(at + 7) };
    }
    at += 2 + data.getUint16(at + 2);
  }
  return undefined;
}

function webp(bytes: Uint8Array): ImageInfo | undefined {
  if (bytes.length < 25 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') {
    return undefined;
  }
  const data = view(bytes);
  const chunk = ascii(bytes, 12, 4);
  if (chunk !== 'VP8L' && bytes.length < 30) return undefined;
  switch (chunk) {
    case 'VP8 ':
      return {
        format: 'webp',
        width: data.getUint16(26, true) & 0x3fff,
        height: data.getUint16(28, true) & 0x3fff,
      };
    case 'VP8L': {
      const [b0, b1, b2, b3] = bytes.subarray(21, 25);
      return {
        format: 'webp',
        width: 1 + (((b1 & 0x3f) << 8) | b0),
        height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
      };
    }
    case 'VP8X':
      return {
        format: 'webp',
        width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)),
        height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)),
      };
    default:
      return undefined;
  }
}

function ktx2(bytes: Uint8Array): ImageInfo | undefined {
  const identifier = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!starts(bytes, identifier) || bytes.length < 48) return undefined;
  const data = view(bytes);
  return {
    format: 'ktx2',
    width: data.getUint32(20, true),
    // A 1D texture has no height; it is one row.
    height: Math.max(1, data.getUint32(24, true)),
    levels: Math.max(1, data.getUint32(40, true)),
  };
}

/** AVIF keeps its size in an `ispe` box of the image's properties, near the start. */
function avif(bytes: Uint8Array): ImageInfo | undefined {
  if (bytes.length < 16 || ascii(bytes, 4, 4) !== 'ftyp') return undefined;
  const brands = ascii(bytes, 8, Math.min(bytes.length - 8, 32));
  if (!brands.includes('avif') && !brands.includes('avis')) return undefined;
  const data = view(bytes);
  for (let at = 0; at + 16 <= bytes.length; at++) {
    if (bytes[at] === 0x69 && ascii(bytes, at, 4) === 'ispe') {
      return { format: 'avif', width: data.getUint32(at + 8), height: data.getUint32(at + 12) };
    }
  }
  return undefined;
}

function gif(bytes: Uint8Array): ImageInfo | undefined {
  if (bytes.length < 10 || ascii(bytes, 0, 4) !== 'GIF8') return undefined;
  const data = view(bytes);
  return { format: 'gif', width: data.getUint16(6, true), height: data.getUint16(8, true) };
}
