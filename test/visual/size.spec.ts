import { expect, test, type Page } from '@playwright/test';
import { lowestTextContrast } from './contrast';
import { openViewer } from './harness';
import type { ThemeName } from './themes';

const SCREENS = 'test-results/screens';
/** The panels work the same with or without a 3D view, and are quicker to test without. */
const PANELS_ONLY = { withoutWebGL: true };

const tab = (page: Page) => page.locator('.nm-panel-tab', { hasText: 'Size' });
const size = (page: Page) => page.locator('.nm-size');
const section = (page: Page, title: string) =>
  page
    .locator('.nm-size .nm-section-title', { hasText: title })
    .locator('xpath=following-sibling::*[1]');

for (const theme of ['dark', 'light', 'hcDark', 'hcLight'] as ThemeName[]) {
  test(`shows where the bytes go, ${theme} theme`, async ({ page }) => {
    const viewer = await openViewer(page, theme, PANELS_ONLY);
    await viewer.open('textured.gltf');
    await tab(page).click();

    await expect(size(page).locator('.nm-size-total')).toHaveText(/^\d+(\.\d)? KB in 3 files$/);
    const bars = section(page, 'Where the bytes go').locator('li');
    await expect(bars.first()).toContainText(/JSON|Textures|Vertex data/);
    await expect(bars).toHaveCount(4);
    await expect(section(page, 'Compression').locator('dt, dd')).toHaveText([
      'Geometry',
      'None',
      'Textures',
      '1 PNG',
    ]);
    await expect(section(page, 'Images').locator('li')).toContainText(['checker']);
    await expect(section(page, 'Images')).toContainText('PNG · 64 × 64');
    await expect(size(page).locator('.nm-suggestion')).toHaveCount(0);
    expect(await lowestTextContrast(page)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `${SCREENS}/size-${theme}.png` });
    expect(viewer.problems).toEqual([]);
  });
}

test('links the largest parts and images to what they are', async ({ page }) => {
  const viewer = await openViewer(page, 'dark', PANELS_ONLY);
  await viewer.open('scene.glb');
  await tab(page).click();
  const largest = section(page, 'Largest').locator('.nm-link').first();
  const key = await largest.getAttribute('data-key');
  expect(key).toMatch(/^mesh:\d+$/);
  await largest.click();
  await expect(page.locator('.nm-tree-row[aria-selected="true"]')).toHaveAttribute(
    'data-key',
    key!,
  );
  await expect(tab(page)).toHaveAttribute('aria-selected', 'true');
});

test('suggests how to make a model lighter, with commands to copy', async ({ page }) => {
  const viewer = await openViewer(page, 'dark', PANELS_ONLY);
  await viewer.post(viewer.openMessage('textured.gltf'));
  for (const message of await viewer.messages('textured.gltf')) {
    // As if its texture were a large PNG: the size tab reads only what the host says of it.
    await viewer.post(
      message.type === 'images'
        ? { ...message, images: [{ format: 'png', width: 8192, height: 8192 }], bytes: [3e6] }
        : message,
    );
  }
  await tab(page).click();

  const suggestions = size(page).locator('.nm-suggestion');
  await expect(suggestions.locator('.nm-suggestion-title')).toHaveText([
    'Keep textures compressed on the GPU',
    'Make the textures smaller to download',
    'Scale down the largest textures',
  ]);
  await expect(suggestions.first()).toContainText('Textures take about 341.3 MB of GPU memory');
  await expect(section(page, 'Images')).toContainText(
    "Larger than 4096 pixels: many mobile GPUs can't load it.",
  );
  await suggestions.last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SCREENS}/size-suggestions-dark.png` });

  await suggestions.nth(1).getByRole('button', { name: 'Copy Command' }).click();
  expect(await viewer.sent()).toContainEqual({
    type: 'copy',
    text: 'npx @gltf-transform/cli webp "textured.gltf" "textured-webp.gltf"',
  });
  expect(viewer.problems).toEqual([]);
});
