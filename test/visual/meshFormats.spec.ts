import { expect, test, type Page } from '@playwright/test';
import { openViewer } from './harness';
import { pixelsOf } from './pixels';
import type { ThemeName } from './themes';

const SCREENS = 'test-results/screens';

/** An inspector section's rows as `label value` text. */
const section = (page: Page, title: string) =>
  page
    .locator('.nm-section', { has: page.locator('.nm-section-title', { hasText: title }) })
    .first()
    .locator('dt, dd');

const row = (page: Page, label: string) =>
  page
    .locator('.nm-tree-row', {
      has: page.locator('.nm-tree-label').getByText(label, { exact: true }),
    })
    .first();

const tabs = (page: Page) => page.locator('.nm-panel-right [role="tab"]');

for (const theme of ['dark', 'light', 'hcDark', 'hcLight'] as ThemeName[]) {
  test.describe(`${theme} theme`, () => {
    for (const fixture of ['cube.obj', 'bracket.stl', 'octahedron.ply', 'cloud.ply']) {
      test(`draws ${fixture}`, async ({ page }) => {
        const viewer = await openViewer(page, theme);
        await viewer.open(fixture);

        await expect(page.locator('.nm-viewport')).toHaveAttribute('data-state', 'shown');
        await expect(page.locator('.nm-error')).toBeHidden();
        await expect(page.locator('.nm-notice')).toBeHidden();
        // The glTF Validator, the size of glTF's parts and glTF JSON don't apply.
        await expect(tabs(page)).toHaveText(['Inspector', 'Statistics']);
        await expect(page.locator('[data-action="json"]')).toBeHidden();
        await page.screenshot({
          path: `${SCREENS}/mesh-${fixture.replace('.', '-')}-${theme}.png`,
        });
        expect(viewer.problems).toEqual([]);
      });
    }
  });
}

for (const fixture of [
  'pyramid.obj',
  'points.obj',
  'solids.stl',
  'colored.stl',
  'bracket-be.ply',
  'textured.ply',
]) {
  test(`draws ${fixture}, dark theme`, async ({ page }) => {
    const viewer = await openViewer(page, 'dark');
    await viewer.open(fixture);
    await expect(page.locator('.nm-viewport')).toHaveAttribute('data-state', 'shown');
    await expect(page.locator('.nm-notice')).toBeHidden();
    await page.screenshot({ path: `${SCREENS}/mesh-${fixture.replace('.', '-')}-dark.png` });
    expect(viewer.problems).toEqual([]);
  });
}

test('draws parts without a material light grey, not dark as glTF metal', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('bracket.stl');
  const pixels = await pixelsOf(page, '.nm-viewport');
  let light = 0;
  for (let y = 0; y < pixels.height; y++) {
    for (let x = 0; x < pixels.width; x++) {
      const [r, g, b] = pixels.at(x, y);
      if (r > 120 && Math.abs(r - g) < 12 && Math.abs(g - b) < 12) light++;
    }
  }
  expect(light / (pixels.width * pixels.height)).toBeGreaterThan(0.02);
  expect(viewer.problems).toEqual([]);
});

test('stands an STL in millimetres with Z up, and takes other units from the View menu', async ({
  page,
}) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('bracket.stl');
  const size = (values: string) =>
    `Size of the model: width (X), height (Y) and depth (Z): ${values}`;
  const badge = page.locator('.nm-measure');
  // 40 × 20 × 25 mm with Z up: in glTF's terms, Y up.
  await expect(badge).toHaveAttribute('aria-label', size('40 mm × 25 mm × 20 mm'));
  const menu = page.locator('.nm-menu');
  const item = (label: string) =>
    menu.locator('.nm-menu-item', { has: page.getByText(label, { exact: true }) });
  await page.locator('[data-action="view"]').click();
  for (const label of ['Y Up', 'Z Up', 'Millimetres', 'Centimetres', 'Metres', 'Inches', 'Feet']) {
    await expect(item(label)).toHaveAttribute('role', 'menuitemradio');
  }
  await expect(item('Z Up')).toHaveAttribute('aria-checked', 'true');
  await expect(item('Millimetres')).toHaveAttribute('aria-checked', 'true');
  await expect(item('Grid (10 mm squares)')).toBeVisible();
  await page.screenshot({ path: `${SCREENS}/mesh-units-menu-dark.png` });

  await item('Inches').click();
  await expect(badge).toHaveAttribute('aria-label', size('40 in × 25 in × 20 in'));
  await page.locator('[data-action="view"]').click();
  // Squares of inches, as of millimetres before.
  await expect(item('Grid (10 in squares)')).toBeVisible();
  await item('Y Up').click();
  await expect(badge).toHaveAttribute('aria-label', size('40 in × 20 in × 25 in'));
  await expect(section(page, 'Contents')).toContainText(['Dimensions', '[40, 20, 25] in']);
  // The next STL file opens the same way.
  const sent = (await viewer.sent()) as { type: string; preferences?: unknown }[];
  expect(sent.filter((message) => message.type === 'preferences').at(-1)).toMatchObject({
    preferences: { units: { stl: { unit: 'in', up: 'y' } } },
  });
  expect(viewer.problems).toEqual([]);
});

test('opens an OBJ file in the unit its comments name, as Maya writes it', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('maya.obj');
  await expect(page.locator('.nm-measure')).toHaveAttribute(
    'aria-label',
    'Size of the model: width (X), height (Y) and depth (Z): 20 cm × 30 cm × 0 cm',
  );
  await page.locator('[data-action="view"]').click();
  const item = (label: string) =>
    page.locator('.nm-menu .nm-menu-item', { has: page.getByText(label, { exact: true }) });
  await expect(item('Centimetres')).toHaveAttribute('aria-checked', 'true');
  await expect(item('Y Up')).toHaveAttribute('aria-checked', 'true');
  expect(viewer.problems).toEqual([]);
});

