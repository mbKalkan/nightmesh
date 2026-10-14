import { inflateSync } from 'node:zlib';
import type { Page } from '@playwright/test';

/**
 * The color on screen at one point of the page, as composited, so it includes what WebGL drew.
 * Takes a 1×1 screenshot and decodes its PNG: in the first pixel of the first row every PNG
 * filter predicts 0, so the inflated scanline holds the raw color after its filter byte.
 */
export async function pixelAt(page: Page, x: number, y: number): Promise<[number, number, number]> {
  const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 } });
  const data: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') data.push(png.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const row = inflateSync(Buffer.concat(data));
  return [row[1], row[2], row[3]];
}

/** Center of an element's box on the page. */
export async function centerOf(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} is not visible`);
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
}

/** An element's pixels as shown on screen: RGB triples, row by row from the top left. */
export async function pixelsOf(page: Page, selector: string) {
  const png = await page.locator(selector).screenshot();
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const channels = png[25] === 6 ? 4 : 3;
  const data: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') {
      data.push(png.subarray(offset + 8, offset + 8 + length));
    }
    offset += 12 + length;
  }
  // Undo PNG's per-row filters (none, sub, up, average, Paeth).
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x];
      const left = x >= channels ? out[y * stride + x - channels] : 0;
      const up = y > 0 ? out[(y - 1) * stride + x] : 0;
      const corner = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0;
      const paeth = () => {
        const p = left + up - corner;
        const [a, b, c] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - corner)];
        return a <= b && a <= c ? left : b <= c ? up : corner;
      };
      const predicted = [0, left, up, (left + up) >> 1, filter === 4 ? paeth() : 0][filter];
      out[y * stride + x] = (value + predicted) & 0xff;
    }
  }
  return {
    width,
    height,
    /** The color at (x, y). */
    at: (x: number, y: number): [number, number, number] => {
      const offset = y * stride + x * channels;
      return [out[offset], out[offset + 1], out[offset + 2]];
    },
  };
}

/** Where pixels close to `color` are, as the box around them; undefined if there are none. */
export async function areaOf(
  page: Page,
  selector: string,
  color: readonly number[],
  tolerance = 24,
) {
  const pixels = await pixelsOf(page, selector);
  let found:
    { left: number; top: number; right: number; bottom: number; count: number } | undefined;
  for (let y = 0; y < pixels.height; y++) {
    for (let x = 0; x < pixels.width; x++) {
      const pixel = pixels.at(x, y);
      if (!pixel.every((value, i) => Math.abs(value - color[i]) <= tolerance)) continue;
      found ??= { left: x, top: y, right: x, bottom: y, count: 0 };
      found.left = Math.min(found.left, x);
      found.top = Math.min(found.top, y);
      found.right = Math.max(found.right, x);
      found.bottom = Math.max(found.bottom, y);
      found.count++;
    }
  }
  return found && { ...found, width: found.right - found.left, height: found.bottom - found.top };
}
