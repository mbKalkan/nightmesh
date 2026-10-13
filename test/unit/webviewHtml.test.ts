import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy, buildWebviewHtml } from '../../src/extension/webviewHtml';

const source = 'https://file+.vscode-resource.vscode-cdn.net';

describe('buildContentSecurityPolicy', () => {
  const csp = buildContentSecurityPolicy(source, 'abc123');
  const directive = (name: string) =>
    csp
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name} `));

  it('denies everything not explicitly allowed', () => {
    expect(csp).toContain("default-src 'none'");
  });

  it('allows scripts only with the nonce or from the extension', () => {
    expect(directive('script-src')).toBe(`script-src 'nonce-abc123' ${source} 'wasm-unsafe-eval'`);
  });

  it('lets WebAssembly decoders compile without allowing eval or inline code', () => {
    expect(csp).toContain("'wasm-unsafe-eval'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain("'unsafe-inline'");
  });

  it('starts workers only from blob: URLs', () => {
    expect(directive('worker-src')).toBe('worker-src blob:');
  });

  it('connects only to blob: URLs, which hold bytes already in the webview', () => {
    expect(directive('connect-src')).toBe('connect-src blob:');
  });

  it('does not allow network or frame access', () => {
    expect(csp).not.toMatch(/frame-src|child-src/);
    // No scheme-wide sources such as a bare `https:` or `*`.
    expect(csp).not.toMatch(/(^|\s)(https?:|\*)(\s|;|$)/);
  });
});

describe('buildWebviewHtml', () => {
  it('tags the entry script with the nonce', () => {
    const html = buildWebviewHtml({
      cspSource: source,
      scriptUri: `${source}/main.js`,
      styleUri: `${source}/main.css`,
      lang: 'tr',
      nonce: 'xyz',
    });
    expect(html).toContain(`<script type="module" nonce="xyz" src="${source}/main.js">`);
    expect(html).toContain('<html lang="tr">');
    expect(html).toContain("'nonce-xyz'");
  });

  it('generates a fresh nonce when none is given', () => {
    const options = { cspSource: source, scriptUri: 's', styleUri: 'c', lang: 'en' };
    const nonceOf = (html: string) => /nonce="([^"]+)"/.exec(html)?.[1];
    expect(nonceOf(buildWebviewHtml(options))).not.toBe(nonceOf(buildWebviewHtml(options)));
  });
});
