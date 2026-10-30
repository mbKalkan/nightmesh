import { expect, test, type Page } from '@playwright/test';
import { openViewer } from './harness';
import { pixelsOf } from './pixels';
import type { ThemeName } from './themes';

const SCREENS = 'test-results/screens';

test.use({ reducedMotion: 'reduce' });

type Viewer = Awaited<ReturnType<typeof openViewer>>;

/** The paths of the tiles the webview asked the host for. */
const requested = async (viewer: Viewer) =>
  (await viewer.sent())
    .filter((message) => message.type === 'tile')
    .map((message) => (message as unknown as { path: string }).path)
    .sort();

/** Waits until the tiles asked for have come and been drawn. */
async function settle(page: Page, viewer: Viewer, count: number): Promise<void> {
  await expect.poll(async () => (await requested(viewer)).length).toBe(count);
  // Two frames: one to put the last tile in the scene, one to draw it.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

for (const theme of ['dark', 'light'] as ThemeName[]) {
  test(`draws a tileset on the globe, its quarters in detail, ${theme} theme`, async ({ page }) => {
    const viewer = await openViewer(page, theme);
    await viewer.open('tiles/tileset.json');
    await expect(page.locator('.nm-viewport')).toHaveAttribute('data-state', 'shown');
    await settle(page, viewer, 6);

    // The quarters replace the coarse root; the fourth is a tileset in a folder of its own.
    expect(await requested(viewer)).toEqual([
      '/_/tiles/district.b3dm',
      '/_/tiles/east/tileset.json',
      '/_/tiles/east/tower.b3dm',
      '/_/tiles/north-west.b3dm',
      '/_/tiles/south-east.b3dm',
      '/_/tiles/south-west.b3dm',
    ]);
    await expect(page.locator('.nm-error')).toBeHidden();
    await expect(page.locator('.nm-notice')).toBeHidden();
    await page.screenshot({ path: `${SCREENS}/tiles-district-${theme}.png` });

    // Recentered at the origin and framed: the tiles cover much of the view.
    const pixels = await pixelsOf(page, '.nm-canvas');
    const background = pixels.at(2, 2);
    let drawn = 0;
    for (let y = 0; y < pixels.height; y += 8) {
      for (let x = 0; x < pixels.width; x += 8) {
        const color = pixels.at(x, y);
        if (color.some((channel, i) => Math.abs(channel - background[i]) > 24)) drawn++;
      }
    }
    expect(drawn / ((pixels.width / 8) * (pixels.height / 8))).toBeGreaterThan(0.15);
    expect(viewer.problems).toEqual([]);
  });
}

/**
 * Where the yellow of the tallest tower, in the north-east quarter, is across the drawn
 * district: from 0 at its left edge to 1 at its right.
 */
async function yellowAcross(page: Page): Promise<number> {
  const pixels = await pixelsOf(page, '.nm-canvas');
  const background = pixels.at(2, 2);
  let [left, right, sum, count] = [Infinity, -Infinity, 0, 0];
  for (let y = 0; y < pixels.height; y += 2) {
    for (let x = 0; x < pixels.width; x += 2) {
      const [r, g, b] = pixels.at(x, y);
      if (![r, g, b].some((channel, i) => Math.abs(channel - background[i]) > 24)) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      if (r > b * 1.6 && g > b * 1.6 && g > r * 0.75) {
        sum += x;
        count++;
      }
    }
  }
  expect(count, 'yellow pixels').toBeGreaterThan(50);
  return (sum / count - left) / (right - left);
}

test('puts east to the right seen from the front, and north to the right seen from the right', async ({
  page,
}) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('tiles/tileset.json');
  await settle(page, viewer, 6);
  await page.locator('.nm-viewport').focus();
  await page.keyboard.press('1');
  await settle(page, viewer, 6);
  expect(await yellowAcross(page), 'front').toBeGreaterThan(0.55);
  await page.keyboard.press('3');
  await settle(page, viewer, 6);
  expect(await yellowAcross(page), 'right').toBeGreaterThan(0.55);
});

const selectedRow = (page: Page) => page.locator('.nm-tree-row[aria-selected="true"]');

