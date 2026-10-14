// Runs inside a real VS Code instance (see scripts/smoke.mjs).
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as vscode from 'vscode';

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
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Opens a file the way a click in the Explorer does and returns the custom editor tab's input. */
async function openInEditor(name: string): Promise<vscode.TabInputCustom> {
  await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path.join(FIXTURES, name)));
  return waitFor(() => {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    return tab?.input instanceof vscode.TabInputCustom && tab.input.uri.path.endsWith(`/${name}`)
      ? tab.input
      : undefined;
  });
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
