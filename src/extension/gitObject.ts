/**
 * The `git show` argument for a version that VS Code's Git extension names by `ref`: empty or
 * `~` for the staged version (the index, which matches HEAD when nothing is staged), `~1` to
 * `~3` for the sides of a merge conflict, or a commit. Undefined for a ref that git would take
 * for an option.
 */
export function gitObject(ref: string, relativePath: string): string | undefined {
  if (ref.startsWith('-')) return undefined;
  if (ref === '' || ref === '~') return `:${relativePath}`;
  const stage = /^~(\d)$/.exec(ref);
  return stage ? `:${stage[1]}:${relativePath}` : `${ref}:${relativePath}`;
}

const LFS_POINTER =
  /^version https:\/\/git-lfs\.github\.com\/spec\/v1\noid sha256:([0-9a-f]{64})\n/;

/** The object id when `blob` is a Git LFS pointer rather than the file itself. */
export function lfsObjectId(blob: Uint8Array): string | undefined {
  // Pointers are small text files; anything big is the file itself.
  if (blob.length > 1024) return undefined;
  return LFS_POINTER.exec(new TextDecoder().decode(blob))?.[1];
}
