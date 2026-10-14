import { expect, test, type Page } from '@playwright/test';
import { lowestTextContrast } from './contrast';
import { openViewer } from './harness';
import { centerOf, pixelAt } from './pixels';

const SCREENS = 'test-results/screens';

const shadingButton = (page: Page) => page.locator('[data-action="shading"]');
const item = (page: Page, label: string) =>
  page.locator('.nm-menu .nm-menu-item', { has: page.getByText(label, { exact: true }) });

async function choose(page: Page, label: string) {
  await shadingButton(page).click();
  await item(page, label).click();
}

/**
 * The sphere of scene.glb seen from the front: a point in its middle, and one near its bottom,
 * which the environment lights less. It sits a little left of and below the view's center.
 */
async function sphere(page: Page) {
  const center = await centerOf(page, '.nm-canvas');
  return {
    middle: () => pixelAt(page, center.x - 6, center.y + 31),
    side: () => pixelAt(page, center.x - 6, center.y + 80),
  };
}

const difference = (a: readonly number[], b: readonly number[]) =>
  Math.max(...a.map((value, index) => Math.abs(value - b[index])));

test('draws the model lit, unlit or by its normals, with a wireframe over it', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('scene.glb');
  await page.locator('.nm-viewport').focus();
  await page.keyboard.press('1');
  await page.waitForTimeout(500);
  const { middle, side } = await sphere(page);

  // Lit, the sphere is shaded from its middle to its bottom.
  const lit = await middle();
  expect(difference(lit, await side())).toBeGreaterThan(6);

  await shadingButton(page).click();
  await expect(item(page, 'Lit')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.nm-menu .nm-menu-label')).toHaveText([
    'Lit',
    'Unlit',
    'Normals',
    'Wireframe',
  ]);
  expect(await lowestTextContrast(page)).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: `${SCREENS}/shading-menu-dark.png` });
  await item(page, 'Unlit').click();
  // Unlit, it is one flat color.
  await expect.poll(async () => difference(await middle(), await side())).toBeLessThan(4);

  await choose(page, 'Normals');
  // Facing the camera, its middle is blue: the normal points along +Z in view space.
  await expect
    .poll(async () => {
      const [r, g, b] = await middle();
      return b - Math.max(r, g);
    })
    .toBeGreaterThan(40);
  await page.screenshot({ path: `${SCREENS}/shading-normals.png` });

  await choose(page, 'Lit');
  await expect.poll(async () => difference(await middle(), lit)).toBeLessThan(4);

  await choose(page, 'Wireframe');
  await shadingButton(page).click();
  await expect(item(page, 'Wireframe')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await viewer.setTheme('light');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SCREENS}/shading-wireframe-light.png` });
  expect(viewer.problems).toEqual([]);
});
