import { expect, test, type Page } from '@playwright/test';
import { lowestTextContrast } from './contrast';
import { openViewer } from './harness';
import type { ThemeName } from './themes';

const SCREENS = 'test-results/screens';

const viewButton = (page: Page) => page.locator('[data-action="view"]');
const menu = (page: Page) => page.locator('.nm-menu');
const item = (page: Page, label: string) =>
  menu(page).locator('.nm-menu-item', { has: page.getByText(label, { exact: true }) });

/** Where the gizmo draws an axis end, from its center, in its own units. */
async function gizmoEnd(page: Page, view: string) {
  const circle = page.locator(`.nm-gizmo [data-view="${view}"] circle`);
  return {
    x: Number(await circle.getAttribute('cx')),
    y: Number(await circle.getAttribute('cy')),
  };
}

/** Waits until the gizmo shows the camera looking from `view`: that end at the center. */
async function expectLookingFrom(page: Page, view: string) {
  await expect
    .poll(async () => {
      const { x, y } = await gizmoEnd(page, view);
      return Math.hypot(x, y);
    })
    .toBeLessThan(0.5);
}

for (const theme of ['dark', 'light', 'hcDark', 'hcLight'] as ThemeName[]) {
  test(`opens the View menu from the toolbar, ${theme} theme`, async ({ page }) => {
    const viewer = await openViewer(page, theme);
    await viewer.open('scene.glb');
    await expect(page.locator('.nm-gizmo')).toBeVisible();

    await viewButton(page).click();
    await expect(menu(page)).toBeVisible();
    await expect(viewButton(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(menu(page).locator('.nm-menu-label')).toHaveText([
      'Front',
      'Back',
      'Right',
      'Left',
      'Top',
      'Bottom',
      'Perspective',
      'Orthographic',
    ]);
    await expect(item(page, 'Perspective')).toHaveAttribute('aria-checked', 'true');
    await expect(item(page, 'Orthographic')).toHaveAttribute('aria-checked', 'false');
    await expect(item(page, 'Back')).toHaveAttribute('aria-keyshortcuts', 'Shift+1');
    await item(page, 'Top').hover();
    expect(await lowestTextContrast(page)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `${SCREENS}/view-menu-${theme}.png` });
    expect(viewer.problems).toEqual([]);
  });
}

test('works the View menu with the keyboard', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('scene.glb');
  await viewButton(page).focus();
  await page.keyboard.press('ArrowDown');
  await expect(item(page, 'Front')).toBeFocused();
  await page.keyboard.press('End');
  await expect(item(page, 'Orthographic')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu(page)).toBeHidden();
  await expect(viewButton(page)).toBeFocused();

  await page.keyboard.press('ArrowUp');
  await expect(item(page, 'Orthographic')).toHaveAttribute('aria-checked', 'true');
  await expect(item(page, 'Orthographic')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu(page)).toBeHidden();

  // A click elsewhere closes it too.
  await viewButton(page).click();
  await page.locator('.nm-viewport').click({ position: { x: 20, y: 20 } });
  await expect(menu(page)).toBeHidden();
  expect(viewer.problems).toEqual([]);
});

test('turns to standard views from the menu, the keys and the gizmo', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('scene.glb');

  await viewButton(page).click();
  await item(page, 'Top').click();
  await expectLookingFrom(page, 'top');
  // Seen from above, the front is at the bottom.
  expect((await gizmoEnd(page, 'front')).y).toBeGreaterThan(20);

  await page.locator('.nm-viewport').focus();
  await page.keyboard.press('1');
  await expectLookingFrom(page, 'front');
  await page.keyboard.press('Shift+3');
  await expectLookingFrom(page, 'left');
  await page.keyboard.press('9');
  await expectLookingFrom(page, 'right');

  await page.locator('.nm-gizmo [data-view="bottom"]').click();
  await expectLookingFrom(page, 'bottom');
  await page.screenshot({ path: `${SCREENS}/view-bottom.png` });
  expect(viewer.problems).toEqual([]);
});

test('orbits with the arrows, zooms with + and -, and switches projection with 5', async ({
  page,
}) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('scene.glb');
  await page.locator('.nm-viewport').focus();
  await page.keyboard.press('1');
  await expectLookingFrom(page, 'front');

  // Six steps of 15° to the right: the camera is now on the model's left.
  for (let step = 0; step < 6; step++) await page.keyboard.press('ArrowRight');
  await expectLookingFrom(page, 'left');

  const canvas = page.locator('.nm-canvas');
  const before = await canvas.screenshot();
  await page.keyboard.press('+');
  await expect.poll(async () => (await canvas.screenshot()).equals(before)).toBe(false);

  await page.keyboard.press('5');
  await viewButton(page).click();
  await expect(item(page, 'Orthographic')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: `${SCREENS}/view-orthographic.png` });
  expect(viewer.problems).toEqual([]);
});
