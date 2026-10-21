import { expect, test, type Page } from '@playwright/test';
import type { CameraState, HostToWebviewMessage } from '../../src/shared/protocol';
import { lowestTextContrast } from './contrast';
import { openViewer } from './harness';
import { areaOf } from './pixels';
import type { ThemeName } from './themes';

const SCREENS = 'test-results/screens';

type Viewer = Awaited<ReturnType<typeof openViewer>>;

/** The cameras a viewer told the host about, in order. */
const cameras = async (viewer: Viewer) =>
  ((await viewer.sent()) as { type: string; camera?: CameraState }[])
    .filter((message) => message.type === 'camera')
    .map((message) => message.camera!);

const press = async (page: Page, key: string) => {
  await page.locator('.nm-viewport').focus();
  await page.keyboard.press(key);
};

test.use({ reducedMotion: 'reduce' });

test('the modified side of a comparison says where its camera is, and takes the other one', async ({
  page,
}) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.post({ type: 'diff', side: 'modified' });
  await viewer.open('scene.glb');
  // Its first framing, for the other side to take.
  await expect.poll(async () => (await cameras(viewer)).length).toBeGreaterThan(0);

  // Looking from the right: the camera is on the +X side of the point it orbits.
  await press(page, '3');
  await expect
    .poll(async () => {
      const last = (await cameras(viewer)).at(-1)!;
      return last.position[0] - last.target[0] > 0 && Math.abs(last.position[2] - last.target[2]);
    })
    .toBeLessThan(1e-6);

  // The other side looks from the front: this side takes it, and says nothing back.
  const right = (await cameras(viewer)).at(-1)!;
  const distance = right.position[0] - right.target[0];
  const front: CameraState = {
    ...right,
    position: [right.target[0], right.target[1], right.target[2] + distance],
  };
  const before = (await cameras(viewer)).length;
  await viewer.post({ type: 'peerCamera', camera: front });
  await page.waitForTimeout(300);
  expect((await cameras(viewer)).length).toBe(before);
  // From there, the other side of the model is behind it: the camera goes to -Z.
  await press(page, '9');
  await expect
    .poll(async () => {
      const last = (await cameras(viewer)).at(-1)!;
      return last.position[2] - last.target[2];
    })
    .toBeLessThan(0);
  expect(viewer.problems).toEqual([]);
});

test('the original side follows the modified one before it says where it moves', async ({
  page,
}) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.post({ type: 'diff', side: 'original' });
  await viewer.open('scene.glb');
  await press(page, '3');
  await page.waitForTimeout(300);
  // Its own framing and moves stay here until it has taken the other side's camera.
  expect(await cameras(viewer)).toEqual([]);

  await viewer.post({
    type: 'peerCamera',
    camera: {
      projection: 'perspective',
      position: [0, 1, 6],
      target: [0, 0.5, 0],
      fov: 45,
      height: 1,
      zoom: 1,
    },
  });
  await press(page, '7');
  await expect.poll(async () => (await cameras(viewer)).length).toBeGreaterThan(0);
  // Seen from the top: the camera is above the point it orbits.
  const last = (await cameras(viewer)).at(-1)!;
  expect(last.position[1]).toBeGreaterThan(last.target[1]);

  // Out of the comparison: it says nothing more.
  await viewer.post({ type: 'diff', side: undefined });
  const count = (await cameras(viewer)).length;
  await press(page, '1');
  await page.waitForTimeout(300);
  expect((await cameras(viewer)).length).toBe(count);
  expect(viewer.problems).toEqual([]);
});

