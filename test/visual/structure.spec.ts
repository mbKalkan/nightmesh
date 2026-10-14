import { expect, test, type Page } from '@playwright/test';
import { lowestTextContrast } from './contrast';
import { openViewer } from './harness';
import { areaOf } from './pixels';
import type { ThemeName } from './themes';

const SCREENS = 'test-results/screens';
/** The panels work the same with or without a 3D view, and are quicker to test without. */
const PANELS_ONLY = { withoutWebGL: true };

const tree = (page: Page) => page.locator('.nm-tree');
/** The first tree row labelled exactly `label`. */
const row = (page: Page, label: string) =>
  page
    .locator('.nm-tree-row', {
      has: page.locator('.nm-tree-label').getByText(label, { exact: true }),
    })
    .first();
const heading = (page: Page) => page.locator('.nm-inspector-heading');
/** An inspector section's rows as `label value` text. */
const section = (page: Page, title: string) =>
  page
    .locator('.nm-section', { has: page.locator('.nm-section-title', { hasText: title }) })
    .first()
    .locator('dt, dd');

for (const theme of ['dark', 'light', 'hcDark', 'hcLight'] as ThemeName[]) {
  test(`shows the structure and what is selected in it, ${theme} theme`, async ({ page }) => {
    const viewer = await openViewer(page, theme);
    await viewer.open('scene.glb');

    await expect(page.locator('.nm-panel-left .nm-panel-title')).toHaveText('Structure');
    await expect(page.locator('.nm-panel-right [role="tab"][aria-selected="true"]')).toHaveText(
      'Inspector',
    );
    await expect(heading(page)).toHaveText(/scene\.glb\s*Model/);
    await row(page, 'Sphere').click();
    await expect(row(page, 'Sphere')).toHaveAttribute('aria-selected', 'true');
    await expect(heading(page)).toHaveText(/Sphere\s*Node 2/);
    await expect(section(page, 'Transform')).toContainText(['translation', '[0, 0.5, 0]']);
    expect(await lowestTextContrast(page)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `${SCREENS}/structure-${theme}.png` });

    await page.locator('.nm-panel-tab', { hasText: 'Statistics' }).click();
    await expect(page.locator('.nm-table')).toBeVisible();
    expect(await lowestTextContrast(page)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `${SCREENS}/statistics-${theme}.png` });
    expect(viewer.problems).toEqual([]);
  });
}

test('shows the structure before the model has arrived', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.post(viewer.openMessage('scene.glb'));
  const messages = await viewer.messages('scene.glb');
  for (const type of ['structure', 'images', 'model']) {
    await viewer.post(messages.find((message) => message.type === type)!);
  }

  await expect(row(page, 'Root')).toBeVisible();
  await expect(page.locator('.nm-progress')).toBeVisible();
  await expect(page.locator('.nm-viewport')).not.toHaveAttribute('data-state');
  expect(viewer.problems).toEqual([]);
});

test('moves through the tree with the keyboard', async ({ page }) => {
  const viewer = await openViewer(page, 'dark', PANELS_ONLY);
  await viewer.open('scene.glb');
  await tree(page).focus();

  await page.keyboard.press('ArrowDown');
  await expect(heading(page)).toHaveText(/Main\s*Scene 0/);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(heading(page)).toHaveText(/Group\s*Node 3/);
  await expect(row(page, 'Small Box')).toBeHidden();
  await page.keyboard.press('ArrowRight');
  await expect(row(page, 'Group')).toHaveAttribute('aria-expanded', 'true');
  await expect(row(page, 'Small Box')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(heading(page)).toHaveText(/Small Box\s*Node 4/);
  await page.keyboard.press('ArrowLeft');
  await expect(heading(page)).toHaveText(/Group/);
  await page.keyboard.press('ArrowLeft');
  await expect(row(page, 'Small Box')).toBeHidden();
  // Typing jumps to a name.
  await page.keyboard.type('lam');
  await expect(heading(page)).toHaveText(/Lamp\s*Node 10/);
  await page.keyboard.press('End');
  await expect(row(page, 'Lights')).toHaveClass(/nm-focused/);
  await page.keyboard.press('Enter');
  await expect(row(page, 'Lights')).toHaveAttribute('aria-expanded', 'true');

  const active = await tree(page).getAttribute('aria-activedescendant');
  await expect(page.locator(`#${active}`)).toHaveAttribute('aria-level', '1');
  expect(viewer.problems).toEqual([]);
});

test('follows links in the inspector to what they name', async ({ page }) => {
  const viewer = await openViewer(page, 'dark', PANELS_ONLY);
  await viewer.open('scene.glb');
  await row(page, 'Sphere').click();

  await page.locator('.nm-link', { hasText: 'Clay' }).click();
  await expect(heading(page)).toHaveText(/Clay\s*Material 0/);
  await expect(row(page, 'Materials')).toHaveAttribute('aria-expanded', 'true');
  await expect(row(page, 'Clay')).toHaveAttribute('aria-selected', 'true');
  await expect(section(page, 'pbrMetallicRoughness')).toContainText(['baseColorFactor']);

  await page.locator('.nm-link', { hasText: 'Box' }).first().click();
  await expect(heading(page)).toHaveText(/Box\s*Mesh 0/);
  await page.locator('.nm-link', { hasText: 'Small Box' }).click();
  await expect(row(page, 'Small Box')).toHaveAttribute('aria-selected', 'true');
  await expect(row(page, 'Group')).toHaveAttribute('aria-expanded', 'true');
  expect(viewer.problems).toEqual([]);
});

test('shows the structure of a model it cannot draw', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('unsupported-extension.glb');

  await expect(page.locator('.nm-error-message')).toContainText('EXT_nightmesh_unknown');
  await expect(row(page, 'Model')).toBeVisible();
  await expect(section(page, 'Extensions')).toHaveText(['EXT_nightmesh_unknownRequired']);
  expect(viewer.problems).toEqual([]);
});

