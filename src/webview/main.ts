import './styles/viewer.css';
import type { HostToWebviewMessage, LoadMessage } from '../shared/protocol';
import { Shell } from './shell';
import { Viewport } from './viewport';
import { vscode } from './vscodeApi';

const shell = new Shell(document.getElementById('app') as HTMLElement);
let viewport: Viewport | undefined;

window.addEventListener('message', (event: MessageEvent<HostToWebviewMessage>) => {
  const message = event.data;
  switch (message.type) {
    case 'load':
      show(message);
      break;
  }
});

// VS Code swaps body classes and CSS variables when the color theme changes.
let themeTimer: ReturnType<typeof setTimeout> | undefined;
const themeObserver = new MutationObserver(() => {
  clearTimeout(themeTimer);
  themeTimer = setTimeout(() => viewport?.render(), 50);
});
themeObserver.observe(document.body, {
  attributes: true,
  attributeFilter: ['class', 'data-vscode-theme-kind'],
});
themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });

vscode.postMessage({ type: 'ready' });

function show(message: LoadMessage): void {
  const { strings } = message;
  shell.setDocument(message.fileName, message.format);
  if (viewport) {
    return;
  }
  viewport = Viewport.create(shell.viewport, {
    onContextLost: () => shell.showError(strings.errorTitle, strings.errorContextLost),
    onContextRestored: () => shell.hideError(),
  });
  if (!viewport) {
    shell.showError(strings.errorTitle, strings.errorWebGL);
  }
}
