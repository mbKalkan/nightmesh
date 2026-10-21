import { expect, test, type Page } from '@playwright/test';
import { lowestTextContrast } from './contrast';
import { openViewer } from './harness';
import { centerOf, pixelAt } from './pixels';
import type { ThemeName } from './themes';

const SCREENS = 'test-results/screens';

/** The color in a corner of the viewport, where models framed by the camera don't reach. */
const corner = async (page: Page) => {
  const box = (await page.locator('.nm-viewport').boundingBox())!;
  return pixelAt(page, Math.round(box.x + 6), Math.round(box.y + box.height - 6));
};

const close = (a: number[], b: number[], tolerance = 2) =>
  a.every((value, i) => Math.abs(value - b[i]) <= tolerance);

/** Whether anything but background shows, looking at a 5 × 5 grid across the viewport. */
const drawn = async (page: Page) => {
  const box = (await page.locator('.nm-viewport').boundingBox())!;
  const background = await corner(page);
  for (let row = 1; row <= 5; row++) {
    for (let column = 1; column <= 5; column++) {
      const x = Math.round(box.x + (box.width * column) / 6);
      const y = Math.round(box.y + (box.height * row) / 6);
      if (!close(await pixelAt(page, x, y), background, 8)) return true;
    }
  }
  return false;
};

/** Whether the canvas holds a live WebGL 2 context and fills the viewport at the device scale. */
const canvasState = (page: Page) =>
  page.locator('.nm-canvas').evaluate((el) => {
    const canvas = el as HTMLCanvasElement;
    const gl = canvas.getContext('webgl2');
    const viewport = canvas.parentElement as HTMLElement;
    return {
      webgl2: gl instanceof WebGL2RenderingContext && !gl.isContextLost(),
      fills:
        canvas.width === Math.round(viewport.clientWidth * devicePixelRatio) &&
        canvas.height === Math.round(viewport.clientHeight * devicePixelRatio),
    };
  });

for (const theme of ['dark', 'light', 'hcDark', 'hcLight'] as ThemeName[]) {
  test.describe(`${theme} theme`, () => {
    test('draws a model', async ({ page }) => {
      const viewer = await openViewer(page, theme);
      await viewer.open('scene.glb');

      await expect(page.locator('.nm-viewport')).toHaveAttribute('data-state', 'shown');
      await expect(page.locator('.nm-file-name')).toHaveText('scene.glb');
      await expect(page.locator('.nm-viewport')).toHaveAttribute('aria-label', 'scene.glb');
      expect(await canvasState(page)).toEqual({ webgl2: true, fills: true });
      await expect(page.locator('.nm-error')).toBeHidden();
      await expect(page.locator('.nm-notice')).toBeHidden();
      expect(await drawn(page)).toBe(true);
      await page.screenshot({ path: `${SCREENS}/scene-${theme}.png` });
      expect(viewer.problems).toEqual([]);
    });

    test('explains when WebGL 2 is not available', async ({ page }) => {
      const viewer = await openViewer(page, theme, { withoutWebGL: true });
      await viewer.open('scene.glb');

      await expect(page.locator('.nm-error-title')).toHaveText("This model can't be displayed");
      await expect(page.locator('.nm-error-message')).toContainText("WebGL 2 isn't available");
      await expect(page.locator('.nm-canvas')).toHaveCount(0);
      expect(await lowestTextContrast(page)).toBeGreaterThanOrEqual(4.5);
      await page.screenshot({ path: `${SCREENS}/no-webgl-${theme}.png` });
      expect(viewer.problems).toEqual([]);
    });

    test('lists what could not be loaded over the part that could', async ({ page }) => {
      const viewer = await openViewer(page, theme);
      await viewer.open('truncated.glb');

      await expect(page.locator('.nm-viewport')).toHaveAttribute('data-state', 'shown');
      await expect(page.locator('.nm-notice-title')).toHaveText(
        "Part of this model couldn't be loaded",
      );
      await expect(page.locator('.nm-notice-list li')).toContainText([
        'The file ends early, as if it was cut off while being copied or saved.',
        /^Primitives left out: \d+$/,
      ]);
      expect(await lowestTextContrast(page)).toBeGreaterThanOrEqual(4.5);
      await page.screenshot({ path: `${SCREENS}/truncated-${theme}.png` });
      expect(viewer.problems).toEqual([]);
    });
  });
}

