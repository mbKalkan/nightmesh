// Files embedded by scripts/build.mjs (and by vitest.config.mjs in the tests), for the decoders.
declare module 'inline-text:*' {
  const text: string;
  export default text;
}

declare module 'inline-binary:*' {
  const bytes: Uint8Array;
  export default bytes;
}