test('lists the tiles at once, and says what each is and how the view has it', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('tiles/tileset.json');
  await expect(page.locator('.nm-tree-row .nm-tree-label')).toHaveText([
    'tiles/tileset.json',
    'district.b3dm',
    'south-west.b3dm',
    'north-west.b3dm',
    'south-east.b3dm',
    'east/tileset.json',
  ]);
  await settle(page, viewer, 6);
  const inspector = page.locator('.nm-inspector-content');
  await expect(inspector).toContainText('Tiles in the file5');
  // The renderer's counts fill in as tiles load: the quarters are drawn, the coarse root not.
  await expect(inspector).toContainText('Tiles drawn4');

  await page.locator('.nm-tree-row', { hasText: 'north-west.b3dm' }).click();
  await expect(page.locator('.nm-inspector-kind')).toHaveText('Tile 0/1');
  await expect(inspector).toContainText('Batched 3D Model (b3dm)');
  await expect(inspector).toContainText('StateLoaded');
  // The tile's bounding volume is what the corner of the view measures.
  await expect(page.locator('.nm-measure')).toHaveAttribute(
    'aria-label',
    'Size of the selection: width (X), height (Y) and depth (Z): 50 m × 50 m × 30 m',
  );
  await page.screenshot({ path: `${SCREENS}/tiles-selected-dark.png` });
  expect(viewer.problems).toEqual([]);
});

for (const theme of ['dark', 'light'] as ThemeName[]) {
  test(`shows the tileset's, a tile's and a content's metadata, ${theme} theme`, async ({
    page,
  }) => {
    const viewer = await openViewer(page, theme);
    await viewer.open('tiles/metadata.json');
    await settle(page, viewer, 4);
    const inspector = page.locator('.nm-inspector-content');
    // The schema is a file of its own, which the host reads and sends along.
    await expect(inspector).toContainText('nameOld town');
    await expect(inspector).toContainText('Schema filemetadata-schema.json');
    await expect(inspector).toContainText('Classesdistrict, quarter, building, zone');
    await page.locator('.nm-inspector-content').screenshot({
      path: `${SCREENS}/tiles-metadata-${theme}.png`,
    });

    await page.locator('.nm-tree-row', { hasText: 'south-east.b3dm' }).click();
    await expect(page.locator('.nm-inspector-kind')).toHaveText('Tile 0/2');
    await expect(inspector).toContainText('landUsePark');
    await expect(inspector).toContainText('trees0no data');
    await expect(inspector).toContainText('architectStudio 3');
    await expect(inspector).toContainText('Group 1');
    await expect(inspector).toContainText('labelEast');
    await page.locator('.nm-inspector-content').screenshot({
      path: `${SCREENS}/tiles-metadata-tile-${theme}.png`,
    });
    expect(viewer.problems).toEqual([]);
  });
}

test('selects the tile clicked in the view, in an external tileset too', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('tiles/tileset.json');
  await settle(page, viewer, 6);
  await page.locator('.nm-viewport').focus();
  await page.keyboard.press('1');
  await settle(page, viewer, 6);
  // The yellow tower is in the external tileset, whose tiles the tree lists once read.
  const pixels = await pixelsOf(page, '.nm-canvas');
  const box = (await page.locator('.nm-canvas').boundingBox())!;
  let [sumX, sumY, count] = [0, 0, 0];
  for (let y = 0; y < pixels.height; y += 2) {
    for (let x = 0; x < pixels.width; x += 2) {
      const [r, g, b] = pixels.at(x, y);
      if (r > b * 1.6 && g > b * 1.6 && g > r * 0.75 && r > 80) {
        sumX += x;
        sumY += y;
        count++;
      }
    }
  }
  expect(count).toBeGreaterThan(50);
  await page.mouse.click(
    box.x + (sumX / count) * (box.width / pixels.width),
    box.y + (sumY / count) * (box.height / pixels.height),
  );
  await expect(selectedRow(page)).toContainText('tower.b3dm');
  await expect(page.locator('.nm-inspector-kind')).toHaveText('Tile 0/3/0');
  // The tower is a feature of its tile, which the inspector shows from the tile's batch table.
  const feature = page.locator('.nm-section', {
    has: page.locator('.nm-section-title', { hasText: /^Feature$/ }),
  });
  await expect(feature.locator('dt')).toContainText(['Batch ID', 'name', 'floors']);
  await expect(feature.locator('dd')).toContainText(['1of 2', 'North-east tower', '16']);
  await page.screenshot({ path: `${SCREENS}/feature-tileset-dark.png` });
  // Empty space selects the tileset.
  await page.mouse.click(box.x + 8, box.y + 8);
  await expect(selectedRow(page)).toContainText('tiles/tileset.json');
});

test('lists the tiles of an external tileset once it is read', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('tiles/tileset.json');
  await settle(page, viewer, 6);
  await expect(page.locator('.nm-inspector-content')).toContainText('Tiles found while loading1');
  await page.locator('.nm-tree-row', { hasText: 'east/tileset.json' }).click();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.nm-tree-row', { hasText: 'tower.b3dm' })).toBeVisible();
  expect(viewer.problems).toEqual([]);
});

