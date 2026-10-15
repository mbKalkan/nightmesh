import { expect, test, type Page } from '@playwright/test';
import { openViewer } from './harness';

/** The panels work the same with or without a 3D view, and are quicker to test without. */
const PANELS_ONLY = { withoutWebGL: true };

const row = (page: Page, label: string) =>
  page
    .locator('.nm-tree-row', {
      has: page.locator('.nm-tree-label').getByText(label, { exact: true }),
    })
    .first();
const selectedKey = (page: Page) =>
  page.locator('.nm-tree-row[aria-selected="true"]').getAttribute('data-key');
const sentOf = async (viewer: Awaited<ReturnType<typeof openViewer>>, type: string) =>
  (await viewer.sent()).filter((message) => message.type === type);

test('opens the glTF JSON at the selection, and follows it', async ({ page }) => {
  const viewer = await openViewer(page, 'dark', PANELS_ONLY);
  await viewer.open('scene.glb');

  await page.getByRole('button', { name: 'Show glTF JSON' }).click();
  expect(await sentOf(viewer, 'json')).toEqual([{ type: 'json', pointer: '' }]);

  await row(page, 'Sphere').click();
  expect((await sentOf(viewer, 'selected')).at(-1)).toEqual({
    type: 'selected',
    pointer: '/nodes/2',
  });
  await page.getByRole('button', { name: 'Show glTF JSON' }).click();
  expect((await sentOf(viewer, 'json')).at(-1)).toEqual({ type: 'json', pointer: '/nodes/2' });

  // From the Command Palette, the selection; from the context menu, what was right-clicked.
  await viewer.post({ type: 'showJson', atPointer: false });
  expect((await sentOf(viewer, 'json')).at(-1)).toEqual({ type: 'json', pointer: '/nodes/2' });
  await row(page, 'Meshes').click({ button: 'right' });
  await viewer.post({ type: 'showJson', atPointer: true });
  expect((await sentOf(viewer, 'json')).at(-1)).toEqual({ type: 'json', pointer: '/meshes' });
  expect(viewer.problems).toEqual([]);
});

test('selects what the cursor is in, in the glTF JSON', async ({ page }) => {
  const viewer = await openViewer(page, 'dark', PANELS_ONLY);
  await viewer.open('scene.glb');
  const selections = (await sentOf(viewer, 'selected')).length;

  await viewer.post({ type: 'select', pointer: '/nodes/2/translation' });
  await expect.poll(() => selectedKey(page)).toBe('node:2');
  await viewer.post({ type: 'select', pointer: '/accessors/0' });
  await expect.poll(() => selectedKey(page)).toMatch(/^mesh:\d+$/);
  // The document made those selections; it isn't told about them again.
  expect(await sentOf(viewer, 'selected')).toHaveLength(selections);
  expect(viewer.problems).toEqual([]);
});

test('shows a validation issue in the glTF JSON, where it points', async ({ page }) => {
  const viewer = await openViewer(page, 'dark', PANELS_ONLY);
  await viewer.open('truncated.glb');
  await viewer.post(await viewer.validation('truncated.glb'));
  await page.locator('.nm-panel-tab', { hasText: 'Validation' }).click();

  const pointer = '/meshes/1/primitives/0/attributes/TEXCOORD_0';
  await page.getByRole('button', { name: 'Show in glTF JSON' }).nth(1).click();
  expect((await sentOf(viewer, 'json')).at(-1)).toEqual({ type: 'json', pointer });

  await page.getByRole('button', { name: pointer }).click({ button: 'right' });
  await viewer.post({ type: 'showJson', atPointer: true });
  expect((await sentOf(viewer, 'json')).at(-1)).toEqual({ type: 'json', pointer });
  expect(viewer.problems).toEqual([]);
});
