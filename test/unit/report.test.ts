import { describe, expect, it } from 'vitest';
import { viewerStrings, type Translate } from '../../src/extension/texts';
import type { ValidationReport } from '../../src/shared/protocol';
import { Formatter } from '../../src/webview/structure/format';
import { GltfModel } from '../../src/webview/structure/gltf';
import { buildReport } from '../../src/webview/structure/report';
import { sizeAnalysis } from '../../src/webview/structure/sizes';
import { statistics } from '../../src/webview/structure/statistics';
import { ModelUsage } from '../../src/webview/structure/usage';

const english: Translate = (message, ...args) =>
  message.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)]));
const strings = viewerStrings(english);

const model = new GltfModel({
  asset: { version: '2.0', generator: 'Tests' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: 'Arm' }],
  meshes: [
    { name: 'Arm | left *bold*', primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] },
  ],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 2, 3] },
    { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
  ],
  bufferViews: [
    { buffer: 0, byteLength: 36 },
    { buffer: 0, byteOffset: 36, byteLength: 6 },
  ],
  buffers: [{ byteLength: 44 }],
});
const file = {
  name: 'robot.glb',
  size: 1000,
  container: 'glb' as const,
  chunks: { json: 900, bin: 44 },
};
const validation: ValidationReport = {
  validator: '2.0.0',
  counts: { error: 1, warning: 0, info: 0, hint: 0 },
  issues: [
    {
      code: 'ACCESSOR_MIN_MISMATCH',
      message: 'Declared minimum | wrong.',
      severity: 'error',
      pointer: '/accessors/0/min',
    },
  ],
  truncated: false,
};

function report(withValidation = true) {
  const format = new Formatter('en');
  return buildReport({
    context: { model, strings: strings.structure, format, file },
    strings,
    statistics: statistics(model),
    size: sizeAnalysis(model, new ModelUsage(model), {
      fileName: file.name,
      fileSize: file.size,
      chunks: file.chunks,
    }),
    validation: withValidation ? validation : undefined,
  });
}

describe('buildReport', () => {
  it('writes the panels out in Markdown', () => {
    const { markdown } = report();
    expect(markdown.startsWith('# robot.glb\n\n_A report by Nightmesh._\n\n## Model\n')).toBe(true);
    expect(markdown).toContain('- generator: Tests\n');
    expect(markdown).toContain('### File\n\n- Container: GLB\n');
    expect(markdown).toContain('## Statistics\n');
    expect(markdown).toContain('- Triangles: 1\n');
    // Names from the file can't break a table or turn into formatting.
    expect(markdown).toContain('| Arm \\| left \\*bold\\* | 1 | 1 | 1 |\n');
    expect(markdown).toContain('## Size\n\n**1,000 B in one file**\n');
    expect(markdown).toContain('| JSON | 900 B | 90% |\n');
    expect(markdown).toContain('- Errors: 1\n');
    expect(markdown).toContain(
      '| Error | `ACCESSOR_MIN_MISMATCH` | Declared minimum \\| wrong. | `/accessors/0/min` |\n',
    );
  });

  it('says when the model was not validated yet', () => {
    expect(report(false).markdown).toContain(
      '## Validation\n\nThe model had not been validated yet when this report was saved.\n',
    );
  });

  it('writes the numbers as they are in JSON', () => {
    const json = JSON.parse(report().json);
    expect(json.file).toEqual({
      name: 'robot.glb',
      bytes: 1000,
      container: 'glb',
      chunks: { json: 900, bin: 44 },
    });
    expect(json.asset).toEqual({ version: '2.0', generator: 'Tests' });
    expect(json.statistics).toMatchObject({ nodes: 1, triangles: 1, vertices: 3 });
    expect(json.statistics.meshes[0]).toMatchObject({ mesh: 0, name: 'Arm | left *bold*' });
    expect(json.size.total).toBe(1000);
    expect(json.size.largest[0]).toEqual({ key: 'mesh:0', bytes: 42, name: 'Arm | left *bold*' });
    expect(json.validation).toEqual(validation);
    expect(JSON.parse(report(false).json).validation).toBeNull();
  });
});
