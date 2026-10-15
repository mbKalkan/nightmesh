import { expect, test, type Page } from '@playwright/test';
import { lowestTextContrast } from './contrast';
import { openViewer } from './harness';
import type { ThemeName } from './themes';

const SCREENS = 'test-results/screens';
/** The panels work the same with or without a 3D view, and are quicker to test without. */
const PANELS_ONLY = { withoutWebGL: true };

const tab = (page: Page) => page.locator('.nm-panel-tab', { hasText: 'Validation' });
const status = (page: Page) => page.locator('.nm-validation .nm-note-line').first();
const issues = (page: Page) => page.locator('.nm-issue');
const filter = (page: Page, label: string) => page.locator(`.nm-filter[title^="${label}:"]`);

for (const theme of ['dark', 'light', 'hcDark', 'hcLight'] as ThemeName[]) {
  test(`lists what the glTF Validator found, ${theme} theme`, async ({ page }) => {
    const viewer = await openViewer(page, theme, PANELS_ONLY);
    await viewer.open('truncated.glb');
    await tab(page).click();
    await expect(status(page)).toHaveText('The model is validated once it has loaded.');
    await expect(tab(page).locator('.nm-badge')).toHaveCount(0);

    await viewer.post({ type: 'validation', loadId: 1, state: 'running' });
    await expect(status(page)).toHaveText('Validating…');
    await viewer.post(await viewer.validation('truncated.glb'));

    await expect(status(page)).toHaveText(/^Checked by the Khronos glTF Validator 2\./);
    await expect(tab(page).locator('.nm-badge')).toHaveText('1');
    await expect(tab(page)).toHaveAttribute('title', 'Errors: 1, warnings: 0');
    await expect(filter(page, 'Errors')).toHaveText('1');
    await expect(filter(page, 'Infos')).toHaveText('2');
    await expect(issues(page)).toHaveCount(3);
    await expect(issues(page).first()).toContainText('Unexpected end of chunk data.');
    await expect(issues(page).first()).toContainText(/GLB_UNEXPECTED_END_OF_CHUNK_DATA\s*Byte \d+/);
    await expect(issues(page).first().locator('[role="img"]')).toHaveAttribute(
      'aria-label',
      'Error',
    );
    expect(await lowestTextContrast(page)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `${SCREENS}/validation-${theme}.png` });
    expect(viewer.problems).toEqual([]);
  });
}

test('selects what an issue is about, and filters by severity', async ({ page }) => {
  const viewer = await openViewer(page, 'dark', PANELS_ONLY);
  await viewer.open('truncated.glb');
  await viewer.post(await viewer.validation('truncated.glb'));
  await tab(page).click();

  const pointer = page.getByRole('button', {
    name: '/meshes/1/primitives/0/attributes/TEXCOORD_0',
  });
  await expect(pointer).toHaveAttribute('title', /, Mesh 1$/);
  await pointer.click();
  await expect(page.locator('.nm-tree-row[aria-selected="true"]')).toHaveAttribute(
    'data-key',
    'mesh:1',
  );

  await filter(page, 'Infos').click();
  await expect(filter(page, 'Infos')).toHaveAttribute('aria-pressed', 'false');
  await expect(filter(page, 'Infos')).toBeFocused();
  await expect(issues(page)).toHaveCount(1);
  await filter(page, 'Errors').click();
  await expect(issues(page)).toHaveCount(0);
  await filter(page, 'Infos').click();
  await expect(issues(page)).toHaveCount(2);
});

test('says when a model has no issues, and when a resource is missing', async ({ page }) => {
  const viewer = await openViewer(page, 'dark', PANELS_ONLY);
  await viewer.open('textured.gltf');
  await viewer.post(await viewer.validation('textured.gltf'));
  await tab(page).click();
  await expect(page.locator('.nm-validation-clean')).toHaveText('No issues found.');
  await expect(tab(page).locator('.nm-badge')).toHaveCount(0);

  await viewer.open('missing-resource.gltf');
  await expect(status(page)).toHaveText('The model is validated once it has loaded.');
  await viewer.post(await viewer.validation('missing-resource.gltf'));
  await expect(issues(page).first()).toContainText("missing.bin wasn't found next to the model.");
  await expect(issues(page).first()).toContainText(/IO_ERROR\s*\/buffers\/0\/uri/);
});

test('keeps the last report while a changed file is validated again', async ({ page }) => {
  const viewer = await openViewer(page, 'dark', PANELS_ONLY);
  await viewer.open('truncated.glb');
  await viewer.post(await viewer.validation('truncated.glb'));
  await tab(page).click();

  await viewer.open('truncated.glb', { reload: true });
  await viewer.post({ type: 'validation', loadId: 2, state: 'running' });
  await expect(status(page)).toHaveText('Validating…');
  await expect(issues(page)).toHaveCount(3);
  // A validation of a load that was replaced is left out.
  await viewer.post({ type: 'validation', loadId: 1, state: 'failed' });
  await expect(status(page)).toHaveText('Validating…');
  await viewer.post({ type: 'validation', loadId: 2, state: 'tooLarge', bytes: 2 * 1024 ** 3 });
  await expect(status(page)).toHaveText('This model is too large to validate here: 2 GB.');
  await expect(issues(page)).toHaveCount(0);
});