test.describe('models that open', () => {
  for (const fixture of [
    'triangle.glb',
    'triangle.gltf',
    'materials.glb',
    'animated.glb',
    'variants.glb',
    'textured.gltf',
    'embedded.gltf',
    'dense.glb',
    'draco.glb',
    'meshopt.glb',
    'quantized.glb',
    'ktx2.glb',
  ]) {
    test(fixture, async ({ page }) => {
      const viewer = await openViewer(page, 'dark');
      await viewer.open(fixture);

      await expect(page.locator('.nm-viewport')).toHaveAttribute('data-state', 'shown');
      await expect(page.locator('.nm-notice')).toBeHidden();
      expect(await drawn(page)).toBe(true);
      await page.screenshot({ path: `${SCREENS}/open-${fixture.replace('.', '-')}.png` });
      expect(viewer.problems).toEqual([]);
    });
  }
});

test('draws KTX2 textures, both ETC1S and UASTC', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('ktx2.glb');

  await expect(page.locator('.nm-viewport')).toHaveAttribute('data-state', 'shown');
  const box = (await page.locator('.nm-viewport').boundingBox())!;
  const colors: number[][] = [];
  for (let row = 1; row <= 6; row++) {
    for (let column = 1; column <= 9; column++) {
      const x = Math.round(box.x + (box.width * column) / 10);
      const y = Math.round(box.y + (box.height * row) / 7);
      colors.push(await pixelAt(page, x, y));
    }
  }
  // Blue squares on the ETC1S box, orange on the UASTC one: untextured boxes would be white.
  expect(colors.some(([r, , b]) => b > r + 80)).toBe(true);
  expect(colors.some(([r, , b]) => r > b + 80)).toBe(true);
  expect(viewer.problems).toEqual([]);
});

test.describe('files that cannot be shown', () => {
  const cases: [string, string | RegExp, string[]][] = [
    ['empty.glb', 'The file is empty.', []],
    ['not-a-model.glb', "The file isn't a glTF model, or it is damaged.", []],
    ['lfs-pointer.glb', /^This file is a Git LFS pointer/, []],
    [
      'unsupported-extension.glb',
      "This model needs EXT_nightmesh_unknown, which Nightmesh can't draw yet.",
      [],
    ],
    [
      'missing-resource.gltf',
      "None of this model's geometry could be loaded.",
      ["missing.bin wasn't found next to the model."],
    ],
    [
      'network-resource.gltf',
      "None of this model's geometry could be loaded.",
      ["triangle.bin wasn't loaded: Nightmesh doesn't use the network."],
    ],
    [
      'outside-folder.gltf',
      "None of this model's geometry could be loaded.",
      ["triangle.bin wasn't loaded: it is outside the model's folder and workspace."],
    ],
    [
      'absolute-path.gltf',
      "None of this model's geometry could be loaded.",
      ["triangle.bin wasn't loaded: only paths relative to the model are followed."],
    ],
  ];
  for (const [fixture, message, details] of cases) {
    test(fixture, async ({ page }) => {
      const viewer = await openViewer(page, 'dark');
      await viewer.open(fixture);

      await expect(page.locator('.nm-viewport')).toHaveAttribute('data-state', 'failed');
      await expect(page.locator('.nm-error-title')).toHaveText("This model can't be displayed");
      await expect(page.locator('.nm-error-message')).toHaveText(message);
      await expect(page.locator('.nm-error-details li')).toHaveText(details);
      expect(viewer.problems).toEqual([]);
    });
  }

  test('says when the file was damaged', async ({ page }) => {
    const viewer = await openViewer(page, 'dark');
    await viewer.open('not-a-model.glb');
    await page.screenshot({ path: `${SCREENS}/damaged-dark.png` });
    await viewer.setTheme('light');
    await page.screenshot({ path: `${SCREENS}/damaged-light.png` });
  });
});

