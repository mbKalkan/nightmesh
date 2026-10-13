import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { Page } from '@playwright/test';
import { buildWebviewHtml } from '../../src/extension/webviewHtml';
import { formatForPath } from '../../src/shared/formats';
import type { HostToWebviewMessage, ViewerStrings } from '../../src/shared/protocol';
import { themes, type ThemeName } from './themes';

interface Theme {
  kind: string;
  classes: readonly string[];
  variables: Record<string, string>;
}

const ORIGIN = 'http://webview.test';

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
};

export const strings: ViewerStrings = {
  errorTitle: "This model can't be displayed",
  errorWebGL:
    "WebGL 2 isn't available, so the model can't be drawn. Check that hardware acceleration isn't turned off in VS Code.",
  errorContextLost:
    'The graphics device stopped responding. The model will be drawn again when it recovers.',
};

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

  return {
    problems,
    /** Delivers a message as if it came from the extension host. */
    async post(message: HostToWebviewMessage) {
      await page.evaluate((data) => window.dispatchEvent(new MessageEvent('message', { data })), {
        ...message,
      });
    },
    async load(fixture: string) {
      await this.post({
        type: 'load',
        fileName: fixture,
        format: formatForPath(fixture) ?? 'glb',
        strings,
      });
      await page.waitForSelector('.nm-canvas, .nm-error:not([hidden])');
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
