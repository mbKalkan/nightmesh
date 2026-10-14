// Downloads the sample models the README's screenshots show into .cache/samples, once.
// They come from the Khronos glTF Sample Assets at a fixed commit; see THIRD_PARTY_NOTICES.md.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const COMMIT = 'edc7c9e67c639d230715049ee31f9a96a6babbbe';
const BASE = `https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/${COMMIT}/Models`;
export const SAMPLES = '.cache/samples';

const FILES = {
  'ToyCar.glb': 'ToyCar/glTF-Binary/ToyCar.glb',
  'SheenChair.glb': 'SheenChair/glTF-Binary/SheenChair.glb',
  'Fox.glb': 'Fox/glTF-Binary/Fox.glb',
};

export async function downloadSamples() {
  mkdirSync(SAMPLES, { recursive: true });
  for (const [name, path] of Object.entries(FILES)) {
    const target = join(SAMPLES, name);
    if (existsSync(target)) continue;
    const response = await fetch(`${BASE}/${path}`);
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    writeFileSync(target, bytes);
    console.log(`downloaded ${name} (${(bytes.length / 1e6).toFixed(1)} MB)`);
  }
}
