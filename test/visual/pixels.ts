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
