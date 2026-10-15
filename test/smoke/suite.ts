// Runs inside a real VS Code instance (see scripts/smoke.mjs).
import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { gitSibling, readGitBlob } from '../../src/extension/gitBlob';

const EXTENSION_ID = 'MBKDevStudio.nightmesh';
const VIEW_TYPE = 'nightmesh.viewer';
const FIXTURES = path.resolve(__dirname, '../../test/fixtures');

async function waitFor<T>(probe: () => T | undefined, timeoutMs = 30_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = probe();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for condition. ${describeEditors()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** What the workbench shows, for the message of a failed wait. */
function describeEditors(): string {
  const tabs = vscode.window.tabGroups.all.flatMap((group) =>
    group.tabs.map((tab) => {
      const input = tab.input as { uri?: vscode.Uri; viewType?: string } | undefined;
      const kind = input?.constructor?.name ?? typeof input;
      const uri = input?.uri?.toString() ?? '';
      return `${tab.isActive ? '*' : ''}${tab.label} [${kind}${input?.viewType ? ` ${input.viewType}` : ''}] ${uri}`;
    }),
  );
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  return `Tabs: ${tabs.length ? tabs.join('; ') : 'none'}. Text editors: ${
    vscode.window.visibleTextEditors.map((e) => e.document.uri.toString()).join(', ') || 'none'
  }. Extension ${extension ? (extension.isActive ? 'active' : 'inactive') : 'missing'}.`;
}

/** Opens a file the way a click in the Explorer does and returns the custom editor tab's input. */
async function openInEditor(name: string): Promise<vscode.TabInputCustom> {
  const uri = vscode.Uri.file(path.join(FIXTURES, name));
  await vscode.commands.executeCommand('vscode.open', uri);
  let tries = 0;
  return waitFor(() => {
    // Opened while the window is still starting, a file can get the binary file editor before
    // the extension's editor is known; opened again a moment later, it gets the viewer.
    const open = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (++tries % 50 === 0 && open && !(open.input instanceof vscode.TabInputCustom)) {
      void Promise.resolve(vscode.window.tabGroups.close(open)).then(() =>
        vscode.commands.executeCommand('vscode.open', uri),
      );
    }
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    return tab?.input instanceof vscode.TabInputCustom && tab.input.uri.path.endsWith(`/${name}`)
      ? tab.input
      : undefined;
  });
}

interface Repository {
  git(...args: string[]): Buffer;
  /** Writes a file in the repository and returns its path. */
  write(name: string, content: string | Buffer): string;
  /** Writes a file as Git LFS keeps it: a pointer in the repository, the bytes in its store. */
  writeLfs(name: string, bytes: Buffer): void;
}

/**
 * Commits what `setup` writes into a new repository, then runs `check` with the URI VS Code's
 * Git extension uses for the committed version of a file in it.
 */
async function withRepository(
  setup: (repository: Repository) => Promise<void>,
  check: (head: (name: string) => vscode.Uri) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), 'nightmesh-git-'));
  try {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root });
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    const write = (name: string, content: string | Buffer) => {
      writeFileSync(path.join(root, name), content);
      return path.join(root, name);
    };
    const writeLfs = (name: string, bytes: Buffer) => {
      const oid = createHash('sha256').update(bytes).digest('hex');
      write(
        name,
        `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${bytes.length}\n`,
      );
      const store = path.join(root, '.git', 'lfs', 'objects', oid.slice(0, 2), oid.slice(2, 4));
      mkdirSync(store, { recursive: true });
      writeFileSync(path.join(store, oid), bytes);
    };
    await setup({ git, write, writeLfs });
    git('add', '.');
    git('commit', '-q', '-m', 'Add a model');

    const api = (await vscode.extensions.getExtension('vscode.git')!.activate()).getAPI(1);
    await api.openRepository(vscode.Uri.file(root));
    await check((name) => api.toGitUri(vscode.Uri.file(path.join(root, name)), 'HEAD'));
  } finally {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // The Git extension keeps watching the repository; the temp folder can stay.
    }
  }
}

const isGlb = (bytes: Uint8Array | undefined) =>
  Buffer.from(bytes ?? [])
    .subarray(0, 4)
    .toString() === 'glTF';

/** VS Code's own read gets something else; Nightmesh's gets the model. */
async function assertReadsModel(head: vscode.Uri): Promise<void> {
  assert.equal(isGlb(await vscode.workspace.fs.readFile(head)), false);
  assert.equal(isGlb(await readGitBlob(head)), true);
}

