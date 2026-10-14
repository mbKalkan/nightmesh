// Regenerates the README and Marketplace screenshots in docs/images, from the sample models.
import { spawnSync } from 'node:child_process';
import { downloadSamples } from './samples.mjs';

await downloadSamples();
const build = spawnSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);
const result = spawnSync('npx', ['playwright', 'test', 'test/visual/readme.spec.ts'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, README_SCREENSHOTS: '1' },
});
process.exit(result.status ?? 1);
