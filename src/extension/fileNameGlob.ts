/**
 * Glob that matches a single file name. Glob metacharacters are replaced with `?`
 * (any single character); callers filter events by exact URI afterwards.
 */
export function fileNameGlob(fileName: string): string {
  return fileName.replace(/[*?[\]{}!]/g, '?');
}
