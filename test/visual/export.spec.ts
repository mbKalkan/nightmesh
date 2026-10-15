import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { openViewer } from './harness';

const SCREENS = 'test-results/screens';

const menu = (page: Page) => page.getByRole('button', { name: 'Export' });
const item = (page: Page, name: string) => page.getByRole('menuitem', { name });

test('saves a report on the model, as Markdown and JSON', async ({ page }) => {
  const viewer = await openViewer(page, 'dark', { withoutWebGL: true });
  await viewer.open('truncated.glb');
  await viewer.post(await viewer.validation('truncated.glb'));

  await menu(page).click();
  // Without a 3D view there is nothing to take a picture of.
  await expect(item(page, 'Save Screenshot…')).toHaveCount(0);
  await item(page, 'Save Report…').click();
  const saved = (await viewer.sent()).find((message) => message.type === 'save') as unknown as {
    what: string;
    markdown: string;
    json: string;
  };
  expect(saved.what).toBe('report');
  writeFileSync(`${SCREENS}/report.md`, saved.markdown);
  expect(saved.markdown).toMatch(/^# truncated\.glb\n/);
  for (const heading of ['## Statistics', '## Size', '## Validation']) {
    expect(saved.markdown).toContain(`\n${heading}\n`);
  }
  expect(saved.markdown).toContain('| Error | `GLB_UNEXPECTED_END_OF_CHUNK_DATA` |');
  expect(JSON.parse(saved.json).validation.counts.error).toBe(1);

  // From the Command Palette too.
  await viewer.post({ type: 'export', what: 'report' });
  await expect
    .poll(async () => (await viewer.sent()).filter((message) => message.type === 'save').length)
    .toBe(2);
  expect(viewer.problems).toEqual([]);
});

test('saves a screenshot of the view as a PNG', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('scene.glb');

  await menu(page).click();
  await item(page, 'Save Screenshot…').click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const sent = (window as unknown as { __sent: { type: string; data?: Uint8Array }[] })
          .__sent;
        const data = sent.find((message) => message.type === 'save')?.data;
        return data ? [...data.subarray(0, 8)] : undefined;
      }),
    )
    .toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const size = await page.evaluate(() => {
    const sent = (window as unknown as { __sent: { type: string; data?: Uint8Array }[] }).__sent;
    const data = sent.find((message) => message.type === 'save')!.data!;
    const view = new DataView(data.buffer, data.byteOffset);
    // A PNG's IHDR chunk gives its width and height.
    return [view.getUint32(16), view.getUint32(20)];
  });
  const canvas = await page
    .locator('.nm-canvas')
    .evaluate((element: HTMLCanvasElement) => [element.width, element.height]);
  expect(size).toEqual(canvas);
  expect(viewer.problems).toEqual([]);
});

test('says when there is nothing to take a picture of', async ({ page }) => {
  const viewer = await openViewer(page, 'dark', { withoutWebGL: true });
  await viewer.open('scene.glb');
  await viewer.post({ type: 'export', what: 'screenshot' });
  await expect
    .poll(async () => (await viewer.sent()).find((message) => message.type === 'save'))
    .toEqual({ type: 'save', what: 'screenshot' });
});
