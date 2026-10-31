import { expect, test, type Page } from '@playwright/test';
import { openViewer } from './harness';
import type { ThemeName } from './themes';

const SCREENS = 'test-results/screens';

/** An inspector section's rows as `label value` text. */
const section = (page: Page, title: string) =>
  page
    .locator('.nm-section', { has: page.locator('.nm-section-title', { hasText: title }) })
    .first()
    .locator('dt, dd');

for (const theme of ['dark', 'light'] as ThemeName[]) {
  test(`checks a glTF model's triangles where its nodes put them, ${theme} theme`, async ({
    page,
  }) => {
    const viewer = await openViewer(page, theme);
    // Three one-metre boxes, drawn as GPU instances of one mesh.
    await viewer.open('instanced.glb');
    await expect(section(page, 'Mesh check')).toHaveText([
      'Surface area',
      '18 m²',
      'Volume',
      '3 m³',
      'Watertight',
      'Yes',
      'Shells',
      '3',
    ]);
    await page.screenshot({ path: `${SCREENS}/gltf-check-${theme}.png` });

    // The report has it too, in metres.
    await viewer.post({ type: 'export', what: 'report' });
    await expect
      .poll(async () => (await viewer.sent()).some((message) => message.type === 'save'))
      .toBe(true);
    const saved = (await viewer.sent()).find((message) => message.type === 'save') as unknown as {
      markdown: string;
      json: string;
    };
    expect(saved.markdown).toContain('## Mesh check');
    expect(JSON.parse(saved.json).check).toMatchObject({ volume: 3, shells: 3, unit: 'm' });
    expect(viewer.problems).toEqual([]);
  });
}

test('checks a Draco compressed model as it is drawn', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('draco.glb');
  await expect(section(page, 'Mesh check')).toContainText(['Surface area', 'Watertight']);
  expect(viewer.problems).toEqual([]);
});
