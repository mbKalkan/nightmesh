import { expect, test, type Page } from '@playwright/test';
import { lowestTextContrast } from './contrast';
import { openViewer } from './harness';
import { areaOf } from './pixels';
import type { ThemeName } from './themes';

const SCREENS = 'test-results/screens';

/** Clicks the viewport at a fraction of its width and height. */
async function clickView(page: Page, x: number, y: number) {
  const box = (await page.locator('.nm-viewport').boundingBox())!;
  await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
}

const badge = (page: Page) => page.locator('.nm-measure');
const button = (page: Page) => page.locator('[data-action="measure"]');
const heading = (page: Page) => page.locator('.nm-inspector-heading');

// The bracket as it first shows: a plate 25 mm tall standing on a base 5 mm thick. These are
// the tops of the two, where they show in the view.
const PLATE_TOP = [0.241, 0.29] as const;
const BASE_TOP = [0.518, 0.6] as const;
/** From the top of the plate to the top of the base: 20 mm down, any way across. */
const PLATE_TO_BASE =
  /^Distance: (\d+(?:\.\d+)?) mm \(X \d+(?:\.\d+)? mm, Y 20 mm, Z \d+(?:\.\d+)? mm\)$/;

test.use({ reducedMotion: 'reduce' });

for (const theme of ['dark', 'light'] as ThemeName[]) {
  test(`measures the distance between two points clicked on the model, ${theme} theme`, async ({
    page,
  }) => {
    const viewer = await openViewer(page, theme);
    await viewer.open('bracket.stl');
    await page.locator('.nm-viewport').focus();
    await page.keyboard.press('m');
    await expect(button(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(badge(page)).toHaveText('Click a point on the model');

    // Clicks place points; they don't select.
    await clickView(page, ...PLATE_TOP);
    await expect(badge(page)).toHaveText('Click a second point');
    await expect(heading(page)).toHaveText(/bracket\.stl\s*Model/);
    await clickView(page, ...BASE_TOP);
    await expect(badge(page)).toHaveAttribute('aria-label', PLATE_TO_BASE);
    const total = PLATE_TO_BASE.exec((await badge(page).getAttribute('aria-label'))!)![1];
    // The length over the line, and the same said to screen readers.
    await expect(page.locator('.nm-ruler-label')).toHaveText(`${total} mm`);
    await expect(page.locator('[data-announcer]')).toHaveText(PLATE_TO_BASE);
    expect(await lowestTextContrast(page)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `${SCREENS}/measure-${theme}.png` });

    // A third point starts again.
    await clickView(page, ...PLATE_TOP);
    await expect(badge(page)).toHaveText('Click a second point');
    await expect(page.locator('.nm-ruler-label')).toBeHidden();

    // Escape stops measuring: the size is back, and clicks select again.
    await page.keyboard.press('Escape');
    await expect(button(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(badge(page)).toHaveAttribute(
      'aria-label',
      /^Size of the model.*: 40 mm × 25 mm × 20 mm$/,
    );
    await clickView(page, ...BASE_TOP);
    await expect(heading(page)).toHaveText(/bracket\.stl\s*Node 0/);
    expect(viewer.problems).toEqual([]);
  });
}

test('keeps a measurement on the model when its units change', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('bracket.stl');
  await button(page).click();
  await clickView(page, ...PLATE_TOP);
  await clickView(page, ...BASE_TOP);
  await expect(badge(page)).toHaveAttribute('aria-label', PLATE_TO_BASE);

  // In inches the numbers of the file stay, and so does the measurement.
  await page.locator('[data-action="view"]').click();
  await page
    .locator('.nm-menu .nm-menu-item', { has: page.getByText('Inches', { exact: true }) })
    .click();
  await expect(badge(page)).toHaveAttribute('aria-label', /, Y 20 in, /);
  await expect(page.locator('.nm-ruler-label')).toHaveText(/ in$/);

  // The button stops it too.
  await button(page).click();
  await expect(page.locator('.nm-ruler-label')).toBeHidden();
  await expect(badge(page)).toHaveAttribute(
    'aria-label',
    /^Size of the model.*: 40 in × 25 in × 20 in$/,
  );
  expect(viewer.problems).toEqual([]);
});

/** The front corners at the bottom of the base, at either end, a few pixels off each. */
const BASE_LEFT = { x: 304 + 3, y: 500 - 2 };
const BASE_RIGHT = { x: 655 - 3, y: 632 + 2 };
/** The dark theme's focus border, which the ruler is drawn in. */
const FOCUS = [0x00, 0x78, 0xd4];

test('snaps to a corner near the click, ringed before it is clicked', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('bracket.stl');
  await button(page).click();
  await page.locator('.nm-measure').evaluate((badge) => (badge.style.visibility = 'hidden'));

  // Resting near the corner rings it: the ring's middle is on the corner, not the pointer.
  await page.mouse.move(BASE_LEFT.x, BASE_LEFT.y);
  const canvas = (await page.locator('.nm-canvas').boundingBox())!;
  await expect
    .poll(async () => {
      const ring = await areaOf(page, '.nm-canvas', FOCUS);
      if (!ring) return Infinity;
      const x = canvas.x + (ring.left + ring.right) / 2;
      const y = canvas.y + (ring.top + ring.bottom) / 2;
      return Math.hypot(x - 304, y - 500);
    })
    .toBeLessThanOrEqual(2);
  await page.mouse.move(BASE_LEFT.x + 200, BASE_LEFT.y - 300);
  await expect.poll(() => areaOf(page, '.nm-canvas', FOCUS)).toBeUndefined();

  // From corner to corner: the base's length, exactly.
  await page.mouse.click(BASE_LEFT.x, BASE_LEFT.y);
  await page.mouse.click(BASE_RIGHT.x, BASE_RIGHT.y);
  await expect(badge(page)).toHaveAttribute(
    'aria-label',
    'Distance: 40 mm (X 40 mm, Y 0 mm, Z 0 mm)',
  );
  await expect(page.locator('.nm-ruler-label')).toHaveText('40 mm');
  await page.screenshot({ path: `${SCREENS}/measure-snap-dark.png` });
  expect(viewer.problems).toEqual([]);
});

test('snaps to skinned vertices as they are posed', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('animated.glb');
  // A second into the wave, the arm's top half is bent far to the right.
  await page.locator('.nm-clips').selectOption('Wave');
  await page.locator('.nm-timeline').evaluate((slider) => {
    (slider as HTMLInputElement).value = '1';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await button(page).click();
  await page.locator('.nm-measure').evaluate((badge) => (badge.style.visibility = 'hidden'));

  // At the bend, right of where the arm stands unposed, a vertex is ringed.
  await page.mouse.move(633, 288);
  const canvas = (await page.locator('.nm-canvas').boundingBox())!;
  await expect
    .poll(async () => {
      const ring = await areaOf(page, '.nm-canvas', FOCUS);
      if (!ring) return Infinity;
      const x = canvas.x + (ring.left + ring.right) / 2;
      const y = canvas.y + (ring.top + ring.bottom) / 2;
      return Math.hypot(x - 633, y - 288);
    })
    .toBeLessThanOrEqual(8);

  // Across the arm below the bend: its width, exactly.
  await page.mouse.click(560, 420);
  await page.mouse.click(578, 420);
  await expect(badge(page)).toHaveAttribute(
    'aria-label',
    'Distance: 0.2 m (X 0.2 m, Y 0 m, Z 0 m)',
  );
  expect(viewer.problems).toEqual([]);
});

test('snaps to the vertices of every GPU instance', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  // Three one-metre boxes, two metres apart, drawn as instances of one mesh.
  await viewer.open('instanced.glb');
  await page.locator('.nm-viewport').focus();
  await page.keyboard.press('1');
  await page.keyboard.press('m');
  // From the first box's front bottom left corner to the third's.
  await page.mouse.click(266 + 3, 448 - 2);
  await page.mouse.click(673 + 3, 448 - 2);
  await expect(badge(page)).toHaveAttribute('aria-label', 'Distance: 4 m (X 4 m, Y 0 m, Z 0 m)');
  await page.screenshot({ path: `${SCREENS}/measure-instanced-dark.png` });
  expect(viewer.problems).toEqual([]);
});
