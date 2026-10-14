import { expect, test, type Page } from '@playwright/test';
import { openViewer } from './harness';
import { centerOf, pixelAt } from './pixels';

const SCREENS = 'test-results/screens';

const menuButton = (page: Page, action: string) => page.locator(`[data-action="${action}"]`);
const item = (page: Page, label: string) =>
  page.locator('.nm-menu .nm-menu-item', { has: page.getByText(label, { exact: true }) });

/** Which of red, green and blue is strongest at the middle of the view. */
async function strongest(page: Page) {
  const center = await centerOf(page, '.nm-canvas');
  const pixel = await pixelAt(page, center.x, center.y);
  return ['red', 'green', 'blue'][pixel.indexOf(Math.max(...pixel))];
}

test('switches between the material variants of a model', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('variants.glb');
  await expect.poll(() => strongest(page)).toBe('red');

  await menuButton(page, 'shading').click();
  await expect(page.locator('.nm-menu .nm-menu-label')).toHaveText([
    'Lit',
    'Unlit',
    'Normals',
    'Wireframe',
    'Default Materials',
    'Red',
    'Green',
    'Blue',
  ]);
  await expect(item(page, 'Default Materials')).toHaveAttribute('aria-checked', 'true');
  await item(page, 'Green').click();
  await expect.poll(() => strongest(page)).toBe('green');
  await page.screenshot({ path: `${SCREENS}/variants-green.png` });

  // Unlit keeps the variant.
  await menuButton(page, 'shading').click();
  await item(page, 'Unlit').click();
  await expect.poll(() => strongest(page)).toBe('green');

  await menuButton(page, 'shading').click();
  await expect(item(page, 'Green')).toHaveAttribute('aria-checked', 'true');
  await item(page, 'Default Materials').click();
  await expect.poll(() => strongest(page)).toBe('red');
  expect(viewer.problems).toEqual([]);
});

/** Waits until the gizmo shows the camera looking from `view`: that end at the center. */
async function expectLookingFrom(page: Page, view: string) {
  await expect
    .poll(async () => {
      const circle = page.locator(`.nm-gizmo [data-view="${view}"] circle`);
      const x = Number(await circle.getAttribute('cx'));
      const y = Number(await circle.getAttribute('cy'));
      return Math.hypot(x, y);
    })
    .toBeLessThan(0.5);
}

test('looks through the cameras in the model, from the View menu and with 0', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('scene.glb');
  await menuButton(page, 'view').click();
  await expect(item(page, 'Front Camera')).toHaveAttribute('aria-keyshortcuts', '0');
  await item(page, 'Top Camera').click();
  await expectLookingFrom(page, 'top');
  await menuButton(page, 'view').click();
  await expect(item(page, 'Orthographic')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: `${SCREENS}/camera-top.png` });

  // 0 goes on to the next camera: the first, in front, in perspective.
  await page.locator('.nm-viewport').focus();
  await page.keyboard.press('0');
  await expectLookingFrom(page, 'front');
  await menuButton(page, 'view').click();
  await expect(item(page, 'Perspective')).toHaveAttribute('aria-checked', 'true');
  expect(viewer.problems).toEqual([]);
});
