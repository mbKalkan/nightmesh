import { expect, test, type Page } from '@playwright/test';
import { openViewer } from './harness';
import { pixelsOf } from './pixels';

type Viewer = Awaited<ReturnType<typeof openViewer>>;

/** The environment the view sent to the host to keep, with its bytes in base64. */
async function keptEnvironment(page: Page) {
  await page.waitForFunction(() =>
    (window as unknown as { __sent: { type: string }[] }).__sent.some(
      (m) => m.type === 'environment',
    ),
  );
  return page.evaluate(() => {
    const sent = (window as unknown as { __sent: { type: string; environment?: unknown }[] })
      .__sent;
    const { environment } = sent.find((m) => m.type === 'environment') as unknown as {
      environment: { key: string; width: number; height: number; data: Uint8Array };
    };
    let binary = '';
    for (let i = 0; i < environment.data.length; i += 0x8000) {
      binary += String.fromCharCode(...environment.data.subarray(i, i + 0x8000));
    }
    return { ...environment, data: btoa(binary) };
  });
}

/** Opens a model as the host does when it kept an environment, given with the open message. */
async function openWith(
  page: Page,
  viewer: Viewer,
  fixture: string,
  environment: { key: string; width: number; height: number; data: string },
) {
  await page.evaluate(
    ({ message, environment }) => {
      const data = Uint8Array.from(atob(environment.data), (c) => c.charCodeAt(0));
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { ...message, environment: { ...environment, data } },
        }),
      );
    },
    { message: viewer.openMessage(fixture), environment },
  );
  for (const message of await viewer.messages(fixture)) await viewer.post(message);
  await page.waitForSelector('.nm-viewport[data-state="shown"]');
}

test('makes the lighting once, and draws the same with what the host kept', async ({ browser }) => {
  const first = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  const made = await openViewer(first, 'dark');
  await made.open('materials.glb');
  const environment = await keptEnvironment(first);
  expect(environment.key).toMatch(/^room-0\.04-three-\d+$/);
  expect(environment.width * environment.height * 8).toBe(atob(environment.data).length);

  const second = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  const given = await openViewer(second, 'dark');
  await openWith(second, given, 'materials.glb', environment);
  // It needn't make one of its own.
  expect((await given.sent()).some((m) => m.type === 'environment')).toBe(false);

  const [a, b] = [await pixelsOf(first, '.nm-canvas'), await pixelsOf(second, '.nm-canvas')];
  let worst = 0;
  for (let y = 0; y < a.height; y += 2) {
    for (let x = 0; x < a.width; x += 2) {
      const [p, q] = [a.at(x, y), b.at(x, y)];
      worst = Math.max(worst, ...p.map((value, i) => Math.abs(value - q[i])));
    }
  }
  expect(worst).toBeLessThanOrEqual(2);
  expect([...made.problems, ...given.problems]).toEqual([]);
});

test('makes the lighting itself when what the host kept was made otherwise', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  const stale = { key: 'room-0.04-three-1', width: 2, height: 2, data: btoa('\0'.repeat(32)) };
  await openWith(page, viewer, 'materials.glb', stale);
  const made = await keptEnvironment(page);
  expect(made.key).not.toBe(stale.key);
  expect(viewer.problems).toEqual([]);
});
