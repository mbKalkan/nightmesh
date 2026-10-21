import { join, resolve } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { fileResourceOpener } from '../../src/extension/model/fileResources';
import { loadMessages } from '../../src/extension/model/load';
import { fileSource } from '../../src/extension/model/sources';
import { formatForPath } from '../../src/shared/formats';
import { validationMessage } from '../../src/extension/model/validation';
import { runValidator } from '../../src/extension/model/validator';
import { loadTexts } from '../../src/extension/texts';
import { english, type openViewer } from './harness';

/** Where `npm run screenshots` and `npm run demo` download the Khronos sample models. */
const SAMPLES = resolve('.cache/samples');

type Viewer = Awaited<ReturnType<typeof openViewer>>;

const opener = () =>
  fileResourceOpener('/samples', '/samples', (path) =>
    join(SAMPLES, path.slice('/samples'.length)),
  );

/**
 * Opens a sample the way the extension host does, under its own name, and waits for it; then
 * validates it, when asked, as the host does once a model has loaded.
 */
export async function openSample(
  page: Page,
  viewer: Viewer,
  name: string,
  { validate = false } = {},
) {
  await viewer.post(viewer.openMessage(name));
  const source = await fileSource(join(SAMPLES, name));
  try {
    const options = {
      loadId: 1,
      reload: false,
      texts: loadTexts(english),
      format: formatForPath(name),
      fileName: name,
    };
    for await (const message of loadMessages(source, opener(), options)) {
      await viewer.post(message);
    }
    if (validate) {
      await viewer.post(
        await validationMessage(source, opener(), runValidator, 1, loadTexts(english)),
      );
    }
  } finally {
    await source.close();
  }
  await expect(page.locator('.nm-viewport')).toHaveAttribute('data-state', 'shown', {
    timeout: 60_000,
  });
}

export const menuButton = (page: Page, action: string) => page.locator(`[data-action="${action}"]`);
export const menuItem = (page: Page, label: string) =>
  page.locator('.nm-menu .nm-menu-item', { has: page.getByText(label, { exact: true }) });
export const tab = (page: Page, label: string) => page.locator('.nm-panel-tab', { hasText: label });
