import { describe, expect, it } from 'vitest';
import { readImageInfo } from '../../src/extension/model/imageInfo';

const bytes = (...parts: (number[] | string)[]) =>
  Uint8Array.from(
    parts.flatMap((part) =>
      typeof part === 'string' ? [...part].map((c) => c.charCodeAt(0)) : part,
    ),
  );
const u16be = (value: number) => [value >> 8, value & 0xff];
const u32be = (value: number) => [
  value >>> 24,
  (value >> 16) & 0xff,
  (value >> 8) & 0xff,
  value & 0xff,
];
const u16le = (value: number) => [value & 0xff, value >> 8];
const u32le = (value: number) => [...u16le(value & 0xffff), ...u16le(value >>> 16)];

describe('readImageInfo', () => {
  it('reads PNG sizes from the IHDR chunk', () => {
    const png = bytes(
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      u32be(13),
      'IHDR',
      u32be(640),
      u32be(480),
    );
    expect(readImageInfo(png)).toEqual({ format: 'png', width: 640, height: 480 });
  });

  it('reads JPEG sizes from the frame header, past other segments', () => {
    const exif = new Array(300).fill(0);
    const jpeg = bytes(
      [0xff, 0xd8],
      [0xff, 0xe1],
      u16be(exif.length + 2),
      exif,
      [0xff, 0xff, 0xc2],
      u16be(17),
      [8],
      u16be(1080),
      u16be(1920),
      [3],
    );
    expect(readImageInfo(jpeg)).toEqual({ format: 'jpeg', width: 1920, height: 1080 });
    expect(readImageInfo(bytes([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBeUndefined();
  });

  it('reads all three kinds of WebP', () => {
    const riff = (chunk: string, body: number[]) =>
      bytes('RIFF', u32le(100), 'WEBP', chunk, u32le(body.length), body);
    // Lossy: frame tag, start code, then 14-bit width and height.
    expect(
      readImageInfo(riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...u16le(300), ...u16le(200)])),
    ).toEqual({ format: 'webp', width: 300, height: 200 });
    // Lossless: signature, then width - 1 and height - 1 in 14 bits each.
    const [w, h] = [256 - 1, 128 - 1];
    const packed = w | (h << 14);
    expect(readImageInfo(riff('VP8L', [0x2f, ...u32le(packed)]))).toEqual({
      format: 'webp',
      width: 256,
      height: 128,
    });
    // Extended: flags, then 24-bit width - 1 and height - 1.
    expect(readImageInfo(riff('VP8X', [0, 0, 0, 0, 0x3f, 0x01, 0, 0xc7, 0, 0]))).toEqual({
      format: 'webp',
      width: 320,
      height: 200,
    });
  });

  it('reads KTX2 sizes and mip levels', () => {
    const ktx2 = bytes(
      [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a],
      u32le(0),
      u32le(1),
      u32le(2048),
      u32le(1024),
      u32le(0),
      u32le(0),
      u32le(1),
      u32le(12),
      u32le(2),
    );
    expect(readImageInfo(ktx2)).toEqual({ format: 'ktx2', width: 2048, height: 1024, levels: 12 });
  });

  it('reads AVIF and GIF sizes', () => {
    const avif = bytes(
      u32be(24),
      'ftyp',
      'avif',
      u32be(0),
      'mif1',
      'avif',
      u32be(20),
      'ispe',
      u32be(0),
      u32be(800),
      u32be(600),
    );
    expect(readImageInfo(avif)).toEqual({ format: 'avif', width: 800, height: 600 });
    expect(readImageInfo(bytes('GIF89a', u16le(32), u16le(16)))).toEqual({
      format: 'gif',
      width: 32,
      height: 16,
    });
  });

  it('says nothing for unknown, truncated or absurd headers', () => {
    expect(readImageInfo(bytes('not an image'))).toBeUndefined();
    expect(readImageInfo(bytes([0x89, 0x50, 0x4e, 0x47]))).toBeUndefined();
    const huge = bytes(
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      u32be(13),
      'IHDR',
      u32be(1e6),
      u32be(1),
    );
    expect(readImageInfo(huge)).toBeUndefined();
    expect(readImageInfo(new Uint8Array())).toBeUndefined();
  });
});
