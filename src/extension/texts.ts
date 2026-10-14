// User-facing text. Every message goes through `t`: VS Code's `l10n.t` in the extension, a
// plain formatter in the browser tests, so both show the same words.
import type { StructureStrings, ViewerStrings } from '../shared/protocol';
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
    frame: t('Frame Selection (F)'),
    modelSize: t('Size of the model in metres: width (X), height (Y) and depth (Z)'),
    selectionSize: t('Size of the selection in metres: width (X), height (Y) and depth (Z)'),
    structure: structureStrings(t),
    animation: {
      bar: t('Animation playback'),
      clip: t('Animation'),
      play: t('Play (Space)'),
      pause: t('Pause (Space)'),
      time: t('Time'),
      speed: t('Speed'),
      motion: { holds: t('Holds one pose'), none: t('Moves nothing') },
    },
    view: {
      menu: t('View'),
      views: {
        front: t('Front'),
        back: t('Back'),
        right: t('Right'),
        left: t('Left'),
        top: t('Top'),
        bottom: t('Bottom'),
      },
      projections: { perspective: t('Perspective'), orthographic: t('Orthographic') },
    },
  };
}

function structureStrings(t: Translate): StructureStrings {
  return {
    structure: t('Structure'),
    inspector: t('Inspector'),
    statistics: t('Statistics'),
    statisticsNote: t('For the scene shown, with each mesh counted every time it is drawn.'),
    structureWidth: t('Structure panel width'),
    inspectorWidth: t('Inspector panel width'),
    kinds: {
      model: t('Model'),
      scene: t('Scene'),
      node: t('Node'),
      mesh: t('Mesh'),
      primitive: t('Primitive'),
      material: t('Material'),
      texture: t('Texture'),
      image: t('Image'),
      sampler: t('Sampler'),
      animation: t('Animation'),
      skin: t('Skin'),
      camera: t('Camera'),
      light: t('Light'),
    },
    groups: {
      nodes: t('Nodes'),
      otherNodes: t('Nodes outside scenes'),
      meshes: t('Meshes'),
      materials: t('Materials'),
      textures: t('Textures'),
      animations: t('Animations'),
      skins: t('Skins'),
      cameras: t('Cameras'),
      lights: t('Lights'),
    },
    motion: {
      moves: t('Moves'),
      holds: t("Holds one pose: its keyframes don't change over time"),
      none: t("Moves nothing: every keyframe matches the model's rest pose"),
    },
    sections: {
      file: t('File'),
      contents: t('Contents'),
      transform: t('Transform'),
      extensions: t('Extensions'),
      extras: t('Extras'),
      usedBy: t('Used by'),
      channels: t('Channels'),
      joints: t('Joints'),
    },
    labels: {
      container: t('Container'),
      fileSize: t('File size'),
      jsonChunk: t('JSON chunk'),
      binaryChunk: t('Binary chunk'),
      children: t('Children'),
      nodes: t('Nodes'),
      primitives: t('Primitives'),
      vertices: t('Vertices'),
      triangles: t('Triangles'),
      lines: t('Lines'),
      points: t('Points'),
      rotationDegrees: t('Rotation (degrees)'),
      motion: t('Motion'),
      instances: t('Instances'),
      drawCalls: t('Draw calls'),
      dimensions: t('Dimensions'),
      total: t('Total'),
      mipLevels: t('Mip levels'),
      gpuMemory: t('GPU memory'),
      textureMemory: t('Texture memory'),
      noPreview: t('No preview: this texture stays compressed on the GPU.'),
      duration: t('Duration'),
      size: t('Size'),
      required: t('Required'),
      more: t('{0} more', '{0}'),
      under: t('under {0}', '{0}'),
    },
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
