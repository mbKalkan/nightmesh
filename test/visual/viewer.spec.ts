import { expect, test, type Page } from '@playwright/test';
import { lowestTextContrast } from './contrast';
import { openViewer } from './harness';
import { centerOf, pixelAt } from './pixels';
import type { ThemeName } from './themes';

const SCREENS = 'test-results/screens';

const viewportCenter = async (page: Page) => {
  const { x, y } = await centerOf(page, '.nm-viewport');
  return pixelAt(page, x, y);
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
    test('opens a model in a WebGL 2 viewport', async ({ page }) => {
      const viewer = await openViewer(page, theme);
      await viewer.load('triangle.glb');

      await expect(page.locator('.nm-file-name')).toHaveText('triangle.glb');
      await expect(page.locator('.nm-viewport')).toHaveAttribute('aria-label', 'triangle.glb');
      expect(await canvasState(page)).toEqual({ webgl2: true, fills: true });
      await expect(page.locator('.nm-error')).toBeHidden();
      await page.screenshot({ path: `${SCREENS}/viewport-${theme}.png` });
      expect(viewer.problems).toEqual([]);
    });

    test('explains when WebGL 2 is not available', async ({ page }) => {
      const viewer = await openViewer(page, theme, { withoutWebGL: true });
      await viewer.load('triangle.glb');

      await expect(page.locator('.nm-error')).toBeVisible();
      await expect(page.locator('.nm-error-title')).toHaveText("This model can't be displayed");
      await expect(page.locator('.nm-error-message')).toContainText("WebGL 2 isn't available");
      await expect(page.locator('.nm-canvas')).toHaveCount(0);
      expect(await lowestTextContrast(page)).toBeGreaterThanOrEqual(4.5);
      await page.screenshot({ path: `${SCREENS}/no-webgl-${theme}.png` });
      expect(viewer.problems).toEqual([]);
    });
  });
}

test('clears the viewport to the theme background and follows theme changes', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('triangle.glb');
  await expect.poll(() => viewportCenter(page)).toEqual([31, 31, 31]);

  await viewer.setTheme('light');
  await expect.poll(() => viewportCenter(page)).toEqual([255, 255, 255]);

  await viewer.setTheme('hcDark');
  await expect.poll(() => viewportCenter(page)).toEqual([0, 0, 0]);
  expect(viewer.problems).toEqual([]);
});

test('keeps the canvas sized to the viewport when the window resizes', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('triangle.glb');

  await page.setViewportSize({ width: 640, height: 420 });
  await expect.poll(() => canvasState(page)).toEqual({ webgl2: true, fills: true });
  expect(viewer.problems).toEqual([]);
});

test('tells the user when the graphics device stops and recovers', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('triangle.glb');
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
  await expect.poll(() => viewportCenter(page)).toEqual([31, 31, 31]);
  expect(viewer.problems).toEqual([]);
});

test('sends ready once and does not ask the host for anything else yet', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('triangle.gltf');

  await expect(page.locator('.nm-file-name')).toHaveText('triangle.gltf');
  expect(await viewer.sent()).toEqual([{ type: 'ready' }]);
});
