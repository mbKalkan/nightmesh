// Bundles the extension host (Node, CommonJS) and the webview (browser, ESM with lazy chunks).
import { readFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename } from 'node:path';
import * as esbuild from 'esbuild';
import { embindWithoutEval } from './embindWithoutEval.mjs';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const require = createRequire(import.meta.url);

/** @type {import('esbuild').BuildOptions} */
const shared = {
  bundle: true,
  minify: production,
  sourcemap: production ? false : 'linked',
  logLevel: 'info',
  legalComments: 'linked',
};

/** @type {import('esbuild').BuildOptions} */
const extension = {
  ...shared,
  entryPoints: ['src/extension/extension.ts'],
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
};

/** The glTF Validator runs in a worker thread of the extension host, from a file of its own. */
/** @type {import('esbuild').BuildOptions} */
const validator = {
  ...extension,
  entryPoints: ['src/extension/validatorWorker.ts'],
  outfile: 'dist/validator.js',
};

/** OBJ, STL and PLY files are read in a worker thread of the extension host too. */
/** @type {import('esbuild').BuildOptions} */
const mesh = {
  ...extension,
  entryPoints: ['src/extension/meshWorker.ts'],
  outfile: 'dist/mesh.js',
};

/** Changes made to embedded text files on the way in, by file name. */
const PATCHES = { 'basis_transcoder.js': embindWithoutEval };

/**
 * The webview can't fetch the extension's own files (its CSP allows only blob: URLs), so the
 * mesh and texture decoders (WebAssembly and its JavaScript glue) are embedded in the chunk
 * that uses them. Import as `inline-text:<package path>` or `inline-binary:<package path>`.
 * @type {import('esbuild').Plugin}
 */
const inlineFiles = {
  name: 'inline-files',
  setup(build) {
    build.onResolve({ filter: /^inline-(text|binary):/ }, (args) => {
      const [, kind, specifier] = /^inline-(text|binary):(.*)$/.exec(args.path);
      return { path: require.resolve(specifier), namespace: `inline-${kind}` };
    });
    build.onLoad({ filter: /.*/, namespace: 'inline-text' }, async (args) => {
      const contents = await readFile(args.path, 'utf8');
      const patch = PATCHES[basename(args.path)];
      return { contents: patch ? patch(contents) : contents, loader: 'text' };
    });
    build.onLoad({ filter: /.*/, namespace: 'inline-binary' }, async (args) => ({
      contents: await readFile(args.path),
      loader: 'binary',
    }));
  },
};

/** @type {import('esbuild').BuildOptions} */
const webview = {
  ...shared,
  entryPoints: ['src/webview/main.ts'],
  outdir: 'dist/webview',
  platform: 'browser',
  format: 'esm',
  splitting: true,
  target: 'chrome120',
  chunkNames: 'chunks/[name]-[hash]',
  plugins: [inlineFiles],
};

if (watch) {
  const contexts = await Promise.all(
    [extension, validator, mesh, webview].map((options) => esbuild.context(options)),
  );
  await Promise.all(contexts.map((ctx) => ctx.watch()));
} else {
  rmSync('dist', { recursive: true, force: true });
  await Promise.all([extension, validator, mesh, webview].map((options) => esbuild.build(options)));
}
