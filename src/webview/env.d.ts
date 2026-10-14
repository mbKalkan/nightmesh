// Stylesheets are bundled by esbuild.
declare module '*.css';

// Files embedded by scripts/build.mjs, for the decoders.
declare module 'inline-text:*' {
  const text: string;
  export default text;
}

declare module 'inline-binary:*' {
  const bytes: Uint8Array;
  export default bytes;
}