test('lists the tiles of implicit tiling as its subtrees are read', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('tiles/implicit/tileset.json');
  await expect(page.locator('.nm-viewport')).toHaveAttribute('data-state', 'shown');
  // The root subtree, its tile, the four quarters' subtrees and their tiles.
  await settle(page, viewer, 10);
  expect(await requested(viewer)).toContain('/_/tiles/implicit/subtrees/1/1/0.subtree');
  const tree = page.locator('.nm-tree');
  await expect(tree).toContainText('content/0/0/0.glb');
  await page.locator('.nm-tree-row', { hasText: 'content/0/0/0.glb' }).click();
  await expect(page.locator('.nm-inspector-kind')).toHaveText('Tile 0/0');
  const implicit = page.locator('.nm-section', {
    has: page.locator('.nm-section-title', { hasText: /^Implicit tiling$/ }),
  });
  await expect(implicit.locator('dd')).toContainText(['0', '0, 0']);
  await page.keyboard.press('ArrowRight');
  await expect(tree).toContainText('subtrees/1/1/0.subtree');
  await page.screenshot({ path: `${SCREENS}/tiles-implicit-dark.png` });
  expect(viewer.problems).toEqual([]);
});

test('says which tiles could not be had, and draws the rest', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('tiles/problems.json');
  await expect(page.locator('.nm-viewport')).toHaveAttribute('data-state', 'shown');
  await settle(page, viewer, 4);
  await expect(page.locator('.nm-notice')).toBeVisible();
  await expect
    .poll(async () => (await page.locator('.nm-notice li').allInnerTexts()).sort())
    .toEqual([
      "damaged.b3dm isn't a tile Nightmesh can draw, or it is damaged.",
      "missing.b3dm wasn't found next to the model.",
      "outside.b3dm wasn't loaded: it is outside the model's folder and workspace.",
    ]);
  await page.screenshot({ path: `${SCREENS}/tiles-problems-dark.png` });
});

for (const theme of ['dark', 'light'] as ThemeName[]) {
  test(`opens a b3dm tile as its GLB, with what the tile says around it, ${theme} theme`, async ({
    page,
  }) => {
    const viewer = await openViewer(page, theme);
    await viewer.open('tiles/batched.b3dm');
    await viewer.post(await viewer.validation('tiles/batched.b3dm'));

    await expect(page.locator('.nm-viewport')).toHaveAttribute('data-state', 'shown');
    await expect(page.locator('.nm-error')).toBeHidden();
    // A GLB's panels and its JSON, all of them.
    await expect(page.locator('.nm-panel-right [role="tab"]')).toHaveText([
      'Inspector',
      'Statistics',
      /^Validation/,
      'Size',
    ]);
    await expect(page.locator('[data-action="json"]')).toBeVisible();
    await expect(page.locator('.nm-tree-label')).toContainText(['Library', 'Market', 'Tower']);

    const tile = page
      .locator('.nm-section', {
        has: page.locator('.nm-section-title', { hasText: 'Batched 3D Model (b3dm)' }),
      })
      .locator('dt, dd');
    await expect(tile).toContainText([
      'Version',
      '1',
      'Header',
      '28 B',
      'Feature table',
      'Batch table',
      'Features',
      '3',
      'Center (RTC_CENTER)',
      '[4216541.976, 2335189.8, 4163110.429]',
      'Feature properties',
      'name',
      'year',
      'height',
    ]);
    await expect(page.locator('.nm-section dd', { hasText: 'b3dm' }).first()).toBeVisible();
    // Its model is along the Earth's axes at RTC_CENTER; placed there, the buildings stand.
    await expect(page.locator('.nm-measure')).toHaveAttribute(
      'aria-label',
      'Size of the model: width (X), height (Y) and depth (Z): 29 m × 30 m × 25 m',
    );
    await page.screenshot({ path: `${SCREENS}/b3dm-${theme}.png` });

    await page.locator('.nm-panel-tab', { hasText: 'Size' }).click();
    await expect(page.locator('.nm-size')).toContainText('Tile header and tables');
    await page.screenshot({ path: `${SCREENS}/b3dm-size-${theme}.png` });
    expect(viewer.problems).toEqual([]);
  });
}

