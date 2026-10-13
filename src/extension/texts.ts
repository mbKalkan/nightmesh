// User-facing text. Every message goes through `t`: VS Code's `l10n.t` in the extension, a
// plain formatter in the browser tests, so both show the same words.
import type { ViewerStrings } from '../shared/protocol';
import type { LoadTexts, ResourceProblem } from './model/load';

export type Translate = (message: string, ...args: Array<string | number>) => string;

export function viewerStrings(t: Translate): ViewerStrings {
  return {
    loading: t('Loading…'),
    errorTitle: t("This model can't be displayed"),
    errorWebGL: t(
      "WebGL 2 isn't available, so the model can't be drawn. Check that hardware acceleration isn't turned off in VS Code.",
    ),
    errorContextLost: t(
      'The graphics device stopped responding. The model will be drawn again when it recovers.',
    ),
    errorRender: t('Something went wrong while drawing this model.'),
    partialTitle: t("Part of this model couldn't be loaded"),
    close: t('Close'),
  };
}

export function loadTexts(t: Translate): LoadTexts {
  const resource: Record<ResourceProblem, (name: string) => string> = {
    missing: (name) => t("{0} wasn't found next to the model.", name),
    network: (name) => t("{0} wasn't loaded: Nightmesh doesn't use the network.", name),
    absolute: (name) =>
      t("{0} wasn't loaded: only paths relative to the model are followed.", name),
    outside: (name) =>
      t("{0} wasn't loaded: it is outside the model's folder and workspace.", name),
    invalid: (name) => t("{0} isn't a valid file reference.", name),
    unreadable: (name) => t("{0} couldn't be read.", name),
  };
  return {
    empty: t('The file is empty.'),
    damaged: t("The file isn't a glTF model, or it is damaged."),
    lfsPointer: t(
      "This file is a Git LFS pointer: the model itself hasn't been downloaded to this machine. Run git lfs pull to get it.",
    ),
    version: (version) => t('This model is glTF {0}. Nightmesh opens glTF 2.0 models.', version),
    extensions: (names) => t("This model needs {0}, which Nightmesh can't draw yet.", names),
    nothingDrawn: t("None of this model's geometry could be loaded."),
    resource: (problem, name) => resource[problem](name),
    truncated: t('The file ends early, as if it was cut off while being copied or saved.'),
    dropped: (kind, count) =>
      kind === 'primitives'
        ? t('Primitives left out: {0}', count)
        : kind === 'textures'
          ? t('Textures left out: {0}', count)
          : t('Animations left out: {0}', count),
  };
}
