import * as vscode from 'vscode';
import type { ViewerStrings } from '../shared/protocol';

export function viewerStrings(): ViewerStrings {
  return {
    errorTitle: vscode.l10n.t("This model can't be displayed"),
    errorWebGL: vscode.l10n.t(
      "WebGL 2 isn't available, so the model can't be drawn. Check that hardware acceleration isn't turned off in VS Code.",
    ),
    errorContextLost: vscode.l10n.t(
      'The graphics device stopped responding. The model will be drawn again when it recovers.',
    ),
  };
}