for (const [fixture, theme] of [
  ['points.pnts', 'dark'],
  ['quantized.pnts', 'light'],
] as [string, ThemeName][]) {
  test(`draws the points of ${fixture}, with what the tile says, ${theme} theme`, async ({
    page,
  }) => {
    const viewer = await openViewer(page, theme);
    await viewer.open(`tiles/${fixture}`);

    await expect(page.locator('.nm-viewport')).toHaveAttribute('data-state', 'shown');
    await expect(page.locator('.nm-error')).toBeHidden();
    await expect(page.locator('.nm-notice')).toBeHidden();
    // Like PLY: no glTF of its own to validate or show.
    await expect(page.locator('.nm-panel-right [role="tab"]')).toHaveText([
      'Inspector',
      'Statistics',
    ]);
    await expect(page.locator('[data-action="json"]')).toBeHidden();
    const file = page
      .locator('.nm-section', { has: page.locator('.nm-section-title', { hasText: 'File' }) })
      .first()
      .locator('dt, dd');
    await expect(file).toContainText(['Format', 'Point Cloud (pnts)', 'Points', '1,153']);
    // A tile's frame has Z up, in metres: the dome stands 10 m tall.
    await expect(page.locator('.nm-measure')).toHaveAttribute(
      'aria-label',
      'Size of the model: width (X), height (Y) and depth (Z): 20 m × 10 m × 20 m',
    );
    await page.screenshot({ path: `${SCREENS}/pnts-${fixture.replace('.', '-')}-${theme}.png` });
    expect(viewer.problems).toEqual([]);
  });
}

for (const [fixture, theme] of [
  ['instanced.i3dm', 'dark'],
  ['oriented.i3dm', 'light'],
] as [string, ThemeName][]) {
  test(`draws ${fixture} once for each instance, upright, ${theme} theme`, async ({ page }) => {
    const viewer = await openViewer(page, theme);
    await viewer.open(`tiles/${fixture}`);
    await viewer.post(await viewer.validation(`tiles/${fixture}`));

    await expect(page.locator('.nm-viewport')).toHaveAttribute('data-state', 'shown');
    await expect(page.locator('.nm-error')).toBeHidden();
    await expect(page.locator('[data-action="json"]')).toBeVisible();
    const tile = page
      .locator('.nm-section', {
        has: page.locator('.nm-section-title', { hasText: 'Instanced 3D Model (i3dm)' }),
      })
      .locator('dt, dd');
    await expect(tile).toContainText(['Version', '1', 'Header', '32 B', 'Instances']);
    // Every instance counts in the size, and the posts stand: 3 m tall, twice that when scaled.
    const size = fixture === 'instanced.i3dm' ? '22 m × 6 m × 21.5 m' : '22 m × 3 m × 22 m';
    await expect(page.locator('.nm-measure')).toHaveAttribute(
      'aria-label',
      `Size of the model: width (X), height (Y) and depth (Z): ${size}`,
    );
    await page.screenshot({ path: `${SCREENS}/i3dm-${fixture.replace('.', '-')}-${theme}.png` });
    expect(viewer.problems).toEqual([]);
  });
}

for (const [fixture, theme, expected] of [
  ['batched.b3dm', 'dark', ['name', 'year', 'height']],
  ['instanced.i3dm', 'light', ['name']],
  ['points.pnts', 'dark', ['intensity']],
  ['composite.cmpt', 'light', ['name']],
] as [string, ThemeName, string[]][]) {
  test(`shows the feature clicked in ${fixture}, from the tile's tables, ${theme} theme`, async ({
    page,
  }) => {
    const viewer = await openViewer(page, theme);
    await viewer.open(`tiles/${fixture}`);
    await expect(page.locator('.nm-viewport')).toHaveAttribute('data-state', 'shown');
    const feature = page.locator('.nm-section', {
      has: page.locator('.nm-section-title', { hasText: /^Feature$/ }),
    });
    // The model's pixel nearest the middle of the view: one whose neighbours also differ from
    // the background, so not a line of the grid.
    const pixels = await pixelsOf(page, '.nm-canvas');
    const canvas = (await page.locator('.nm-canvas').boundingBox())!;
    const background = pixels.at(2, 2);
    const model = (x: number, y: number) =>
      pixels.at(x, y).reduce((sum, value, i) => sum + Math.abs(value - background[i]), 0) > 60;
    let best = { x: pixels.width / 2, y: pixels.height / 2, distance: Infinity };
    for (let y = 2; y < pixels.height - 2; y += 2) {
      for (let x = 2; x < pixels.width - 2; x += 2) {
        if (![-1, 0, 1].every((dy) => [-1, 0, 1].every((dx) => model(x + dx, y + dy)))) continue;
        const distance = (x - pixels.width / 2) ** 2 + (y - pixels.height / 2) ** 2;
        if (distance < best.distance) best = { x, y, distance };
      }
    }
    await page.mouse.click(
      canvas.x + best.x * (canvas.width / pixels.width),
      canvas.y + best.y * (canvas.height / pixels.height),
    );
    // The tables come from the host after the click.
    await expect(feature).toBeVisible({ timeout: 15_000 });
    const labels = feature.locator('dt');
    await expect(labels.first()).toHaveText('Batch ID');
    await expect(labels).toContainText(expected);
    await expect(feature.locator('dd').first()).toContainText(/^\d+of [\d,]+$/);
    await page.screenshot({ path: `${SCREENS}/feature-${fixture.replace('.', '-')}-${theme}.png` });
    expect(viewer.problems).toEqual([]);
  });
}