test('has no panels for a file that is not a model', async ({ page }) => {
  const viewer = await openViewer(page, 'dark', PANELS_ONLY);
  await viewer.open('scene.glb');
  await expect(page.locator('.nm-panel-left')).toBeVisible();
  await viewer.open('not-a-model.glb', { reload: false });

  await expect(page.locator('.nm-panel')).toHaveCount(2);
  await expect(page.locator('.nm-panel-left')).toBeHidden();
  await expect(page.locator('.nm-panel-right')).toBeHidden();
  await expect(page.locator('.nm-actions')).toBeHidden();
});

test('hides, shows and resizes the panels', async ({ page }) => {
  const viewer = await openViewer(page, 'dark', PANELS_ONLY);
  await viewer.open('scene.glb');
  const toggle = page.locator('[data-panel="inspector"]');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toHaveAttribute('aria-label', 'Inspector');

  await toggle.click();
  await expect(page.locator('.nm-panel-right')).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(page.locator('.nm-panel-right')).toBeVisible();

  const left = page.locator('.nm-panel-left');
  const before = (await left.boundingBox())!.width;
  await page.locator('.nm-panel-left .nm-sash').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  expect((await left.boundingBox())!.width).toBeCloseTo(before + 40, 0);
  expect(viewer.problems).toEqual([]);
});

test('keeps what is open and selected when the file changes', async ({ page }) => {
  const viewer = await openViewer(page, 'dark', PANELS_ONLY);
  await viewer.open('scene.glb');
  await row(page, 'Group').locator('.nm-twistie').click();
  await row(page, 'Small Box').click();

  await viewer.open('scene.glb', { reload: true });
  await expect(row(page, 'Small Box')).toHaveAttribute('aria-selected', 'true');
  await expect(heading(page)).toHaveText(/Small Box/);
  expect(viewer.problems).toEqual([]);
});

test('lists thousands of nodes without drawing them all', async ({ page }) => {
  const viewer = await openViewer(page, 'dark', PANELS_ONLY);
  await viewer.post(viewer.openMessage('many-nodes.gltf'));
  const nodes = Array.from({ length: 20000 }, (_, i) => ({ name: `Part ${i}` }));
  const json = JSON.stringify({
    asset: { version: '2.0' },
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Assembly', children: nodes.map((_, i) => i + 1) }, ...nodes],
  });
  await viewer.post({ type: 'structure', loadId: 1, reload: false, json, fileSize: json.length });

  await expect(row(page, 'Part 0')).toBeVisible();
  expect(await page.locator('.nm-tree-row').count()).toBeLessThan(100);
  await tree(page).focus();
  await page.keyboard.press('End');
  await expect(heading(page)).toHaveText(/Part 19999\s*Node 20000/);
  await expect(row(page, 'Part 19999')).toBeVisible();
  expect(await page.locator('.nm-tree-row').count()).toBeLessThan(100);
  expect(viewer.problems).toEqual([]);
});

