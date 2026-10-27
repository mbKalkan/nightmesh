import { expect, test, type Page } from '@playwright/test';
import { openViewer } from './harness';
import { pixelsOf } from './pixels';
import type { ThemeName } from './themes';

const SCREENS = 'test-results/screens';

test.use({ reducedMotion: 'reduce' });

type Viewer = Awaited<ReturnType<typeof openViewer>>;

/** The paths of the tiles the webview asked the host for. */
const requested = async (viewer: Viewer) =>
  (await viewer.sent())
    .filter((message) => message.type === 'tile')
    .map((message) => (message as unknown as { path: string }).path)
    .sort();

/** Waits until the tiles asked for have come and been drawn. */
async function settle(page: Page, viewer: Viewer, count: number): Promise<void> {
  await expect.poll(async () => (await requested(viewer)).length).toBe(count);
  // Two frames: one to put the last tile in the scene, one to draw it.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

for (const theme of ['dark', 'light'] as ThemeName[]) {
  test(`draws a tileset on the globe, its quarters in detail, ${theme} theme`, async ({ page }) => {
    const viewer = await openViewer(page, theme);
    await viewer.open('tiles/tileset.json');
    await expect(page.locator('.nm-viewport')).toHaveAttribute('data-state', 'shown');
    await settle(page, viewer, 6);

    // The quarters replace the coarse root; the fourth is a tileset in a folder of its own.
    expect(await requested(viewer)).toEqual([
      '/_/tiles/district.b3dm',
      '/_/tiles/east/tileset.json',
      '/_/tiles/east/tower.b3dm',
      '/_/tiles/north-west.b3dm',
      '/_/tiles/south-east.b3dm',
      '/_/tiles/south-west.b3dm',
    ]);
    await expect(page.locator('.nm-error')).toBeHidden();
    await expect(page.locator('.nm-notice')).toBeHidden();
    await page.screenshot({ path: `${SCREENS}/tiles-district-${theme}.png` });

    // Recentered at the origin and framed: the tiles cover much of the view.
    const pixels = await pixelsOf(page, '.nm-canvas');
    const background = pixels.at(2, 2);
    let drawn = 0;
    for (let y = 0; y < pixels.height; y += 8) {
      for (let x = 0; x < pixels.width; x += 8) {
        const color = pixels.at(x, y);
        if (color.some((channel, i) => Math.abs(channel - background[i]) > 24)) drawn++;
      }
    }
    expect(drawn / ((pixels.width / 8) * (pixels.height / 8))).toBeGreaterThan(0.15);
    expect(viewer.problems).toEqual([]);
  });
}

/**
 * Where the yellow of the tallest tower, in the north-east quarter, is across the drawn
 * district: from 0 at its left edge to 1 at its right.
 */
async function yellowAcross(page: Page): Promise<number> {
  const pixels = await pixelsOf(page, '.nm-canvas');
  const background = pixels.at(2, 2);
  let [left, right, sum, count] = [Infinity, -Infinity, 0, 0];
  for (let y = 0; y < pixels.height; y += 2) {
    for (let x = 0; x < pixels.width; x += 2) {
      const [r, g, b] = pixels.at(x, y);
      if (![r, g, b].some((channel, i) => Math.abs(channel - background[i]) > 24)) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      if (r > b * 1.6 && g > b * 1.6 && g > r * 0.75) {
        sum += x;
        count++;
      }
    }
  }
  expect(count, 'yellow pixels').toBeGreaterThan(50);
  return (sum / count - left) / (right - left);
}

test('puts east to the right seen from the front, and north to the right seen from the right', async ({
  page,
}) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('tiles/tileset.json');
  await settle(page, viewer, 6);
  await page.locator('.nm-viewport').focus();
  await page.keyboard.press('1');
  await settle(page, viewer, 6);
  expect(await yellowAcross(page), 'front').toBeGreaterThan(0.55);
  await page.keyboard.press('3');
  await settle(page, viewer, 6);
  expect(await yellowAcross(page), 'right').toBeGreaterThan(0.55);
});

test('says which tiles could not be had, and draws the rest', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('tiles/problems.json');
  await expect(page.locator('.nm-viewport')).toHaveAttribute('data-state', 'shown');
  await settle(page, viewer, 4);
  await expect(page.locator('.nm-notice')).toBeVisible();
  await expect
    .poll(async () => (await page.locator('.nm-notice li').allInnerTexts()).sort())
    .toEqual([
      "damaged.b3dm isn't a tile Nightmesh can draw, or it is damaged.",
      "missing.b3dm wasn't found next to the model.",
      "outside.b3dm wasn't loaded: it is outside the model's folder and workspace.",
    ]);
  await page.screenshot({ path: `${SCREENS}/tiles-problems-dark.png` });
});
