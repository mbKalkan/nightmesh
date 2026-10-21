import { expect, test, type Page } from '@playwright/test';
import { openViewer } from './harness';

type Viewer = Awaited<ReturnType<typeof openViewer>>;

const SCREENS = 'test-results/screens';

/** The panels work the same with or without a 3D view, and are quicker to test without. */
const PANELS_ONLY = { withoutWebGL: true };

/** The first tree row labelled exactly `label`. */
const row = (page: Page, label: string) =>
  page
    .locator('.nm-tree-row', {
      has: page.locator('.nm-tree-label').getByText(label, { exact: true }),
    })
    .first();

/** Runs Copy Reference as the context menu (`atPointer`) or the Command Palette does. */
const copy = (viewer: Viewer, atPointer: boolean, details = false) =>
  viewer.post({ type: 'copyReference', atPointer, details });

/** The last reference the viewer asked the host to copy, without the message type. */
async function reference(viewer: Viewer) {
  const sent = (await viewer.sent()) as { type: string; location?: string; details?: string }[];
  const last = sent.filter((message) => message.type === 'reference').at(-1);
  return last && { location: last.location, details: last.details };
}

/** Context menus that reach VS Code: the ones no one in the page has handled. */
async function countMenus(page: Page) {
  await page.evaluate(() => {
    const menus: { x: number; y: number }[] = [];
    Object.assign(window, { __menus: menus });
    window.addEventListener('contextmenu', (event) => {
      if (!event.defaultPrevented) menus.push({ x: event.clientX, y: event.clientY });
    });
  });
  return () => page.evaluate(() => (window as unknown as { __menus: unknown[] }).__menus.length);
}

test('refers to the row or link right-clicked, and to the selection otherwise', async ({
  page,
}) => {
  const viewer = await openViewer(page, 'dark', PANELS_ONLY);
  await viewer.open('scene.glb');

  await row(page, 'Sphere').click({ button: 'right' });
  await expect(row(page, 'Sphere')).toHaveClass(/nm-menu-target/);
  // VS Code marks the page while its menu shows; the row is outlined then.
  await page.evaluate(() => document.body.classList.add('vscode-context-menu-visible'));
  await expect(row(page, 'Sphere')).toHaveCSS('outline-style', 'solid');
  await page.locator('.nm-panel-left').screenshot({ path: `${SCREENS}/reference-menu-dark.png` });
  await viewer.setTheme('light');
  await page.locator('.nm-panel-left').screenshot({ path: `${SCREENS}/reference-menu-light.png` });
  await page.evaluate(() => document.body.classList.remove('vscode-context-menu-visible'));
  await copy(viewer, true);
  await expect
    .poll(() => reference(viewer))
    .toEqual({ location: 'node "Sphere" (nodes[2]), under Root' });

  // From the Command Palette: the selection, which is still the model.
  await copy(viewer, false);
  await expect.poll(() => reference(viewer)).toEqual({});

  // From the keyboard, the menu opens on the tree, for its row in focus.
  await row(page, 'Box').click();
  await page.locator('.nm-tree').dispatchEvent('contextmenu');
  await expect(row(page, 'Box')).toHaveClass(/nm-menu-target/);
  await copy(viewer, true);
  await expect
    .poll(() => reference(viewer))
    .toEqual({ location: 'node "Box" (nodes[1]), under Root' });

  // A link in the inspector names what it links to; the rest of the inspector, what it shows.
  await page.locator('.nm-inspector-content .nm-link', { hasText: /^Box$/ }).first().click({
    button: 'right',
  });
  await copy(viewer, true);
  await expect.poll(() => reference(viewer)).toEqual({ location: 'mesh "Box" (meshes[0])' });
  await page.locator('.nm-inspector-heading').click({ button: 'right' });
  await copy(viewer, true, true);
  await expect
    .poll(async () => (await reference(viewer))?.location)
    .toBe('node "Box" (nodes[1]), under Root');
  expect((await reference(viewer))?.details).toContain('\n- translation: [-1.5, 0.5, 0]');

  // VS Code's own Cut and Paste are left out, except where there are values to copy.
  const context = (selector: string) =>
    page.locator(selector).evaluate((element) => {
      let merged = {};
      for (let at = element.closest('[data-vscode-context]'); at;) {
        merged = { ...JSON.parse((at as HTMLElement).dataset.vscodeContext!), ...merged };
        at = at.parentElement?.closest('[data-vscode-context]') ?? null;
      }
      return merged;
    });
  expect(await context('.nm-tree')).toEqual({
    preventDefaultContextMenuItems: true,
    nightmeshGltf: true,
  });
  expect(await context('.nm-inspector-content')).toEqual({
    preventDefaultContextMenuItems: false,
    nightmeshGltf: true,
  });
  expect(viewer.problems).toEqual([]);
});

test('refers to what is under the pointer in the view, and a right-drag opens no menu', async ({
  page,
}) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.open('scene.glb');
  const menus = await countMenus(page);
  const box = (await page.locator('.nm-viewport').boundingBox())!;
  const at = (x: number, y: number) => ({ x: box.x + box.width * x, y: box.y + box.height * y });

  const sphere = at(0.5, 0.53);
  await page.mouse.click(sphere.x, sphere.y, { button: 'right' });
  await expect.poll(menus).toBe(1);
  await copy(viewer, true);
  await expect
    .poll(() => reference(viewer))
    .toEqual({ location: 'node "Sphere" (nodes[2]), under Root' });
  // Right-clicking doesn't select.
  await expect(page.locator('.nm-inspector-heading')).toHaveText(/scene\.glb\s*Model/);

  const empty = at(0.05, 0.08);
  await page.mouse.click(empty.x, empty.y, { button: 'right' });
  await expect.poll(menus).toBe(2);
  await copy(viewer, true);
  await expect.poll(() => reference(viewer)).toEqual({});

  // Panning with the right button.
  await page.mouse.move(sphere.x, sphere.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(sphere.x + 60, sphere.y + 20, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(200);
  expect(await menus()).toBe(2);
  expect(viewer.problems).toEqual([]);
});
