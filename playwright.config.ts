import { defineConfig } from '@playwright/test';

// Renders the webview bundle in a browser with VS Code theme variables, for screenshots
// and end-to-end checks of the viewer UI. Uses the system Edge on Windows to avoid a download.
export default defineConfig({
  testDir: 'test/visual',
  outputDir: 'test-results/visual',
  reporter: 'list',
  // Software WebGL in CI takes seconds per test and threads of its own: two workers keep both
  // busy without starving them (four timed out), and any test can run on either.
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  use: {
    channel: process.platform === 'win32' ? 'msedge' : undefined,
    viewport: { width: 1100, height: 760 },
  },
});
