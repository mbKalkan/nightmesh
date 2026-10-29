import { readFileSync } from 'node:fs';
import { extname, join, posix, resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { fileResourceOpener } from '../../src/extension/model/fileResources';
import { loadMessages } from '../../src/extension/model/load';
import { fileSource } from '../../src/extension/model/sources';
import { gltfFile } from '../../src/extension/model/tileGltf';
import { readTile } from '../../src/extension/model/tiles';
import { validationMessage } from '../../src/extension/model/validation';
import { runValidator } from '../../src/extension/model/validator';
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

/** A tile as the host reads it, with its bytes in base64 to cross into the page. */
type TileAnswer = { data: string } | { problem: string };
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
      // Tiles are read as the host reads them, as the webview asks for them.
      const answerTile = async (id: number, path: string) => {
        const read = (window as unknown as { __readTile(path: string): Promise<TileAnswer> })
          .__readTile;
        const answer = await read(path);
        const data =
          'data' in answer
            ? { type: 'tile', id, data: Uint8Array.from(atob(answer.data), (c) => c.charCodeAt(0)) }
            : { type: 'tile', id, problem: answer.problem };
        window.dispatchEvent(new MessageEvent('message', { data }));
      };
      Object.assign(window, {
        __sent: sent,
        __applyTheme: applyTheme,
        acquireVsCodeApi: () => {
          let state: unknown;
          return {
            postMessage: (message: { type: string; id?: number; path?: string }) => {
              sent.push(message);
              if (message.type === 'tile') void answerTile(message.id!, message.path!);
            },
            getState: () => state,
            setState: (value: unknown) => void (state = value),
          };
        },
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

  await page.exposeFunction('__readTile', async (path: string): Promise<TileAnswer> => {
    const tile = await readTile(path, fixtureOpener(), loadTexts(english));
    return 'data' in tile ? { data: Buffer.from(tile.data).toString('base64') } : tile;
  });
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
      if (!reload) await this.post(this.openMessage(fixture));
      // Cleared here, so waiting for it below waits for this load and not the one before.
      await page.evaluate(() => {
        delete (document.querySelector('.nm-viewport') as HTMLElement).dataset.state;
      });
      for (const message of await this.messages(fixture, { reload })) await this.post(message);
      await page.waitForSelector('.nm-viewport[data-state]');
      await page.waitForSelector('.nm-progress', { state: 'hidden' });
    },
    openMessage: (fixture: string): HostToWebviewMessage => ({
      type: 'open',
      fileName: fixture,
      format: formatForPath(fixture) ?? 'glb',
      locale: 'en',
      strings,
      preferences: {},
    }),
    /** The messages the host sends for one load of a fixture, to post some or all of them. */
    async messages(
      fixture: string,
      { reload = false, largeBytes = undefined as number | undefined } = {},
    ) {
      const source = await fileSource(join(FIXTURES, fixture));
      const messages: HostToWebviewMessage[] = [];
      try {
        const options = {
          loadId: ++loadId,
          reload,
          texts: loadTexts(english),
          format: formatForPath(fixture),
          fileName: fixture,
          largeBytes,
          tilesetPath: fixture,
        };
        for await (const message of loadMessages(
          source,
          fixtureOpener(fixtureFolder(fixture)),
          options,
        )) {
          messages.push(message);
        }
      } finally {
        await source.close();
      }
      return messages;
    },
    /** What the host sends once it has validated a fixture, for the last load. */
    async validation(fixture: string) {
      const source = await fileSource(join(FIXTURES, fixture));
      const gltf = await gltfFile(
        source,
        formatForPath(fixture) ?? 'glb',
        fixtureOpener(fixtureFolder(fixture)),
      );
      try {
        return await validationMessage(
          gltf.source,
          gltf.open,
          runValidator,
          loadId,
          loadTexts(english),
        );
      } finally {
        await gltf.close();
        await source.close();
      }
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

/** Resources of a fixture: the fixtures folder stands in for the workspace. */
/** A fixture's folder, as a model's is in a VS Code URI. */
const fixtureFolder = (fixture: string) => posix.dirname(`/fixtures/${fixture}`);

/** Opens what a fixture refers to, relative to `folder`: the fixture's own, or the root. */
function fixtureOpener(folder = '/fixtures') {
  return fileResourceOpener(folder, '/fixtures', (path) =>
    join(FIXTURES, path.slice('/fixtures'.length)),
  );
}
