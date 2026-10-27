import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as esbuild from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileResourceOpener } from '../../src/extension/model/fileResources';
import { fileSource, type ByteSource } from '../../src/extension/model/sources';
import { gltfSource } from '../../src/extension/model/tileGltf';
import {
  MAX_VALIDATION_BYTES,
  validationMessage,
  validationReport,
  type Validator,
} from '../../src/extension/model/validation';
import { runValidator } from '../../src/extension/model/validator';
import { loadTexts, type Translate } from '../../src/extension/texts';
import { workerValidator } from '../../src/extension/workerValidator';
import type { ValidationReport } from '../../src/shared/protocol';

const FIXTURES = resolve('test/fixtures');
const english: Translate = (message, ...args) =>
  message.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)]));

/** Validates a fixture as the extension host does, with the fixtures folder as the workspace. */
async function validate(name: string, validator: Validator = runValidator) {
  const source = await fileSource(join(FIXTURES, name));
  const opener = fileResourceOpener('/fixtures', '/fixtures', (path) =>
    join(FIXTURES, path.slice('/fixtures'.length)),
  );
  try {
    return await validationMessage(source, opener, validator, 7, loadTexts(english));
  } finally {
    await source.close();
  }
}

async function report(name: string, validator?: Validator): Promise<ValidationReport> {
  const message = await validate(name, validator);
  if (message.type !== 'validation' || message.state !== 'done') {
    throw new Error(`${name}: ${JSON.stringify(message)}`);
  }
  return message.report;
}

describe('validationReport', () => {
  it('lists errors first and tidies what the validator wraps', () => {
    const tidy = validationReport({
      validatorVersion: '2.0.0',
      issues: {
        messages: [
          {
            code: 'UNUSED_OBJECT',
            message: 'This object may be unused.',
            severity: 2,
            pointer: '/accessors/3',
          },
          {
            code: 'IO_ERROR',
            message: 'Node Exception: a.bin was not found.',
            severity: 0,
            pointer: '/buffers/0/uri',
          },
          { code: 'GLB_CHUNK', message: 'Unexpected end.', severity: 0, offset: 20 },
          { code: 'ODD', message: 'No such severity', severity: 7 },
        ],
        truncated: true,
      },
    });
    expect(tidy).toEqual({
      validator: '2.0.0',
      counts: { error: 2, warning: 0, info: 1, hint: 0 },
      issues: [
        {
          code: 'IO_ERROR',
          message: 'a.bin was not found.',
          severity: 'error',
          pointer: '/buffers/0/uri',
        },
        { code: 'GLB_CHUNK', message: 'Unexpected end.', severity: 'error', offset: 20 },
        {
          code: 'UNUSED_OBJECT',
          message: 'This object may be unused.',
          severity: 'info',
          pointer: '/accessors/3',
        },
      ],
      truncated: true,
    });
  });

  it('reads a report with nothing in it', () => {
    expect(validationReport({})).toEqual({
      validator: '',
      counts: { error: 0, warning: 0, info: 0, hint: 0 },
      issues: [],
      truncated: false,
    });
  });
});

describe('validationMessage', () => {
  it('validates a model with its resources', async () => {
    const clean = await report('textured.gltf');
    expect(clean.validator).toMatch(/^2\./);
    expect(clean.issues).toEqual([]);
  });

  it('says why a resource could not be read, as the viewer does', async () => {
    const { issues } = await report('missing-resource.gltf');
    expect(issues).toContainEqual({
      code: 'IO_ERROR',
      message: "missing.bin wasn't found next to the model.",
      severity: 'error',
      pointer: '/buffers/0/uri',
    });
    const outside = await report('outside-folder.gltf');
    expect(outside.issues.map((issue) => issue.message)).toContain(
      "triangle.bin wasn't loaded: it is outside the model's folder and workspace.",
    );
  });

  it('points into a GLB by byte offset', async () => {
    const { issues, counts } = await report('truncated.glb');
    expect(counts.error).toBe(1);
    expect(issues[0]).toMatchObject({
      code: 'GLB_UNEXPECTED_END_OF_CHUNK_DATA',
      offset: expect.any(Number),
    });
  });

  for (const [name, format] of [
    ['batched.b3dm', 'b3dm'],
    ['instanced.i3dm', 'i3dm'],
  ] as const) {
    it(`validates the GLB inside a ${format} tile, as the viewer does`, async () => {
      const source = await fileSource(join(FIXTURES, 'tiles', name));
      try {
        const message = await validationMessage(
          await gltfSource(source, format),
          async () => 'missing',
          runValidator,
          7,
          loadTexts(english),
        );
        expect(message).toMatchObject({ state: 'done', report: { counts: { error: 0 } } });
      } finally {
        await source.close();
      }
    });
  }

  it('leaves out a model too large to hold', async () => {
    const huge: ByteSource = {
      size: MAX_VALIDATION_BYTES + 1,
      read: () => Promise.reject(new Error('not read')),
      close: async () => {},
    };
    const opener = () => Promise.resolve('missing' as const);
    expect(await validationMessage(huge, opener, runValidator, 3, loadTexts(english))).toEqual({
      type: 'validation',
      loadId: 3,
      state: 'tooLarge',
      bytes: MAX_VALIDATION_BYTES + 1,
    });
  });

  it('says so when the validator fails', async () => {
    const broken: Validator = () => Promise.reject(new Error('broken'));
    expect(await validate('scene.glb', broken)).toEqual({
      type: 'validation',
      loadId: 7,
      state: 'failed',
    });
  });
});

describe('workerValidator', () => {
  let folder: string;
  let script: string;

  // The worker runs from the bundle, as in the extension.
  beforeAll(async () => {
    folder = mkdtempSync(join(tmpdir(), 'nightmesh-validator-'));
    script = join(folder, 'validator.js');
    await esbuild.build({
      entryPoints: ['src/extension/validatorWorker.ts'],
      outfile: script,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      logLevel: 'silent',
    });
  });
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  it('validates in a thread of its own, reading resources through the extension', async () => {
    const worker = workerValidator(script);
    expect(await report('textured.gltf', worker.validate)).toEqual(await report('textured.gltf'));
    const missing = await report('missing-resource.gltf', worker.validate);
    expect(missing.issues[0].message).toBe("missing.bin wasn't found next to the model.");
  });

  it('stops a validation when asked', async () => {
    const worker = workerValidator(script);
    // Stopped while it waits for the model's .bin.
    const stopping: Validator = (data, resource) =>
      worker.validate(data, (uri) => {
        worker.stop();
        return resource(uri);
      });
    expect(await validate('textured.gltf', stopping)).toEqual({
      type: 'validation',
      loadId: 7,
      state: 'failed',
    });
  });
});