test('hides nodes KHR_node_visibility hides, and frames and counts what is shown', async ({
  page,
}) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('hidden.gltf');

  await expect(page.locator('.nm-viewport')).toHaveAttribute('data-state', 'shown');
  await expect(page.locator('.nm-error')).toBeHidden();
  // The box 10 m away, in the hidden node, is neither framed nor measured.
  await expect(page.locator('.nm-measure')).toHaveAttribute(
    'aria-label',
    'Size of the model: width (X), height (Y) and depth (Z): 1 m × 1 m × 1 m',
  );
  await page.locator('.nm-panel-tab', { hasText: 'Statistics' }).click();
  const totals = page.locator('.nm-statistics .nm-props').first().locator('dt, dd');
  await expect(totals).toContainText(['Nodes', '1', 'Instances', '1', 'Triangles', '12']);
  await page.screenshot({ path: `${SCREENS}/hidden-dark.png` });
  expect(viewer.problems).toEqual([]);
});

test('clears to the theme background and follows theme changes', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('scene.glb');
  await expect.poll(() => corner(page)).toEqual([31, 31, 31]);

  // Light themes darken the background a little, so white models stand out.
  await viewer.setTheme('light');
  await expect.poll(async () => close(await corner(page), [241, 241, 241])).toBe(true);

  await viewer.setTheme('hcDark');
  await expect.poll(() => corner(page)).toEqual([0, 0, 0]);

  await viewer.setTheme('hcLight');
  await expect.poll(async () => close(await corner(page), [240, 240, 240])).toBe(true);
  expect(viewer.problems).toEqual([]);
});

test('keeps the canvas sized to the viewport when the window resizes', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('scene.glb');

  await page.setViewportSize({ width: 640, height: 420 });
  await expect.poll(() => canvasState(page)).toEqual({ webgl2: true, fills: true });
  expect(viewer.problems).toEqual([]);
});

test('orbits with the mouse and keeps the view when the file changes', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('scene.glb');
  const viewport = page.locator('.nm-viewport');
  const before = await viewport.screenshot();

  const { x, y } = await centerOf(page, '.nm-viewport');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 120, y + 30, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await viewport.screenshot()).equals(before)).toBe(false);
  const orbited = await viewport.screenshot();

  await viewer.open('scene.glb', { reload: true });
  await expect(viewport).toHaveAttribute('data-state', 'shown');
  await expect.poll(async () => (await viewport.screenshot()).equals(orbited)).toBe(true);
  expect(viewer.problems).toEqual([]);
});

test('tells the user when the graphics device stops, and asks for the model again', async ({
  page,
}) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('scene.glb');
  const loseContext = (action: 'loseContext' | 'restoreContext') =>
    page.locator('.nm-canvas').evaluate((el, action) => {
      const gl = (el as HTMLCanvasElement).getContext('webgl2');
      // Keep the extension object: it is the only way to restore the context afterwards.
      const ext = ((window as unknown as { __lose?: WEBGL_lose_context }).__lose ??=
        gl?.getExtension('WEBGL_lose_context') ?? undefined);
      ext?.[action]();
    }, action);

  await loseContext('loseContext');
  await expect(page.locator('.nm-error-message')).toContainText(
    'The graphics device stopped responding',
  );

  await loseContext('restoreContext');
  await expect(page.locator('.nm-error')).toBeHidden();
  await expect.poll(async () => (await viewer.sent()).at(-1)).toEqual({ type: 'reload' });
  await viewer.open('scene.glb', { reload: true });
  await expect.poll(() => drawn(page)).toBe(true);
  expect(viewer.problems).toEqual([]);
});

test('asks the host for nothing but the model', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('textured.gltf');

  await expect(page.locator('.nm-viewport')).toHaveAttribute('data-state', 'shown');
  expect(await viewer.sent()).toEqual([{ type: 'ready' }]);
});
