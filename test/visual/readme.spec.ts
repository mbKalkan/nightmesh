import { expect, test, type Page } from '@playwright/test';
import { openViewer } from './harness';

// The README's screenshots, from the Khronos samples `npm run screenshots` downloads. Skipped in
// ordinary runs: they need the samples, and are pictures rather than checks.
test.skip(!process.env.README_SCREENSHOTS, 'run with npm run screenshots');
test.use({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: 1 });

const IMAGES = 'docs/images';
const SAMPLE = (name: string) => `../../.cache/samples/${name}`;

const row = (page: Page, label: string) =>
  page
    .locator('.nm-tree-row', {
      has: page.locator('.nm-tree-label').getByText(label, { exact: true }),
    })
    .first();

test('explore', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  for (const name of ['ToyCar.glb', 'SheenChair.glb', 'Fox.glb']) {
    await viewer.open(SAMPLE(name));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `test-results/screens/explore-${name}.png` });
  }
  expect(viewer.problems).toEqual([]);
  void row;
  void IMAGES;
});