test('two sides relayed as the host does move together, and settle', async ({ browser }) => {
  const pages = await Promise.all([browser.newPage(), browser.newPage()]);
  const [original, modified] = await Promise.all([
    openViewer(pages[0], 'dark'),
    openViewer(pages[1], 'dark'),
  ]);
  await original.post({ type: 'diff', side: 'original' });
  await modified.post({ type: 'diff', side: 'modified' });
  // What the host does: each camera a side tells it goes to the other side.
  const relayed = [0, 0];
  const relay = async () => {
    for (const [index, [from, to]] of [
      [original, modified],
      [modified, original],
    ].entries()) {
      const told = await cameras(from);
      for (const camera of told.slice(relayed[index]))
        await to.post({ type: 'peerCamera', camera });
      relayed[index] = told.length;
    }
  };
  const settle = async () => {
    // Relays until neither side has anything more to say.
    for (let round = 0; round < 20; round++) {
      const before = relayed.join();
      await pages[0].waitForTimeout(150);
      await relay();
      if (relayed.join() === before) return round;
    }
    throw new Error('The two sides kept telling each other where they are');
  };
  // Two different models: each frames its own, and the original then takes the modified's view.
  await Promise.all([original.open('scene.glb'), modified.open('materials.glb')]);
  await settle();
  const radius = (camera: CameraState) =>
    Math.hypot(...camera.position.map((value, axis) => value - camera.target[axis]));

  // The original turns to the top view: the modified side goes there, and says nothing back.
  const told = (await cameras(modified)).length;
  await press(pages[0], '7');
  await settle();
  expect((await cameras(modified)).length).toBe(told);
  const top = (await cameras(original)).at(-1)!;

  // The modified side, from where the original put it, turns to look from below: around the same
  // point, as far away.
  await press(pages[1], 'Shift+7');
  await settle();
  const below = (await cameras(modified)).at(-1)!;
  expect(below.target).toEqual(top.target);
  expect(radius(below)).toBeCloseTo(radius(top), 6);
  expect(below.position[1]).toBeLessThan(below.target[1]);
  expect(original.problems).toEqual([]);
  expect(modified.problems).toEqual([]);
  await Promise.all(pages.map((page) => page.close()));
});

/** The first tree row labelled exactly `label`. */
const row = (page: Page, label: string) =>
  page
    .locator('.nm-tree-row', {
      has: page.locator('.nm-tree-label').getByText(label, { exact: true }),
    })
    .first();
const selectedTab = (page: Page) =>
  page.locator('.nm-panel-right [role="tab"][aria-selected="true"]');

/**
 * Relays what each side tells the host to the other side, as the host does: summaries and
 * selections. Returns a function that relays what was said since it last ran.
 */
function relayer(sides: [Viewer, Viewer]) {
  const relayed = [0, 0];
  return async () => {
    for (const [index, [from, to]] of [
      [sides[0], sides[1]],
      [sides[1], sides[0]],
    ].entries()) {
      const sent = (await from.sent()) as { type: string; [key: string]: unknown }[];
      for (const message of sent.slice(relayed[index])) {
        if (message.type === 'summary')
          await to.post({ type: 'peerSummary', summary: message.summary } as HostToWebviewMessage);
        if (message.type === 'compareSelect')
          await to.post({ type: 'peerSelect', target: message.target } as HostToWebviewMessage);
      }
      relayed[index] = sent.length;
    }
  };
}

for (const theme of ['dark', 'light'] as ThemeName[]) {
  test(`lists what changed between two versions, marks it in the tree and selects the same on both sides, ${theme} theme`, async ({
    browser,
  }) => {
    const pages = await Promise.all([browser.newPage(), browser.newPage()]);
    const sides = await Promise.all(
      pages.map((page) => openViewer(page, theme, { withoutWebGL: true })),
    );
    const [original, modified] = sides;
    const relay = relayer([original, modified]);
    await Promise.all([original.open('scene.glb'), modified.open('scene-edited.glb')]);
    await original.post({ type: 'diff', side: 'original' });
    await modified.post({ type: 'diff', side: 'modified' });

    // The changes tab comes first and opens, and waits for the other side.
    await expect(selectedTab(pages[0])).toHaveText('Changes');
    await expect(pages[0].locator('.nm-compare')).toHaveText(/Waiting for the other version/);
    await relay();

    for (const page of pages) {
      await expect(page.locator('.nm-compare-count')).toHaveText('5 changes');
      await expect(selectedTab(page)).toHaveText(/Changes\s*5/);
      // Each with its letter, then what screen readers hear, then what changed about it.
      await expect(page.locator('.nm-compare-list li')).toHaveText([
        'MRoot/Box, Changed: Transform',
        'DRoot/Group/Points, Removed',
        'ARoot/Group/Tall Box, Added',
        'DCloud, Removed',
        'MClay, Changed: pbrMetallicRoughness',
      ]);
      // The file shrank, from what to what and by how much; what stayed shows once.
      await expect(page.locator('.nm-compare-totals dd').first()).toHaveText(
        '28.6 KB → 27.6 KB (−1.1 KB)',
      );
      await expect(page.locator('.nm-compare-totals dd').nth(1)).toHaveText('12');
    }
    // Each side marks what it has: the original what was removed, the modified what was added,
    // both what changed, and a dot on what holds a change.
    const mark = (page: Page, label: string) => row(page, label).locator('.nm-change-mark');
    await expect(mark(pages[0], 'Box')).toHaveText('M');
    await expect(mark(pages[1], 'Box')).toHaveText('M');
    await expect(mark(pages[0], 'Group')).toHaveText('•');
    await expect(mark(pages[0], 'Materials')).toHaveText('•');
    await expect(mark(pages[0], 'Sphere')).toHaveCount(0);
    await expect(row(pages[0], 'Box')).toHaveAttribute('title', 'Box (Changed)');

    // Following the removed points on the original side opens them there; the modified side
    // has none, and selects nothing.
    await pages[1].locator('.nm-compare-list .nm-link', { hasText: 'Root/Box' }).click();
    await relay();
    await expect(row(pages[0], 'Box')).toHaveAttribute('aria-selected', 'true');
    await pages[0].locator('.nm-compare-list .nm-link', { hasText: 'Points' }).click();
    await relay();
    await expect(mark(pages[0], 'Points')).toHaveText('D');
    await expect(row(pages[0], 'Points')).toHaveAttribute('aria-selected', 'true');
    await expect(row(pages[1], 'Model')).toHaveAttribute('aria-selected', 'true');
    await expect(pages[1].locator('.nm-compare-list .nm-link', { hasText: 'Points' })).toHaveCount(
      0,
    );

    for (const [index, page] of pages.entries()) {
      // VS Code's own red for what was removed, on its letter, reads less well than text should.
      expect(
        await lowestTextContrast(page, '#app', '.nm-change-removed .nm-change-mark'),
      ).toBeGreaterThanOrEqual(4.5);
      await page.screenshot({
        path: `${SCREENS}/compare-${index === 0 ? 'original' : 'modified'}-${theme}.png`,
      });
    }

    // Out of the comparison, the tab and the marks go.
    await original.post({ type: 'diff', side: undefined });
    await expect(selectedTab(pages[0])).toHaveText('Inspector');
    await expect(pages[0].locator('.nm-panel-tab', { hasText: 'Changes' })).toHaveCount(0);
    await expect(pages[0].locator('.nm-change-mark')).toHaveCount(0);
    expect(original.problems).toEqual([]);
    expect(modified.problems).toEqual([]);
    await Promise.all(pages.map((page) => page.close()));
  });
}