for (const width of [1280, 760]) {
  test(`keeps the notice clear of the size in the corner, ${width} px wide`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 });
    const viewer = await openViewer(page, 'dark');
    await viewer.open('tiles/composite.cmpt');
    await expect(page.locator('.nm-notice')).toBeVisible();
    await expect(page.locator('.nm-measure')).toBeVisible();
    const notice = (await page.locator('.nm-notice').boundingBox())!;
    const size = (await page.locator('.nm-measure').boundingBox())!;
    const apart =
      notice.x + notice.width <= size.x ||
      notice.y >= size.y + size.height ||
      size.x + size.width <= notice.x ||
      size.y >= notice.y + notice.height;
    expect(apart).toBe(true);
    await page.screenshot({ path: `${SCREENS}/notice-${width}.png` });
  });
}

for (const theme of ['dark', 'light'] as ThemeName[]) {
  test(`draws the glTF an i3dm tile names, with its own files, ${theme} theme`, async ({
    page,
  }) => {
    const viewer = await openViewer(page, theme);
    await viewer.open('tiles/external.i3dm');
    await viewer.post(await viewer.validation('tiles/external.i3dm'));

    await expect(page.locator('.nm-viewport')).toHaveAttribute('data-state', 'shown');
    await expect(page.locator('.nm-error')).toBeHidden();
    await expect(page.locator('.nm-notice')).toBeHidden();
    const tile = page
      .locator('.nm-section', {
        has: page.locator('.nm-section-title', { hasText: 'Instanced 3D Model (i3dm)' }),
      })
      .locator('dt, dd');
    await expect(tile).toContainText(['Instances', '3', 'glTF file', '../textured.gltf']);
    // Three 1 m boxes, 2 m apart.
    await expect(page.locator('.nm-measure')).toHaveAttribute(
      'aria-label',
      'Size of the model: width (X), height (Y) and depth (Z): 5 m × 1 m × 1 m',
    );
    await page.screenshot({ path: `${SCREENS}/i3dm-linked-${theme}.png` });
    // The validator reads the named glTF and the files next to it.
    await page.locator('.nm-panel-tab', { hasText: 'Validation' }).click();
    await expect(page.locator('.nm-validation-clean')).toHaveText('No issues found.');
    expect(viewer.problems).toEqual([]);
  });

  test(`draws the b3dm and i3dm tiles of a composite together, ${theme} theme`, async ({
    page,
  }) => {
    const viewer = await openViewer(page, theme);
    await viewer.open('tiles/composite.cmpt');

    await expect(page.locator('.nm-viewport')).toHaveAttribute('data-state', 'shown');
    await expect(page.locator('.nm-error')).toBeHidden();
    // The pnts tile inside isn't drawn, and the notice says so.
    await expect(page.locator('.nm-notice')).toContainText('pnts 3/1');
    // A model made of several: no glTF of the file's own to validate or show.
    await expect(page.locator('.nm-panel-right [role="tab"]')).toHaveText([
      'Inspector',
      'Statistics',
    ]);
    await expect(page.locator('[data-action="json"]')).toBeHidden();
    await expect(page.locator('.nm-tree-label')).toContainText(['b3dm 1', 'i3dm 2']);
    const composite = page
      .locator('.nm-section', {
        has: page.locator('.nm-section-title', { hasText: 'Composite (cmpt)' }),
      })
      .locator('dt, dd');
    await expect(composite).toContainText(['Version', '1', 'Header', '16 B', 'Tiles']);
    // The buildings, and the posts 40 m east of them: one ground, both standing.
    await expect(page.locator('.nm-measure')).toHaveAttribute(
      'aria-label',
      'Size of the model: width (X), height (Y) and depth (Z): 67.5 m × 30 m × 25 m',
    );
    await page.screenshot({ path: `${SCREENS}/cmpt-${theme}.png` });
    expect(viewer.problems).toEqual([]);
  });
}
