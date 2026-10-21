import { expect, test, type Page } from '@playwright/test';
import { openViewer } from './harness';
import { areaOf } from './pixels';

const SCREENS = 'test-results/screens';
/** The dark theme's focus border, which selection boxes are drawn in. */
const HIGHLIGHT = [0x00, 0x78, 0xd4];

/** The first tree row labelled exactly `label`. */
const row = (page: Page, label: string) =>
  page
    .locator('.nm-tree-row', {
      has: page.locator('.nm-tree-label').getByText(label, { exact: true }),
    })
    .first();
const heading = (page: Page) => page.locator('.nm-inspector-heading');
/** The highlight's pixels on the canvas; the size badge, outlined in the same color, set aside. */
async function highlight(page: Page) {
  await page.locator('.nm-measure').evaluate((badge) => (badge.style.visibility = 'hidden'));
  return areaOf(page, '.nm-canvas', HIGHLIGHT);
}

/** Clicks the viewport at a fraction of its width and height. */
async function clickView(page: Page, x: number, y: number, clickCount = 1) {
  const box = (await page.locator('.nm-viewport').boundingBox())!;
  await page.mouse.click(box.x + box.width * x, box.y + box.height * y, { clickCount });
}

test('selects what is clicked in the view, and shows it in the tree', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  // Two scenes: the loader would forget the nodes of one of them without care.
  await viewer.open('scene.glb');
  expect(await highlight(page)).toBeUndefined();

  await clickView(page, 0.5, 0.53);
  await expect(heading(page)).toHaveText(/Sphere\s*Node 2/);
  // Screen readers hear what was picked: the tree, which would say it, doesn't have the focus.
  await expect(page.locator('[data-announcer]')).toHaveText('Sphere, Node 2');
  await expect(page.locator('.nm-viewport')).toHaveAccessibleDescription(/^Arrow keys orbit/);
  await expect(row(page, 'Sphere')).toHaveAttribute('aria-selected', 'true');
  await expect.poll(async () => (await highlight(page))?.count ?? 0).toBeGreaterThan(50);
  await page.screenshot({ path: `${SCREENS}/selection-picked.png` });

  expect(viewer.problems).toEqual([]);
});

test('lets go of the selection on empty space and with Escape', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('scene.glb');
  await clickView(page, 0.5, 0.53);
  await expect(heading(page)).toHaveText(/Sphere/);

  await clickView(page, 0.04, 0.96);
  await expect(heading(page)).toHaveText(/scene\.glb\s*Model/);
  await expect.poll(() => highlight(page)).toBeUndefined();

  await row(page, 'Box').click();
  await expect.poll(async () => (await highlight(page))?.count ?? 0).toBeGreaterThan(50);
  await page.locator('.nm-viewport').focus();
  await page.keyboard.press('Escape');
  await expect(heading(page)).toHaveText(/scene\.glb/);
  await expect.poll(() => highlight(page)).toBeUndefined();
  expect(viewer.problems).toEqual([]);
});

test("highlights what the tree selects, and all of a material's uses", async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('scene.glb');

  await row(page, 'Box').click();
  await expect.poll(async () => (await highlight(page))?.count ?? 0).toBeGreaterThan(50);
  const box = (await highlight(page))!;

  await row(page, 'Materials').click();
  await row(page, 'Clay').click();
  await expect(heading(page)).toHaveText(/Clay\s*Material 0/);
  // Every mesh but the points and lines is made of clay: the boxes span the model.
  await expect
    .poll(async () => (await highlight(page))?.width ?? 0)
    .toBeGreaterThan(box.width * 1.5);
  expect(viewer.problems).toEqual([]);
});

test('frames the selection with F, from the toolbar and with a double-click', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('scene.glb');
  const wide = async () => (await highlight(page))?.width ?? 0;

  await row(page, 'Box').click();
  await expect.poll(wide).toBeGreaterThan(20);
  const before = await wide();
  await page.locator('.nm-viewport').focus();
  await page.keyboard.press('f');
  await expect.poll(wide).toBeGreaterThan(before * 2);
  await page.screenshot({ path: `${SCREENS}/selection-framed.png` });

  // Framing everything again, then the selection from the toolbar.
  await row(page, 'Model').click();
  await page.locator('[data-action="frame"]').click();
  await row(page, 'Axes').click();
  const whole = await wide();
  await page.locator('[data-action="frame"]').click();
  await expect.poll(wide).toBeGreaterThan(whole * 1.5);

  // A double-click in the tree frames what it lands on.
  await row(page, 'Model').click();
  await page.locator('[data-action="frame"]').click();
  await row(page, 'Sphere').click();
  await expect.poll(wide).toBeGreaterThan(20);
  const sphere = await wide();
  await row(page, 'Sphere').dblclick();
  await expect(heading(page)).toHaveText(/Sphere/);
  await expect.poll(wide).toBeGreaterThan(sphere * 1.3);
  expect(viewer.problems).toEqual([]);
});

test('frames what is double-clicked in the view', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('scene.glb');
  await clickView(page, 0.5, 0.53);
  await expect.poll(async () => (await highlight(page))?.width ?? 0).toBeGreaterThan(50);
  const before = (await highlight(page))!.width;

  await clickView(page, 0.5, 0.53, 2);
  await expect.poll(async () => (await highlight(page))?.width ?? 0).toBeGreaterThan(before * 1.3);
  await expect(heading(page)).toHaveText(/Sphere/);
  expect(viewer.problems).toEqual([]);
});

test('keeps the selection highlighted when the file changes', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('scene.glb');
  await row(page, 'Box').click();
  await expect.poll(async () => (await highlight(page))?.count ?? 0).toBeGreaterThan(50);

  await viewer.open('scene.glb', { reload: true });
  await expect(row(page, 'Box')).toHaveAttribute('aria-selected', 'true');
  await expect.poll(async () => (await highlight(page))?.count ?? 0).toBeGreaterThan(50);
  expect(viewer.problems).toEqual([]);
});

test('shows the size of the model, or of the selection, in metres', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('scene.glb');
  const badge = page.locator('.nm-measure');

  await expect(badge).toHaveText('X4.1 mY1.781 mZ1.849 m');
  await expect(badge).toHaveAttribute('title', /^Size of the model:/);
  // A node along its own axes: the sphere is turned 45°, its size isn't.
  await row(page, 'Sphere').click();
  await expect(badge).toHaveText('X1.2 mY1.2 mZ1.2 m');
  await expect(badge).toHaveAttribute('title', /^Size of the selection:/);
  await page.locator('.nm-viewport').focus();
  await page.keyboard.press('Escape');
  await expect(badge).toHaveText('X4.1 mY1.781 mZ1.849 m');
  expect(viewer.problems).toEqual([]);
});
