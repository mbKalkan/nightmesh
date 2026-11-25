import { expect, test, type Page } from '@playwright/test';
import { lowestTextContrast } from './contrast';
import { openViewer } from './harness';
import { areaOf } from './pixels';
import type { ThemeName } from './themes';
import type { Trs } from '../../src/shared/transforms';

const SCREENS = 'test-results/screens';
/** The panels work the same with or without a 3D view, and are quicker to test without. */
const PANELS_ONLY = { withoutWebGL: true };

/** The first tree row labelled exactly `label`. */
const row = (page: Page, label: string) =>
  page
    .locator('.nm-tree-row', {
      has: page.locator('.nm-tree-label').getByText(label, { exact: true }),
    })
    .first();
const heading = (page: Page) => page.locator('.nm-inspector-heading');
const field = (page: Page, name: string) => page.getByRole('textbox', { name, exact: true });
const revert = (page: Page) => page.getByRole('button', { name: 'Revert' });
const toolButton = (page: Page, name: string) => page.locator(`[data-transform="${name}"]`);

// Standard views turn the camera at once, so the handles are where they were found.
test.use({ reducedMotion: 'reduce' });

type Sent = { type: string; node?: number; from?: Trs; to?: Trs };
/** The changes the viewer asked the host to make, in order. */
const changes = async (viewer: { sent(): Promise<unknown> }) =>
  ((await viewer.sent()) as Sent[]).filter((message) => message.type === 'transform');

for (const theme of ['dark', 'light', 'hcDark', 'hcLight'] as ThemeName[]) {
  test(`changes a node's transform in the inspector, ${theme} theme`, async ({ page }) => {
    const viewer = await openViewer(page, theme, PANELS_ONLY);
    await viewer.open('scene.glb', { editable: true });

    // Nothing selected: the whole model, which moves with its one top node.
    await expect(heading(page)).toHaveText(/scene\.glb\s*Model/);
    await expect(field(page, 'Position (m) X')).toHaveValue('0');
    await row(page, 'Sphere').click();
    await expect(heading(page)).toHaveText(/Sphere\s*Node 2/);
    await expect(field(page, 'Position (m) Y')).toHaveValue('0.5');
    await expect(field(page, 'Rotation (°) Y')).toHaveValue('45');
    await expect(field(page, 'Scale Z')).toHaveValue('1.2');
    await expect(revert(page)).toBeDisabled();

    // A value typed, with a comma as Turkish has it, is a change for the host to keep.
    await field(page, 'Position (m) X').fill('1,25');
    await field(page, 'Position (m) X').press('Enter');
    let [change] = await changes(viewer);
    expect(change.node).toBe(2);
    expect(change.from?.translation).toEqual([0, 0.5, 0]);
    expect(change.to?.translation).toEqual([1.25, 0.5, 0]);

    // The host's answer shows, and can be taken back to the saved values.
    await viewer.post({ type: 'transforms', nodes: [[2, change.to!]] });
    await expect(field(page, 'Position (m) X')).toHaveValue('1.25');
    await expect(revert(page)).toBeEnabled();
    expect(await lowestTextContrast(page)).toBeGreaterThanOrEqual(4.5);
    await page.locator('.nm-panel-right').screenshot({ path: `${SCREENS}/transform-${theme}.png` });
    await revert(page).click();
    change = (await changes(viewer))[1];
    expect(change.to?.translation).toEqual([0, 0.5, 0]);

    // Angles in degrees become the quaternion glTF keeps.
    await field(page, 'Rotation (°) Y').fill('90');
    await field(page, 'Rotation (°) Y').press('Tab');
    change = (await changes(viewer))[2];
    expect(change.to?.rotation).toEqual([0, 0.707106781, 0, 0.707106781]);

    // Escape puts back what the field had; something not a number is no change.
    await field(page, 'Scale X').fill('3');
    await field(page, 'Scale X').press('Escape');
    await expect(field(page, 'Scale X')).toHaveValue('1.2');
    await field(page, 'Scale X').fill('big');
    await field(page, 'Scale X').press('Enter');
    await expect(field(page, 'Scale X')).toHaveValue('1.2');
    expect(await changes(viewer)).toHaveLength(3);
    expect(viewer.problems).toEqual([]);
  });
}

test('keeps what an animation sets, and moves several top nodes under one added above', async ({
  page,
}) => {
  const viewer = await openViewer(page, 'dark', PANELS_ONLY);
  await viewer.open('animated.glb', { editable: true });

  // Five top nodes: the whole model moves under a node saving adds, the seventh.
  await expect(field(page, 'Position (m) X')).toHaveValue('0');
  await field(page, 'Position (m) Y').fill('2');
  await field(page, 'Position (m) Y').press('Enter');
  expect((await changes(viewer))[0]).toMatchObject({ node: 6, to: { translation: [0, 2, 0] } });

  await row(page, 'Spinner').click();
  await expect(field(page, 'Rotation (°) X')).toBeDisabled();
  await expect(field(page, 'Position (m) X')).toBeEnabled();
  await expect(page.locator('.nm-transform-note:visible')).toHaveText('Set by an animation');
  expect(viewer.problems).toEqual([]);
});

test("offers no changes to a model that can't be saved", async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('scene.glb');
  await expect(page.locator('[data-action="measure"]')).toBeVisible();
  await expect(toolButton(page, 'move')).toBeHidden();
  await expect(page.locator('.nm-transform-input')).toHaveCount(0);
  expect(viewer.problems).toEqual([]);
});

test('moves the model with the handles in the view', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('scene.glb', { editable: true });
  const view = page.locator('.nm-viewport');
  await view.focus();
  // From the front: X runs to the right.
  await page.keyboard.press('1');
  await page.keyboard.press('g');
  await expect(toolButton(page, 'move')).toHaveAttribute('aria-pressed', 'true');

  // The X axis, in three.js's own red, through the model's origin; grabbed near its right end,
  // away from the handles that move in a plane.
  const arrow = await areaOf(page, '.nm-canvas', [255, 0, 0], 12);
  expect(arrow?.width).toBeGreaterThan(20);
  const canvas = (await page.locator('.nm-canvas').boundingBox())!;
  const start = {
    x: canvas.x + arrow!.left + arrow!.width * 0.9,
    y: canvas.y + (arrow!.top + arrow!.bottom) / 2,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 30, start.y, { steps: 5 });
  await page.mouse.move(start.x + 60, start.y, { steps: 5 });
  await page.mouse.up();

  // One change: along X only, to the right; nothing picked, and the camera stayed.
  const [change] = await changes(viewer);
  expect(change.node).toBe(0);
  expect(change.to!.translation[0]).toBeGreaterThan(0);
  expect(change.to!.translation.slice(1)).toEqual(change.from!.translation.slice(1));
  await expect(heading(page)).toHaveText(/scene\.glb\s*Model/);
  await expect(field(page, 'Position (m) X')).not.toHaveValue('0');
  await page.screenshot({ path: `${SCREENS}/transform-handles.png` });

  // Measuring takes the handles away; Escape hides them.
  await page.keyboard.press('m');
  await expect(toolButton(page, 'move')).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Escape');
  await page.keyboard.press('r');
  await expect(toolButton(page, 'rotate')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(toolButton(page, 'rotate')).toHaveAttribute('aria-pressed', 'false');
  await expect(heading(page)).toHaveText(/scene\.glb\s*Model/);
  expect(viewer.problems).toEqual([]);
});
