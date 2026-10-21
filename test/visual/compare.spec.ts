import { expect, test, type Page } from '@playwright/test';
import type { CameraState } from '../../src/shared/protocol';
import { openViewer } from './harness';

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
