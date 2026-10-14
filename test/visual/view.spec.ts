import { expect, test, type Page } from '@playwright/test';
import { lowestTextContrast } from './contrast';
import { openViewer } from './harness';
import { pixelAt } from './pixels';
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

// One model for all four themes: each load costs seconds of software WebGL in CI.
test('opens the View menu from the toolbar, in every theme', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
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
    'Grid (1 m squares)',
    'Origin Axes',
    'Bounding Box',
    'Theme Background',
    'Dark Background',
    'Neutral Background',
    'Light Background',
    'Front Camera',
    'Top Camera',
  ]);
  await expect(item(page, 'Grid (1 m squares)')).toHaveAttribute('aria-checked', 'true');
  await expect(item(page, 'Origin Axes')).toHaveAttribute('aria-checked', 'false');
  await expect(item(page, 'Perspective')).toHaveAttribute('aria-checked', 'true');
  await expect(item(page, 'Orthographic')).toHaveAttribute('aria-checked', 'false');
  await expect(item(page, 'Back')).toHaveAttribute('aria-keyshortcuts', 'Shift+1');
  await item(page, 'Top').hover();
  for (const theme of ['dark', 'light', 'hcDark', 'hcLight'] as ThemeName[]) {
    await viewer.setTheme(theme);
    // The view takes the theme's colors a moment after VS Code switches it.
    await page.waitForTimeout(200);
    expect(await lowestTextContrast(page)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `${SCREENS}/view-menu-${theme}.png` });
  }
  expect(viewer.problems).toEqual([]);
});

test('works the View menu with the keyboard', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('scene.glb');
  await viewButton(page).focus();
  await page.keyboard.press('ArrowDown');
  await expect(item(page, 'Front')).toBeFocused();
  await page.keyboard.press('End');
  await expect(item(page, 'Top Camera')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(item(page, 'Front')).toBeFocused();
  // Past the six views and Perspective.
  for (let step = 0; step < 7; step++) await page.keyboard.press('ArrowDown');
  await expect(item(page, 'Orthographic')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu(page)).toBeHidden();
  await expect(viewButton(page)).toBeFocused();

  await page.keyboard.press('ArrowUp');
  await expect(item(page, 'Orthographic')).toHaveAttribute('aria-checked', 'true');
  await expect(item(page, 'Top Camera')).toBeFocused();
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

/** The last preferences the viewer gave the host to keep. */
async function savedPreferences(viewer: Awaited<ReturnType<typeof openViewer>>) {
  const sent = (await viewer.sent()) as { type: string; preferences?: Record<string, unknown> }[];
  return sent.filter((message) => message.type === 'preferences').at(-1)?.preferences;
}

test('shows a ground grid unless hidden, and the origin axes when asked, and keeps the choice', async ({
  page,
}) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('scene.glb');
  const canvas = page.locator('.nm-canvas');
  const withGrid = await canvas.screenshot();

  await viewButton(page).click();
  await item(page, 'Grid (1 m squares)').click();
  await expect.poll(() => savedPreferences(viewer)).toMatchObject({ grid: false });
  await expect.poll(async () => (await canvas.screenshot()).equals(withGrid)).toBe(false);
  await viewButton(page).click();
  await expect(item(page, 'Grid (1 m squares)')).toHaveAttribute('aria-checked', 'false');
  await item(page, 'Origin Axes').click();
  await expect.poll(() => savedPreferences(viewer)).toMatchObject({ grid: false, axes: true });
  await page.screenshot({ path: `${SCREENS}/view-axes.png` });

  // Hiding a panel is kept the same way.
  await page.locator('[data-panel="inspector"]').click();
  await expect
    .poll(() => savedPreferences(viewer))
    .toMatchObject({ axes: true, layout: { inspector: false } });
  expect(viewer.problems).toEqual([]);
});

test('draws the bounding box and clears to the background picked, and keeps both', async ({
  page,
}) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('scene.glb');
  const canvas = page.locator('.nm-canvas');
  const before = await canvas.screenshot();

  await viewButton(page).click();
  await item(page, 'Bounding Box').click();
  await expect.poll(() => savedPreferences(viewer)).toMatchObject({ bounds: true });
  await expect.poll(async () => (await canvas.screenshot()).equals(before)).toBe(false);

  await viewButton(page).click();
  await expect(item(page, 'Theme Background')).toHaveAttribute('aria-checked', 'true');
  await item(page, 'Light Background').click();
  await expect.poll(() => savedPreferences(viewer)).toMatchObject({ background: 'light' });
  // A corner of the view, away from the model and the grid, is the light shade.
  const box = (await canvas.boundingBox())!;
  await expect
    .poll(() => pixelAt(page, Math.round(box.x + 6), Math.round(box.y + 6)))
    .toEqual([235, 235, 235]);
  await page.screenshot({ path: `${SCREENS}/view-bounds-light.png` });

  await viewButton(page).click();
  await item(page, 'Neutral Background').click();
  await page.screenshot({ path: `${SCREENS}/view-neutral.png` });
  await viewButton(page).click();
  await item(page, 'Theme Background').click();
  await expect
    .poll(() => pixelAt(page, Math.round(box.x + 6), Math.round(box.y + 6)))
    .toEqual([31, 31, 31]);
  expect(viewer.problems).toEqual([]);
});

test('starts with what the host kept from the viewers before', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.post({
    ...viewer.openMessage('scene.glb'),
    preferences: { grid: false, axes: true, layout: { inspector: false, structureWidth: 320 } },
  } as Parameters<typeof viewer.post>[0]);
  for (const message of await viewer.messages('scene.glb')) await viewer.post(message);
  await page.waitForSelector('.nm-viewport[data-state]');
  await expect(page.locator('.nm-gizmo')).toBeVisible();

  await expect(page.locator('.nm-panel-right')).toBeHidden();
  await expect(page.locator('[data-panel="inspector"]')).toHaveAttribute('aria-pressed', 'false');
  expect(Math.round((await page.locator('.nm-panel-left').boundingBox())!.width)).toBe(320);
  await viewButton(page).click();
  await expect(item(page, 'Grid (1 m squares)')).toHaveAttribute('aria-checked', 'false');
  await expect(item(page, 'Origin Axes')).toHaveAttribute('aria-checked', 'true');
  expect(viewer.problems).toEqual([]);
});
