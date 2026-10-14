import { expect, test, type Page } from '@playwright/test';
import { lowestTextContrast } from './contrast';
import { openViewer } from './harness';
import type { ThemeName } from './themes';

const SCREENS = 'test-results/screens';

const bar = (page: Page) => page.locator('.nm-animation');
const clips = (page: Page) => page.locator('.nm-clips');
const play = (page: Page) => page.locator('.nm-play');
const clock = (page: Page) => page.locator('.nm-clock');
const badge = (page: Page) => page.locator('.nm-measure');

/** Moves the time line as dragging it would. */
async function scrub(page: Page, time: number) {
  await page.locator('.nm-timeline').evaluate((slider, value) => {
    (slider as HTMLInputElement).value = String(value);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  }, time);
}

for (const theme of ['dark', 'light', 'hcDark', 'hcLight'] as ThemeName[]) {
  test(`plays animations from a bar below the view, ${theme} theme`, async ({ page }) => {
    const viewer = await openViewer(page, theme);
    await viewer.open('animated.glb');

    await expect(bar(page)).toBeVisible();
    await expect(clips(page).locator('option')).toHaveText(['Spin', 'Bounce', 'Morph', 'Wave']);
    await expect(play(page)).toHaveAttribute('aria-label', 'Play (Space)');
    await expect(clock(page)).toHaveText('0.00 / 2.00 s');
    expect(await lowestTextContrast(page)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `${SCREENS}/animation-${theme}.png` });
    expect(viewer.problems).toEqual([]);
  });
}

test('plays, pauses and scrubs, and the model moves', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('animated.glb');
  const still = await badge(page).textContent();

  await play(page).click();
  await expect(play(page)).toHaveAttribute('aria-label', 'Pause (Space)');
  await expect.poll(async () => (await clock(page).textContent())!).not.toBe('0.00 / 2.00 s');
  await play(page).click();
  await expect(play(page)).toHaveAttribute('aria-label', 'Play (Space)');
  const paused = await clock(page).textContent();
  await page.waitForTimeout(200);
  await expect(clock(page)).toHaveText(paused!);

  // A quarter turn into the spin, the model's box is wider than at rest.
  await scrub(page, 0.25);
  await expect(clock(page)).toHaveText('0.25 / 2.00 s');
  await expect(badge(page)).not.toHaveText(still!);
  await scrub(page, 0);
  await expect(badge(page)).toHaveText(still!);
  expect(viewer.problems).toEqual([]);
});

test('picks the clip from the bar, the tree, and plays it with Space', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('animated.glb');

  await clips(page).selectOption('Morph');
  await expect(clips(page)).toHaveValue('2');
  await page.locator('.nm-tree-row', { hasText: /^Animations/ }).click();
  await page.locator('.nm-tree-row', { hasText: /^Wave$/ }).click();
  await expect(clips(page)).toHaveValue('3');
  await expect(page.locator('.nm-inspector-heading')).toHaveText(/Wave\s*Animation 3/);

  await page.locator('.nm-viewport').focus();
  await page.keyboard.press('Space');
  await expect(play(page)).toHaveAttribute('aria-label', 'Pause (Space)');
  await page.keyboard.press('Space');
  await expect(play(page)).toHaveAttribute('aria-label', 'Play (Space)');

  // Changing the file on disk keeps the clip.
  await viewer.open('animated.glb', { reload: true });
  await expect(clips(page)).toHaveValue('3');
  expect(viewer.problems).toEqual([]);
});

test('has no bar for a model without animations', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('animated.glb');
  await expect(bar(page)).toBeVisible();
  await viewer.open('scene.glb');
  await expect(bar(page)).toBeHidden();
  expect(viewer.problems).toEqual([]);
});

test('pauses with a slow click while the clip plays', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('animated.glb');
  await play(page).click();
  await expect(play(page)).toHaveAttribute('aria-label', 'Pause (Space)');

  // A person's click: the button is held for a few frames before it is let go.
  const box = (await play(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.up();
  await expect(play(page)).toHaveAttribute('aria-label', 'Play (Space)');
  expect(viewer.problems).toEqual([]);
});

test('plays and pauses with Space from anywhere but the panels', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('animated.glb');
  // A node selected in the tree: Space there belongs to the tree.
  await page.locator('.nm-tree-row', { hasText: /^Spinner$/ }).click();
  await page.keyboard.press('Space');
  await expect(play(page)).toHaveAttribute('aria-label', 'Play (Space)');

  // Anywhere else, Space plays and pauses: the clock is not a control, focus leaves the tree.
  await clock(page).click();
  await page.keyboard.press('Space');
  await expect(play(page)).toHaveAttribute('aria-label', 'Pause (Space)');
  await page.keyboard.press('Space');
  await expect(play(page)).toHaveAttribute('aria-label', 'Play (Space)');
  expect(viewer.problems).toEqual([]);
});
