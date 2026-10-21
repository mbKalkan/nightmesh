/** What VS Code puts between the two names in the tab of a side-by-side comparison. */
export const DIFF_LABEL_SEPARATOR = ' ↔ ';

export interface DiffCandidate {
  /** File name, as VS Code shows it in the tab label. */
  name: string;
  /** URI scheme: `file` for a file on disk, `git` for a version from Git, and so on. */
  scheme: string;
  /** For `git` URIs, the version: `HEAD` or a commit, or `` / `~` for the staged one. */
  gitRef?: string;
}

/** How new a version is: the file on disk, then what's staged in Git, then a commit. */
function recency({ scheme, gitRef }: DiffCandidate): number {
  if (scheme === 'file') return 3;
  if (scheme === 'git') return gitRef === '' || gitRef === '~' ? 2 : 1;
  return 0;
}

/**
 * Tells the original (left) side of a comparison from the modified (right) one. VS Code
 * doesn't say, and doesn't create the two viewers in a fixed order. The tab label names the
 * left file first; when both names are the same, as when Git compares a file with an older
 * version of itself, the newer version is the modified side: the file on disk is newer than
 * what's staged, which is newer than the last commit.
 */
export function orderSides<T>(
  first: T,
  second: T,
  describe: (candidate: T) => DiffCandidate,
  label: string,
): [original: T, modified: T] {
  const a = describe(first);
  const b = describe(second);
  const [left, right] = label.split(DIFF_LABEL_SEPARATOR);
  if (left !== right) {
    if (a.name === right && b.name === left) return [second, first];
    if (a.name === left && b.name === right) return [first, second];
  }
  return recency(a) > recency(b) ? [second, first] : [first, second];
}
