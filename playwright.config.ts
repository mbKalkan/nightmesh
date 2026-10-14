import { defineConfig } from '@playwright/test';

// Renders the webview bundle in a browser with VS Code theme variables, for screenshots
// and end-to-end checks of the viewer UI. Uses the system Edge on Windows to avoid a download.
export default defineConfig({
  testDir: 'test/visual',
  outputDir: 'test-results/visual',
  reporter: 'list',
  // Each test draws with software WebGL in CI, which takes seconds; spread them over every core.
  fullyParallel: true,
  workers: process.env.CI ? 4 : undefined,
  use: {
    channel: process.platform === 'win32' ? 'msedge' : undefined,
    viewport: { width: 1100, height: 760 },
  },
});
