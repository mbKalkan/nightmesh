import { expect, test, type Page } from '@playwright/test';
import { openViewer } from './harness';
import { pixelsOf } from './pixels';
import type { ThemeName } from './themes';

const SCREENS = 'test-results/screens';

test.use({ reducedMotion: 'reduce' });

/** The inspector's section titled `title`. */
const section = (page: Page, title: string) =>
  page.locator('.nm-section', {
    has: page.locator('.nm-section-title', {
      hasText: new RegExp(`^${title.replace(/[()]/g, '\\$&')}$`),
    }),
  });

/**
 * Clicks the pixel of the color `matches` nearest to the middle of where it shows: one whose
 * neighbours have it too, so not an edge.
 */
async function clickColor(page: Page, matches: (rgb: number[]) => boolean): Promise<void> {
  const pixels = await pixelsOf(page, '.nm-canvas');
  const canvas = (await page.locator('.nm-canvas').boundingBox())!;
  const hit = (x: number, y: number) => matches(pixels.at(x, y));
  let [sumX, sumY, count] = [0, 0, 0];
  for (let y = 2; y < pixels.height - 2; y += 2) {
    for (let x = 2; x < pixels.width - 2; x += 2) {
      if (hit(x, y)) [sumX, sumY, count] = [sumX + x, sumY + y, count + 1];
    }
  }
  expect(count).toBeGreaterThan(20);
  const center = { x: sumX / count, y: sumY / count };
  let best = { ...center, distance: Infinity };
  for (let y = 3; y < pixels.height - 3; y++) {
    for (let x = 3; x < pixels.width - 3; x++) {
      if (![-2, 0, 2].every((dy) => [-2, 0, 2].every((dx) => hit(x + dx, y + dy)))) continue;
      const distance = (x - center.x) ** 2 + (y - center.y) ** 2;
      if (distance < best.distance) best = { x, y, distance };
    }
  }
  expect(best.distance).toBeLessThan(Infinity);
  await page.mouse.click(
    canvas.x + best.x * (canvas.width / pixels.width),
    canvas.y + best.y * (canvas.height / pixels.height),
  );
}

const red = ([r, g, b]: number[]) => r > 60 && r > g * 2.5 && r > b * 2.5;
const yellow = ([r, g, b]: number[]) => r > 90 && g > 70 && r > b * 2.5 && g > b * 2.5;
const magenta = ([r, g, b]: number[]) => r > 70 && b > 60 && r > g * 2.5 && b > g * 2.5;

for (const theme of ['dark', 'light'] as ThemeName[]) {
  test(`shows the feature IDs and metadata of the point clicked, ${theme} theme`, async ({
    page,
  }) => {
    const viewer = await openViewer(page, theme);
    await viewer.open('features.glb');
    await expect(page.locator('.nm-viewport')).toHaveAttribute('data-state', 'shown');

    // The red building: its feature by attribute, with its property table row, then its vertex.
    await clickColor(page, red);
    const building = section(page, 'Feature (building)');
    await expect(building.locator('dt')).toHaveText([
      'Feature ID',
      'Class',
      'name',
      'height',
      'kind',
      'floors',
      'origin',
      'built',
    ]);
    await expect(building.locator('dd')).toContainText([
      '0of 2',
      'building',
      'Town hall',
      '12.5',
      'civic',
      '3',
      '[-1.5, 0, -1]',
      '1923',
    ]);
    const vertex = section(page, 'Feature (vertex)');
    await expect(vertex.locator('dd')).toHaveText([/^([0-9]|1[0-9]|2[0-3])of 48$/]);
    await page.screenshot({ path: `${SCREENS}/metadata-building-${theme}.png` });

    // The ground's east half: its feature and properties are in a texture.
    await clickColor(page, magenta);
    await expect(section(page, 'Feature (parcel)').locator('dd')).toHaveText(['1of 2']);
    const texture = section(page, 'Texture properties');
    await expect(texture.locator('dt')).toHaveText(['Class', 'moisture', 'zone']);
    await expect(texture.locator('dd')).toHaveText(['parcel', '0.8', 'plaza']);
    await expect(section(page, 'Feature (building)')).toHaveCount(0);

    await clickColor(page, yellow);
    await expect(section(page, 'Feature (parcel)').locator('dd')).toHaveText(['0of 2']);
    await expect(texture.locator('dd')).toHaveText(['parcel', '0.2', 'park']);
    await page.screenshot({ path: `${SCREENS}/metadata-ground-${theme}.png` });
  });
}
