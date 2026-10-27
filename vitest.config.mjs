import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);

/** `inline-text:` and `inline-binary:` imports, embedded as scripts/build.mjs embeds them. */
const inlineFiles = {
  name: 'inline-files',
  enforce: 'pre',
  resolveId: (id) => (/^inline-(text|binary):/.test(id) ? `\0${id}` : undefined),
  load(id) {
    const match = /^\0inline-(text|binary):(.*)$/.exec(id);
    if (!match) return undefined;
    const bytes = readFileSync(require.resolve(match[2]));
    return match[1] === 'text'
      ? `export default ${JSON.stringify(bytes.toString('utf8'))};`
      : `export default new Uint8Array(Buffer.from(${JSON.stringify(bytes.toString('base64'))}, 'base64'));`;
  },
};

export default defineConfig({
  plugins: [inlineFiles],
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
  },
});