test('counts the scene in a statistics tab beside the inspector', async ({ page }) => {
  const viewer = await openViewer(page, 'dark', PANELS_ONLY);
  await viewer.open('scene.glb');
  const tab = (label: string) => page.locator('.nm-panel-tab', { hasText: label });
  const meshes = page.locator('.nm-table tbody tr td:first-child');

  await expect(tab('Inspector')).toHaveAttribute('aria-selected', 'true');
  await tab('Statistics').click();
  await expect(tab('Statistics')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.nm-inspector-content')).toBeHidden();
  await expect(page.locator('.nm-statistics dl')).toContainText('Triangles984');
  // Most triangles on screen first; ties in the file's order.
  await expect(meshes).toHaveText(['Sphere', 'Box', 'Axes', 'Cloud']);
  await page.locator('.nm-sort', { hasText: 'Instances' }).click();
  await expect(meshes.first()).toHaveText('Box');
  await expect(page.locator('th[aria-sort]')).toHaveAttribute('aria-sort', 'descending');

  // A mesh's name selects it, and the tab stays open.
  await page.locator('.nm-statistics .nm-link', { hasText: 'Box' }).click();
  await expect(row(page, 'Meshes')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.nm-tree-row[aria-selected="true"]')).toHaveText('Box');
  await expect(tab('Statistics')).toHaveAttribute('aria-selected', 'true');

  // Arrow keys move between tabs.
  await tab('Statistics').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(tab('Inspector')).toHaveAttribute('aria-selected', 'true');
  await expect(tab('Inspector')).toBeFocused();
  await expect(heading(page)).toHaveText(/Box\s*Mesh 0/);
  expect(viewer.problems).toEqual([]);
});

test('previews textures and gives their size and memory', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('textured.gltf');
  await row(page, 'Textures').click();
  await row(page, 'checker').click();

  await expect(section(page, 'Texture')).toContainText([
    'Dimensions',
    '64 × 64 px',
    'GPU memory',
    /^≈ [\d.]+ KB$/,
  ]);
  const preview = page.locator('.nm-preview canvas');
  await expect(preview).toBeVisible();
  // The checker's blue squares, drawn from the texture the 3D view loaded.
  expect(
    (await areaOf(page, '.nm-preview canvas', [52, 120, 220], 30))?.count ?? 0,
  ).toBeGreaterThan(100);

  // KTX2 stays compressed on the GPU: there is nothing to read back.
  await viewer.open('ktx2.glb');
  await row(page, 'Textures').click();
  // The texture, below the scene's node and mesh of the same name.
  await page
    .locator('.nm-tree-row', {
      has: page.locator('.nm-tree-label').getByText('ETC1S', { exact: true }),
    })
    .last()
    .click();
  await expect(page.locator('.nm-preview figcaption')).toHaveText(
    'No preview: this texture stays compressed on the GPU.',
  );
  await page.locator('.nm-panel-tab', { hasText: 'Statistics' }).click();
  await expect(page.locator('.nm-statistics dl')).toContainText('Texture memory');
  expect(viewer.problems).toEqual([]);
});

test('says which animations move nothing when they play', async ({ page }) => {
  const viewer = await openViewer(page, 'dark', PANELS_ONLY);
  await viewer.open('animated.glb');
  await row(page, 'Animations').click();

  await row(page, 'Still').click();
  await expect(section(page, 'Animation')).toContainText([
    'Motion',
    "Moves nothing: every keyframe matches the model's rest pose",
  ]);
  await row(page, 'Spin').click();
  await expect(section(page, 'Animation')).toContainText(['Motion', /^Moves$/]);
  expect(viewer.problems).toEqual([]);
});

test('sums up the animations in the statistics tab', async ({ page }) => {
  const viewer = await openViewer(page, 'dark', PANELS_ONLY);
  await viewer.open('animated.glb');
  await page.locator('.nm-panel-tab', { hasText: 'Statistics' }).click();
  const title = page.locator('.nm-statistics .nm-section-title', { hasText: 'Animations' });
  await expect(title).toBeVisible();
  await expect(title.locator('xpath=following-sibling::dl[1]').locator('dt, dd')).toHaveText([
    'Animations',
    '5',
    'Longest',
    '2 s',
    'Channels',
    '5',
    'Keyframes',
    '16',
    'Animated nodes',
    '4',
    'Moving nothing',
    '1',
  ]);
  expect(await lowestTextContrast(page)).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: `${SCREENS}/statistics-animations.png` });
  expect(viewer.problems).toEqual([]);
});
