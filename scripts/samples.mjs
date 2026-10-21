// Downloads the sample models the README's screenshots show into .cache/samples, once.
// They come from the Khronos glTF Sample Assets and NASA 3D Resources at fixed commits; see
// THIRD_PARTY_NOTICES.md.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const KHRONOS =
  'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/edc7c9e67c639d230715049ee31f9a96a6babbbe/Models';
const NASA =
  'https://raw.githubusercontent.com/nasa/NASA-3D-Resources/11ebb4ee043715aefbba6aeec8a61746fad67fa7';
export const SAMPLES = '.cache/samples';

const FILES = {
  'CarConcept.glb': `${KHRONOS}/CarConcept/glTF-Binary/CarConcept.glb`,
  'ToyCar.glb': `${KHRONOS}/ToyCar/glTF-Binary/ToyCar.glb`,
  'SheenChair.glb': `${KHRONOS}/SheenChair/glTF-Binary/SheenChair.glb`,
  'Fox.glb': `${KHRONOS}/Fox/glTF-Binary/Fox.glb`,
  'Mars2020Wheel.stl': `${NASA}/3D%20Printing/Mars%202020%205%20inch%20wheel/Mars%202020%205%20inch%20wheel.stl`,
};

export async function downloadSamples() {
  mkdirSync(SAMPLES, { recursive: true });
  for (const [name, url] of Object.entries(FILES)) {
    const target = join(SAMPLES, name);
    if (existsSync(target)) continue;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    writeFileSync(target, bytes);
    console.log(`downloaded ${name} (${(bytes.length / 1e6).toFixed(1)} MB)`);
  }
}