/** Source Control's colors in the dark theme: added, removed and changed. */
const ADDED = [0x81, 0xb8, 0x8b];
const REMOVED = [0xc7, 0x4e, 0x39];
const CHANGED = [0xe2, 0xc0, 0x8d];

test('boxes what changed in the 3D view, in Source Control colors', async ({ browser }) => {
  const pages = await Promise.all([browser.newPage(), browser.newPage()]);
  const [original, modified] = await Promise.all(pages.map((page) => openViewer(page, 'dark')));
  const relay = relayer([original, modified]);
  await Promise.all([original.open('scene.glb'), modified.open('scene-edited.glb')]);
  await original.post({ type: 'diff', side: 'original' });
  await modified.post({ type: 'diff', side: 'modified' });
  await relay();
  // The size and the axes gizmo, in colors of their own, set aside.
  for (const page of pages) {
    for (const overlay of ['.nm-measure', '.nm-gizmo']) {
      await page.locator(overlay).evaluate((element) => (element.style.visibility = 'hidden'));
    }
  }
  const boxed = (page: Page, color: readonly number[]) =>
    areaOf(page, '.nm-canvas', color).then((area) => area?.count ?? 0);

  // The original side has the moved box and the points that went; the modified side has the
  // moved box and the tall box that came.
  await expect.poll(() => boxed(pages[0], CHANGED)).toBeGreaterThan(20);
  await expect.poll(() => boxed(pages[0], REMOVED)).toBeGreaterThan(20);
  expect(await boxed(pages[0], ADDED)).toBe(0);
  await expect.poll(() => boxed(pages[1], CHANGED)).toBeGreaterThan(20);
  await expect.poll(() => boxed(pages[1], ADDED)).toBeGreaterThan(20);
  expect(await boxed(pages[1], REMOVED)).toBe(0);
  for (const [index, page] of pages.entries()) {
    await page.screenshot({
      path: `${SCREENS}/compare-boxes-${index === 0 ? 'original' : 'modified'}-dark.png`,
    });
  }

  // The View menu turns them off.
  await pages[1].locator('[data-action="view"]').click();
  await pages[1]
    .locator('.nm-menu .nm-menu-item', { has: pages[1].getByText('Changes', { exact: true }) })
    .click();
  await expect.poll(() => boxed(pages[1], ADDED)).toBe(0);

  // Out of the comparison, they go.
  await original.post({ type: 'diff', side: undefined });
  await expect.poll(() => boxed(pages[0], REMOVED)).toBe(0);
  expect(original.problems).toEqual([]);
  expect(modified.problems).toEqual([]);
  await Promise.all(pages.map((page) => page.close()));
});
