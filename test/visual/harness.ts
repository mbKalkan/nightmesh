import { readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { fileResourceOpener } from '../../src/extension/model/fileResources';
import { loadMessages } from '../../src/extension/model/load';
import { fileSource } from '../../src/extension/model/sources';
import { loadTexts, viewerStrings, type Translate } from '../../src/extension/texts';
import { buildWebviewHtml } from '../../src/extension/webviewHtml';
import { formatForPath } from '../../src/shared/formats';
import type { HostToWebviewMessage } from '../../src/shared/protocol';
import { themes, type ThemeName } from './themes';

interface Theme {
  kind: string;
  classes: readonly string[];
  variables: Record<string, string>;
}

const ORIGIN = 'http://webview.test';
const FIXTURES = resolve('test/fixtures');

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
};

/** English, as VS Code shows it without a language pack. */
export const english: Translate = (message, ...args) =>
  message.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)]));

export const strings = viewerStrings(english);

export interface ViewerOptions {
  /** Makes `getContext('webgl2')` fail, as on a machine without GPU acceleration. */
  withoutWebGL?: boolean;
}

/**
 * Loads the built webview (dist/webview) the way VS Code does: same HTML, same CSP,
 * a stubbed `acquireVsCodeApi`, and theme variables on the root element.
 */
export async function openViewer(page: Page, theme: ThemeName, options: ViewerOptions = {}) {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));

  await page.route(`${ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/index.html') {
      await route.fulfill({
        contentType: 'text/html',
        body: buildWebviewHtml({
          cspSource: ORIGIN,
          scriptUri: `${ORIGIN}/dist/webview/main.js`,
          styleUri: `${ORIGIN}/dist/webview/main.css`,
          lang: 'en',
        }),
      });
      return;
    }
    try {
      const body = readFileSync(join(process.cwd(), path));
      await route.fulfill({ body, contentType: CONTENT_TYPES[extname(path)] });
    } catch {
      await route.fulfill({ status: 404 });
    }
  });

  await page.addInitScript(
    ({ theme, withoutWebGL }) => {
      const sent: unknown[] = [];
      // VS Code replaces all theme variables and classes on a theme change.
      const applyTheme = ({ kind, classes, variables }: typeof theme) => {
        const root = document.documentElement;
        for (const name of [...root.style]) {
          if (name.startsWith('--vscode-')) root.style.removeProperty(name);
        }
        for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value);
        document.body.classList.remove(
          'vscode-dark',
          'vscode-light',
          'vscode-high-contrast',
          'vscode-high-contrast-light',
        );
        document.body.classList.add(...classes);
        document.body.dataset.vscodeThemeKind = kind;
      };
      Object.assign(window, {
        __sent: sent,
        __applyTheme: applyTheme,
        acquireVsCodeApi: () => ({ postMessage: (message: unknown) => sent.push(message) }),
      });
      if (withoutWebGL) {
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (
          this: HTMLCanvasElement,
          type: string,
          ...rest: unknown[]
        ) {
          return type.startsWith('webgl') ? null : getContext.call(this, type, ...rest);
        } as typeof getContext;
      }
      // Init scripts run before the document exists, so theme it once parsing is done.
      document.addEventListener('DOMContentLoaded', () => applyTheme(theme));
    },
    { theme: themes[theme] as Theme, withoutWebGL: options.withoutWebGL ?? false },
  );

  await page.goto(`${ORIGIN}/index.html`);
  await page.waitForFunction(() =>
    (window as unknown as { __sent: { type: string }[] }).__sent.some((m) => m.type === 'ready'),
  );

  let loadId = 0;
  return {
    problems,
    /** Delivers a message as if it came from the extension host. Bytes travel as base64. */
    async post(message: HostToWebviewMessage) {
      const bytes = 'data' in message ? Buffer.from(message.data).toString('base64') : null;
      await page.evaluate(
        ({ message, bytes }) => {
          const data = { ...message } as Record<string, unknown>;
          if (bytes !== null) data.data = Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0));
          window.dispatchEvent(new MessageEvent('message', { data }));
        },
        { message: { ...message, data: undefined }, bytes },
      );
    },
    /**
     * Opens a fixture the way the extension host does, with the host's own loading code: the
     * fixtures folder stands in for the workspace, so resources can't reach outside it.
     */
    async open(fixture: string, { reload = false } = {}) {
      if (!reload) {
        await this.post({
          type: 'open',
          fileName: fixture,
          format: formatForPath(fixture) ?? 'glb',
          strings,
        });
      }
      // Cleared here, so waiting for it below waits for this load and not the one before.
      await page.evaluate(() => {
        delete (document.querySelector('.nm-viewport') as HTMLElement).dataset.state;
      });
      const source = await fileSource(join(FIXTURES, fixture));
      const opener = fileResourceOpener('/fixtures', '/fixtures', (path) =>
        join(FIXTURES, path.slice('/fixtures'.length)),
      );
      try {
        const options = { loadId: ++loadId, reload, texts: loadTexts(english) };
        for await (const message of loadMessages(source, opener, options)) {
          await this.post(message);
        }
      } finally {
        await source.close();
      }
      await page.waitForSelector('.nm-viewport[data-state]');
      await page.waitForSelector('.nm-progress', { state: 'hidden' });
    },
    /** Switches the theme the way VS Code does: CSS variables plus body classes. */
    async setTheme(name: ThemeName) {
      await page.evaluate(
        (theme) => (window as unknown as { __applyTheme(theme: Theme): void }).__applyTheme(theme),
        themes[name] as Theme,
      );
    },
    sent: () => page.evaluate(() => (window as unknown as { __sent: { type: string }[] }).__sent),
  };
}