const tests: Record<string, () => Promise<void>> = {
  async 'opens .glb files in the viewer by default'() {
    const input = await openInEditor('triangle.glb');
    assert.equal(input.viewType, VIEW_TYPE);
    assert.ok(vscode.extensions.getExtension(EXTENSION_ID)?.isActive);
  },

  async 'opens .gltf files in the viewer by default'() {
    const input = await openInEditor('triangle.gltf');
    assert.equal(input.viewType, VIEW_TYPE);
  },

  async 'copies a reference to the model, with what the inspector says'() {
    await openInEditor('scene.glb');
    const saved = await vscode.env.clipboard.readText();
    try {
      await vscode.env.clipboard.writeText('');
      let copied = '';
      // Until the model's structure has arrived, the viewer can only name the file.
      for (const start = Date.now(); !copied.includes('\n') && Date.now() - start < 30_000;) {
        await vscode.commands.executeCommand('nightmesh.copyReferenceWithDetails');
        await new Promise((resolve) => setTimeout(resolve, 500));
        copied = await vscode.env.clipboard.readText();
      }
      assert.match(copied, /scene\.glb:\nModel\n- version: 2\.0\n/);
    } finally {
      await vscode.env.clipboard.writeText(saved);
    }
  },

  async 'validates a model in the background, with its resources'() {
    await openInEditor('missing-resource.gltf');
    const saved = await vscode.env.clipboard.readText();
    try {
      let copied = '';
      // The validator runs in a worker thread once the model has loaded.
      for (
        const start = Date.now();
        !copied.includes('Validation') && Date.now() - start < 30_000;
      ) {
        await vscode.env.clipboard.writeText('');
        await vscode.commands.executeCommand('nightmesh.copyReferenceWithDetails');
        await new Promise((resolve) => setTimeout(resolve, 500));
        copied = await vscode.env.clipboard.readText();
      }
      assert.match(copied, /\n- Validation: Errors: 1, warnings: 0\n/);
    } finally {
      await vscode.env.clipboard.writeText(saved);
    }
  },

  async 'shows the glTF JSON of a GLB beside the viewer'() {
    await openInEditor('scene.glb');
    const editor = await waitFor(() => {
      void vscode.commands.executeCommand('nightmesh.showJson');
      return vscode.window.visibleTextEditors.find(
        (each) => each.document.uri.scheme === 'nightmesh-json',
      );
    });
    const { document } = editor;
    assert.equal(document.languageId, 'json');
    assert.match(document.uri.path, /\/scene\.glb\.json$/);
    const bytes = readFileSync(path.join(FIXTURES, 'scene.glb'));
    const json = bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8');
    assert.deepEqual(JSON.parse(document.getText()), JSON.parse(json));
    assert.equal(document.lineAt(1).text, '  "asset": {');
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  },

  async 'reads models from Git even where git converts them to text'() {
    // VS Code reads versions with `git show --textconv`; a conversion set up for *.glb turned
    // the model into text.
    await withRepository(
      async ({ git, write }) => {
        git('config', 'diff.astextplain.textconv', 'echo converted');
        write('.gitattributes', '*.glb diff=astextplain\n');
        copyFileSync(path.join(FIXTURES, 'triangle.glb'), write('robot.glb', ''));
      },
      (head) => assertReadsModel(head('robot.glb')),
    );
  },

  async 'reads models kept in Git LFS, and the files next to them'() {
    await withRepository(
      async ({ write, writeLfs }) => {
        writeLfs('robot.glb', readFileSync(path.join(FIXTURES, 'triangle.glb')));
        write('robot.gltf', readFileSync(path.join(FIXTURES, 'triangle.gltf')));
        writeLfs('triangle.bin', readFileSync(path.join(FIXTURES, 'triangle.bin')));
      },
      async (head) => {
        await assertReadsModel(head('robot.glb'));
        // The .bin of a .gltf, at the same version, from the store too.
        const bin = gitSibling(head('robot.gltf'), head('triangle.bin').path);
        const bytes = readFileSync(path.join(FIXTURES, 'triangle.bin'));
        assert.notDeepEqual(Buffer.from(await vscode.workspace.fs.readFile(bin)), bytes);
        assert.deepEqual(Buffer.from((await readGitBlob(bin)) ?? []), bytes);

        // And the viewer shows that version: its structure comes into a copied reference.
        await vscode.commands.executeCommand('vscode.openWith', head('robot.glb'), VIEW_TYPE);
        const saved = await vscode.env.clipboard.readText();
        try {
          await vscode.env.clipboard.writeText('');
          let copied = '';
          for (const start = Date.now(); !copied.includes('\n') && Date.now() - start < 30_000;) {
            await vscode.commands.executeCommand('nightmesh.copyReferenceWithDetails');
            await new Promise((resolve) => setTimeout(resolve, 500));
            copied = await vscode.env.clipboard.readText();
          }
          assert.match(copied, /^robot\.glb:\nModel\n/);
          assert.match(copied, /\n- Container: GLB\n/);
        } finally {
          await vscode.env.clipboard.writeText(saved);
        }
      },
    );
  },

  async 'keeps .gltf files JSON when opened as text'() {
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.file(path.join(FIXTURES, 'triangle.gltf')),
    );
    assert.equal(document.languageId, 'json');
  },
};

export async function run(): Promise<void> {
  const failures: string[] = [];
  for (const [name, test] of Object.entries(tests)) {
    try {
      await test();
      console.log(`  ✓ ${name}`);
    } catch (error) {
      console.log(`  ✗ ${name}`);
      failures.push(`${name}: ${error instanceof Error ? error.stack : String(error)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`${failures.length} smoke test(s) failed:\n${failures.join('\n')}`);
  }
}