test('shows what the file says about itself in the inspector', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('cloud.ply');
  await expect(section(page, 'File')).toContainText([
    'Format',
    'PLY',
    'Encoding',
    'Binary, little-endian',
    'Version',
    '1.0',
  ]);
  await expect(section(page, 'Elements')).toContainText([
    'vertex',
    '601',
    'double x · double y · double z · uchar red · uchar green · uchar blue',
  ]);
  await expect(section(page, 'Comments')).toContainText([
    'Georeferenced points, as a terrestrial scanner writes them',
  ]);
  await page.screenshot({ path: `${SCREENS}/mesh-inspector-ply-dark.png` });

  await viewer.open('cube.obj');
  await expect(section(page, 'Statements')).toContainText(['v', '12', 'vt', '4', 'vn', '6']);
  await row(page, 'Materials').click();
  await page.keyboard.press('ArrowRight');
  await row(page, 'Checker').click();
  await expect(section(page, 'MTL · cube.mtl')).toHaveText([
    'Kd',
    '0.8 0.8 0.8',
    'Ns',
    '250',
    'map_Kd',
    'checker.png',
  ]);
  await page.screenshot({ path: `${SCREENS}/mesh-inspector-mtl-dark.png` });
  expect(viewer.problems).toEqual([]);
});

for (const theme of ['dark', 'light'] as ThemeName[]) {
  test(`checks the triangles as 3D printing does, in the ${theme} theme`, async ({ page }) => {
    const viewer = await openViewer(page, theme);
    await viewer.open('solids.stl');
    // Two closed boxes, in millimetres: their volume in cubic centimetres too.
    await expect(section(page, 'Mesh check')).toHaveText([
      'Surface area',
      '2,736 mm²',
      'Volume',
      '4,176 mm³ (4.176 cm³)',
      'Watertight',
      'Yes',
      'Shells',
      '2',
    ]);
    await page.screenshot({ path: `${SCREENS}/mesh-check-${theme}.png` });
    // The report has it too.
    await viewer.post({ type: 'export', what: 'report' });
    await expect
      .poll(async () => (await viewer.sent()).some((message) => message.type === 'save'))
      .toBe(true);
    const saved = (await viewer.sent()).find((message) => message.type === 'save') as unknown as {
      markdown: string;
      json: string;
    };
    expect(saved.markdown).toContain('## Mesh check');
    expect(JSON.parse(saved.json).check).toMatchObject({ volume: 4176, shells: 2, unit: 'mm' });
    // Two boxes stuck together along an edge: four faces on it.
    await viewer.open('bracket.stl');
    await expect(section(page, 'Mesh check')).toHaveText([
      'Surface area',
      '3,480 mm²',
      'Watertight',
      'No',
      'Non-manifold edges',
      '1',
      'Shells',
      '1',
    ]);
    expect(viewer.problems).toEqual([]);
  });
}

test('lists what an OBJ file names but could not be had', async ({ page }) => {
  const viewer = await openViewer(page, 'light');
  await viewer.open('problems.obj');
  await expect(page.locator('.nm-viewport')).toHaveAttribute('data-state', 'shown');
  await expect(page.locator('.nm-notice-list li')).toHaveText([
    "bumps.tga wasn't found next to the model.",
    "stone.tga isn't shown: textures are shown from PNG, JPEG, WebP, GIF and BMP files.",
    "Materials the material libraries don't define: Undefined",
    'Faces left out because they are incomplete or name vertices the file lacks: 1',
    "Free-form curves and surfaces aren't drawn: 1",
  ]);
  await page.screenshot({ path: `${SCREENS}/mesh-problems-light.png` });
  expect(viewer.problems).toEqual([]);
});

test('refers to what is in an OBJ file by name, with nothing of the glTF made of it', async ({
  page,
}) => {
  const viewer = await openViewer(page, 'dark', { withoutWebGL: true });
  await viewer.open('cube.obj');
  const reference = async () => {
    const sent = (await viewer.sent()) as { type: string; location?: string; details?: string }[];
    return sent.filter((message) => message.type === 'reference').at(-1);
  };
  await row(page, 'Box').click();
  await viewer.post({ type: 'copyReference', atPointer: false, details: true });
  await expect.poll(async () => (await reference())?.location).toBe('node "Box"');
  expect((await reference())?.details).toContain('- Materials: Checker, Painted');
  await page.locator('.nm-panel-right').getByRole('button', { name: 'Checker' }).first().click();
  await viewer.post({ type: 'copyReference', atPointer: false, details: true });
  await expect.poll(async () => (await reference())?.location).toBe('material "Checker"');
  expect((await reference())?.details).toContain('MTL · cube.mtl\n- Kd: 0.8 0.8 0.8');
  expect(viewer.problems).toEqual([]);
});

test("says when an .obj file is a compiler's object file", async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('object-file.obj');
  await expect(page.locator('.nm-error-message')).toHaveText(
    "This .obj file isn't a 3D model: it is binary, as the object files compilers write are.",
  );
  expect(viewer.problems).toEqual([]);
});

test('says how much of a file it has read', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.post(viewer.openMessage('points.obj'));
  await viewer.post({
    type: 'progress',
    loadId: 1,
    done: 4 * 1024 * 1024,
    total: 16 * 1024 * 1024,
  });
  await expect(page.locator('.nm-progress')).toBeVisible();
  await expect(page.locator('.nm-loading-detail')).toHaveText('4 MB of 16 MB');
  expect(viewer.problems).toEqual([]);
});
