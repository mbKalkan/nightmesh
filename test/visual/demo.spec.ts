import { expect, test, type Locator, type Page } from '@playwright/test';
import { openViewer } from './harness';
import { menuButton, menuItem, openSample, tab } from './samples';

// Records the short demo shown at the top of the README. Not part of the test run:
// `npm run demo` records it and turns it into docs/images/demo.gif.
test.skip(!process.env.DEMO_VIDEO, 'run with npm run demo');
test.use({
  viewport: { width: 1000, height: 640 },
  deviceScaleFactor: 1,
  video: { mode: 'on', size: { width: 1000, height: 640 } },
});

/** Moves the mouse to an element and clicks it, slowly enough to follow. */
async function clickSlowly(page: Page, target: Locator) {
  const box = (await target.first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
  await page.waitForTimeout(250);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test('demo', async ({ page }) => {
  test.setTimeout(120_000);
  const viewer = await openViewer(page, 'dark');
  await openSample(page, viewer, 'CarConcept.glb');
  await page.waitForTimeout(1200);

  // Turn the car with the mouse.
  const canvas = (await page.locator('.nm-canvas').boundingBox())!;
  const middle = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
  await page.mouse.move(middle.x - 120, middle.y + 140, { steps: 8 });
  await page.mouse.down();
  await page.mouse.move(middle.x + 80, middle.y + 120, { steps: 40 });
  await page.mouse.up();
  await page.waitForTimeout(600);

  // Pick a part: the tree opens to it and the inspector says what it is.
  await page.mouse.move(middle.x, middle.y, { steps: 12 });
  await page.waitForTimeout(250);
  await page.mouse.click(middle.x, middle.y);
  await expect(page.locator('.nm-inspector-heading')).toContainText('Node');
  await page.waitForTimeout(1800);

  // Another paint; then closer, with the wireframe over it.
  await clickSlowly(page, menuButton(page, 'shading'));
  await page.waitForTimeout(400);
  await clickSlowly(page, menuItem(page, 'Pearly Swirly'));
  await page.waitForTimeout(1200);
  await page.mouse.move(middle.x, middle.y, { steps: 12 });
  await page.mouse.dblclick(middle.x, middle.y);
  await page.waitForTimeout(1500);
  await clickSlowly(page, menuButton(page, 'shading'));
  await page.waitForTimeout(400);
  await clickSlowly(page, menuItem(page, 'Wireframe'));
  await page.waitForTimeout(1500);

  // What the scene puts on the GPU.
  await clickSlowly(page, tab(page, 'Statistics'));
  await page.waitForTimeout(2000);
  expect(viewer.problems).toEqual([]);
});
