import { expect, test, type Page } from '@playwright/test';
import { openViewer } from './harness';
import { menuButton, menuItem, openSample, tab } from './samples';

// The README's screenshots, from the Khronos samples `npm run screenshots` downloads. Skipped in
// ordinary runs: they need the samples, and are pictures rather than checks.
test.skip(!process.env.README_SCREENSHOTS, 'run with npm run screenshots');
test.use({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: 1 });

const IMAGES = 'docs/images';

const row = (page: Page, label: string) =>
  page
    .locator('.nm-tree-row', {
      has: page.locator('.nm-tree-label').getByText(label, { exact: true }),
    })
    .first();

/** Lets the last frame and any transition settle before the picture. */
const settle = (page: Page) => page.waitForTimeout(600);

test('a part picked in the view, with its node in the structure and inspector', async ({
  page,
}) => {
  const viewer = await openViewer(page, 'dark');
  await openSample(page, viewer, 'CarConcept.glb');
  // The front wheel, as the model is framed when it opens.
  await page.mouse.click(600, 488);
  await expect(page.locator('.nm-inspector-heading')).toContainText('Node');
  await settle(page);
  await page.screenshot({ path: `${IMAGES}/inspector-dark.png` });
  expect(viewer.problems).toEqual([]);
});

test('the statistics of a model', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await openSample(page, viewer, 'CarConcept.glb');
  await tab(page, 'Statistics').click();
  await settle(page);
  await page.screenshot({ path: `${IMAGES}/statistics-dark.png` });
  expect(viewer.problems).toEqual([]);
});

test('where the bytes of a model go, and how it could be lighter', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await openSample(page, viewer, 'CarConcept.glb');
  await tab(page, 'Size').click();
  await settle(page);
  await page.screenshot({ path: `${IMAGES}/size-dark.png` });
  expect(viewer.problems).toEqual([]);
});

test('what the glTF Validator found, in a light theme', async ({ page }) => {
  const viewer = await openViewer(page, 'light');
  await openSample(page, viewer, 'ToyCar.glb', { validate: true });
  await tab(page, 'Validation').click();
  await settle(page);
  await page.screenshot({ path: `${IMAGES}/validation-light.png` });
  expect(viewer.problems).toEqual([]);
});

test('a material variant and a wireframe from the Shading menu', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await openSample(page, viewer, 'SheenChair.glb');
  await menuButton(page, 'shading').click();
  await menuItem(page, 'Peacock Velvet').click();
  await menuButton(page, 'shading').click();
  await menuItem(page, 'Wireframe').click();
  await menuButton(page, 'shading').click();
  await settle(page);
  await page.screenshot({ path: `${IMAGES}/shading-dark.png` });
  expect(viewer.problems).toEqual([]);
});

test('an animation playing', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await openSample(page, viewer, 'Fox.glb');
  await row(page, 'Animations').click();
  await page.keyboard.press('ArrowRight');
  await row(page, 'Run').click();
  await page.locator('.nm-play').click();
  await page.waitForTimeout(1500);
  await page.locator('.nm-play').click();
  await settle(page);
  await page.screenshot({ path: `${IMAGES}/animation-dark.png` });
  expect(viewer.problems).toEqual([]);
});

test('the View menu in a light theme', async ({ page }) => {
  const viewer = await openViewer(page, 'light');
  await openSample(page, viewer, 'ToyCar.glb');
  await menuButton(page, 'view').click();
  await menuItem(page, 'Bounding Box').click();
  await menuButton(page, 'view').click();
  await settle(page);
  await page.screenshot({ path: `${IMAGES}/view-light.png` });
  expect(viewer.problems).toEqual([]);
});
