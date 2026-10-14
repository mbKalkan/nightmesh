import { expect, test } from '@playwright/test';
import { lowestTextContrast } from './contrast';
import { openViewer } from './harness';
import type { ThemeName } from './themes';

const SCREENS = 'test-results/screens';

test('says the model is loading, and how much has arrived, once it takes a moment', async ({
  page,
}) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.post(viewer.openMessage('scene.glb'));
  const messages = await viewer.messages('scene.glb');
  const model = messages.findIndex((message) => message.type === 'model');
  for (const message of messages.slice(0, model + 1)) await viewer.post(message);

  const loading = page.locator('.nm-loading');
  // Software WebGL in CI holds the page for seconds while it starts the 3D view.
  await expect(loading).toBeVisible({ timeout: 30_000 });
  await expect(loading).toContainText('Loading…');
  await expect(page.locator('.nm-loading-detail')).toHaveText(/^0 B of [\d.]+ KB$/);
  // The panels show the structure meanwhile.
  await expect(page.locator('.nm-tree-row').first()).toBeVisible();

  for (const message of messages.slice(model + 1)) await viewer.post(message);
  await page.waitForSelector('.nm-viewport[data-state="shown"]');
  await expect(loading).toBeHidden();
  expect(viewer.problems).toEqual([]);
});

for (const theme of ['dark', 'light'] as ThemeName[]) {
  test(`asks before drawing a large model, ${theme} theme`, async ({ page }) => {
    const viewer = await openViewer(page, theme);
    await viewer.post(viewer.openMessage('scene.glb'));
    const messages = await viewer.messages('scene.glb', { largeBytes: 1000 });
    const large = messages.findIndex((message) => message.type === 'large');
    for (const message of messages.slice(0, large + 1)) await viewer.post(message);

    const prompt = page.locator('.nm-large');
    await expect(prompt).toBeVisible();
    await expect(page.locator('.nm-large-title')).toHaveText('This model is large');
    await expect(page.locator('.nm-large-message')).toContainText(
      /loading [\d.]+ KB into the view/,
    );
    await expect(page.locator('.nm-loading')).toBeHidden();
    expect(await lowestTextContrast(page)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `${SCREENS}/large-${theme}.png` });

    await page.getByRole('button', { name: 'Draw Model' }).click();
    await expect(prompt).toBeHidden();
    await expect
      .poll(async () => (await viewer.sent()).some((message) => message.type === 'draw'))
      .toBe(true);
    for (const message of messages.slice(large + 1)) await viewer.post(message);
    await page.waitForSelector('.nm-viewport[data-state="shown"]');
    expect(viewer.problems).toEqual([]);
  });
}
