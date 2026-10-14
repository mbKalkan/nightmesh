import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { gitObject, lfsObjectId } from './gitObject';

/** The part of the Git extension's API used here. */
interface GitApi {
  git: { path: string };
  getRepository(uri: vscode.Uri): { rootUri: vscode.Uri } | null;
}

interface GitExtension {
  getAPI(version: 1): GitApi;
}

/** Models can be large; this only stops a runaway read. */
const MAX_BYTES = 2 * 1024 ** 3;

/**
 * Reads a version of a file from Git as it was committed. VS Code's Git extension reads
 * versions with `git show --textconv`, so where a text conversion is set up for a file type it
 * hands over text instead of the file; and for files in Git LFS it hands over the pointer.
 * Returns undefined when the version can't be read this way.
 */
export async function readGitBlob(uri: vscode.Uri): Promise<Uint8Array | undefined> {
  const query = gitQuery(uri);
  if (!query) return undefined;

  const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!extension) return undefined;
  const api = (extension.isActive ? extension.exports : await extension.activate()).getAPI(1);
  const file = vscode.Uri.file(query.path);
  const root = api.getRepository(file)?.rootUri.fsPath;
  if (!root) return undefined;
  const object = gitObject(query.ref, path.relative(root, file.fsPath).split(path.sep).join('/'));
  if (!object) return undefined;

  const blob = await git(api.git.path, root, ['show', object]);
  const oid = blob && lfsObjectId(blob);
  return oid ? ((await readLfsObject(api.git.path, root, oid)) ?? blob) : blob;
}

/**
 * The URI of the same version of another file: a `.bin` or texture next to a `.gltf`. The Git
 * extension reads the file the query names, so the query changes along with the path.
 */
export function gitSibling(uri: vscode.Uri, filePath: string): vscode.Uri {
  const query = gitQuery(uri);
  if (!query) return uri.with({ path: filePath });
  const file = vscode.Uri.file(vscode.Uri.from({ scheme: 'file', path: filePath }).fsPath);
  return uri.with({ path: filePath, query: JSON.stringify({ ...query, path: file.fsPath }) });
}

function gitQuery(uri: vscode.Uri): { path: string; ref: string } | undefined {
  try {
    const query = JSON.parse(uri.query) as { path?: unknown; ref?: unknown };
    return typeof query.path === 'string' && typeof query.ref === 'string'
      ? (query as { path: string; ref: string })
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads a Git LFS object from the local store, where checked-out versions are. Older ones
 * may only be on the server; those aren't downloaded, as Nightmesh doesn't use the network.
 */
async function readLfsObject(
  gitPath: string,
  root: string,
  oid: string,
): Promise<Uint8Array | undefined> {
  const gitDir = await git(gitPath, root, ['rev-parse', '--git-common-dir']);
  if (!gitDir) return undefined;
  const store = path.resolve(root, new TextDecoder().decode(gitDir).trim(), 'lfs', 'objects');
  try {
    return await readFile(path.join(store, oid.slice(0, 2), oid.slice(2, 4), oid));
  } catch {
    return undefined;
  }
}

function git(gitPath: string, cwd: string, args: string[]): Promise<Uint8Array | undefined> {
  return new Promise((resolve) => {
    execFile(
      gitPath,
      args,
      { cwd, encoding: 'buffer', maxBuffer: MAX_BYTES, windowsHide: true },
      (error, stdout) => resolve(error ? undefined : new Uint8Array(stdout)),
    );
  });
}
