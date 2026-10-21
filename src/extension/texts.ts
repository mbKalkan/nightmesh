// User-facing text. Every message goes through `t`: VS Code's `l10n.t` in the extension, a
// plain formatter in the browser tests, so both show the same words.
import type { StructureStrings, ViewerStrings } from '../shared/protocol';
import type { LoadTexts, ResourceProblem } from './model/load';

export type Translate = (message: string, ...args: Array<string | number>) => string;

export function viewerStrings(t: Translate): ViewerStrings {
  return {
    loading: t('Loading…'),
    loadingBytes: t('{0} of {1}', '{0}', '{1}'),
    preparing: t('Preparing to draw…'),
    largeTitle: t('This model is large'),
    largeMessage: t(
      'Drawing it means loading {0} into the view, which takes a while and a lot of memory. Its structure and statistics are ready in the panels.',
      '{0}',
    ),
    largeReadMessage: t(
      'Reading and drawing it means loading {0}, which takes a while and a lot of memory.',
      '{0}',
    ),
    draw: t('Draw Model'),
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
    showJson: t('Show glTF JSON'),
    viewKeys: t(
      'Arrow keys orbit, plus and minus zoom. 1, 3 and 7 look from the front, the right and the top, with Shift from the other side; 5 switches between perspective and orthographic. F frames the selection, Escape lets go of it, Space plays an animation. M measures the distance between two points clicked on the model.',
    ),
    modelSize: t('Size of the model: width (X), height (Y) and depth (Z)'),
    selectionSize: t('Size of the selection: width (X), height (Y) and depth (Z)'),
    measure: {
      button: t('Measure Distance (M)'),
      first: t('Click a point on the model'),
      second: t('Click a second point'),
      distance: t('Distance'),
    },
    structure: structureStrings(t),
    validation: {
      tab: t('Validation'),
      waiting: t('The model is validated once it has loaded.'),
      running: t('Validating…'),
      validator: t('Checked by the Khronos glTF Validator {0}.', '{0}'),
      tooLarge: t('This model is too large to validate here: {0}.', '{0}'),
      failed: t("The glTF Validator couldn't read this model."),
      noIssues: t('No issues found.'),
      truncated: t('The validator stopped after {0} issues; there are more.', '{0}'),
      offset: t('Byte {0}', '{0}'),
      severities: {
        error: t('Errors'),
        warning: t('Warnings'),
        info: t('Infos'),
        hint: t('Hints'),
      },
      severity: {
        error: t('Error'),
        warning: t('Warning'),
        info: t('Info'),
        hint: t('Hint'),
      },
      badge: t('Errors: {0}, warnings: {1}', '{0}', '{1}'),
      showInJson: t('Show in glTF JSON'),
    },
    size: {
      tab: t('Size'),
      totalOne: t('{0} in one file', '{0}'),
      totalMany: t('{0} in {1} files', '{0}', '{1}'),
      breakdown: t('Where the bytes go'),
      categories: {
        json: t('JSON'),
        vertices: t('Vertex data'),
        indices: t('Indices'),
        morphTargets: t('Morph targets'),
        animation: t('Animations'),
        skins: t('Skins'),
        instancing: t('Instancing'),
        textures: t('Textures'),
        unused: t('Unused data'),
        other: t('Headers and padding'),
      },
      compression: t('Compression'),
      geometry: t('Geometry'),
      draco: t('Draco: {0} of {1} primitives', '{0}', '{1}'),
      meshopt: t('meshopt: {0} of {1} buffer views', '{0}', '{1}'),
      quantized: t('Quantized'),
      none: t('None'),
      gpuMemory: t('Estimated GPU memory'),
      largest: t('Largest'),
      images: t('Images'),
      imageWarnings: {
        large: t("Larger than 4096 pixels: many mobile GPUs can't load it."),
        notPowerOfTwo: t(
          "Not a power of two wide and high: some GPUs can't repeat it or make its mipmaps.",
        ),
      },
      unusedImage: t('Not used by any texture'),
      suggestions: t('Suggestions'),
      suggestionsNote: t(
        'Only suggestions: Nightmesh never changes the file. Each command writes a new file with glTF Transform, which needs Node.js.',
      ),
      suggestion: {
        geometry: {
          title: t('Compress the geometry'),
          text: t(
            '{0} of vertex and index data is stored uncompressed. meshopt compression usually makes it several times smaller and decodes fast.',
            '{0}',
          ),
        },
        textureMemory: {
          title: t('Keep textures compressed on the GPU'),
          text: t(
            'Textures take about {0} of GPU memory, four bytes a pixel. KTX2 textures stay compressed on the GPU, at about a quarter of that. The command needs KTX-Software; use uastc in place of etc1s for normal maps.',
            '{0}',
          ),
        },
        textureDownload: {
          title: t('Make the textures smaller to download'),
          text: t(
            'PNG and JPEG textures take {0} of the file. WebP usually takes much less, and they take the same memory on the GPU.',
            '{0}',
          ),
        },
        textureSize: {
          title: t('Scale down the largest textures'),
          text: t(
            "Some textures are larger than 4096 pixels, which many mobile GPUs can't load. Together they take about {0} of GPU memory.",
            '{0}',
          ),
        },
        unused: {
          title: t('Remove unused data'),
          text: t("{0} of the file isn't used by anything in the model.", '{0}'),
        },
      },
      copy: t('Copy Command'),
    },
    report: {
      generated: t('A report by Nightmesh.'),
      name: t('Name'),
      share: t('Share'),
      format: t('Format'),
      pixels: t('Pixels'),
      notes: t('Notes'),
      severity: t('Severity'),
      code: t('Code'),
      message: t('Message'),
      where: t('Where'),
      notValidated: t('The model had not been validated yet when this report was saved.'),
    },
    export: {
      menu: t('Export'),
      screenshot: t('Save Screenshot…'),
      report: t('Save Report…'),
    },
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
      grid: t('Grid'),
      gridCell: t('Grid ({0} squares)', '{0}'),
      axes: t('Origin Axes'),
      bounds: t('Bounding Box'),
      backgrounds: {
        theme: t('Theme Background'),
        dark: t('Dark Background'),
        neutral: t('Neutral Background'),
        light: t('Light Background'),
      },
      up: { y: t('Y Up'), z: t('Z Up') },
      units: {
        mm: t('Millimetres'),
        cm: t('Centimetres'),
        m: t('Metres'),
        in: t('Inches'),
        ft: t('Feet'),
      },
    },
    shading: {
      menu: t('Shading'),
      modes: { lit: t('Lit'), unlit: t('Unlit'), normals: t('Normals') },
      wireframe: t('Wireframe'),
      defaultVariant: t('Default Materials'),
      variant: t('Variant {0}', '{0}'),
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
      longest: t('Longest'),
      keyframes: t('Keyframes'),
      animatedNodes: t('Animated nodes'),
      stillClips: t('Moving nothing'),
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
      validation: t('Validation'),
    },
    source: {
      format: t('Format'),
      encoding: t('Encoding'),
      encodings: {
        binary: t('Binary'),
        ascii: t('ASCII'),
        binary_little_endian: t('Binary, little-endian'),
        binary_big_endian: t('Binary, big-endian'),
      },
      version: t('Version'),
      header: t('Header'),
      elements: t('Elements'),
      solids: t('Solids'),
      facets: t('Facets'),
      colors: t('Colors'),
      materialise: t('Facet colors (Materialise)'),
      comments: t('Comments'),
      libraries: t('Material libraries'),
      statements: t('Statements'),
      notDrawn: t('not drawn'),
      check: t('Mesh check'),
      area: t('Surface area'),
      volume: t('Volume'),
      insideOut: t('faces point inward'),
      watertight: t('Watertight'),
      yes: t('Yes'),
      no: t('No'),
      openEdges: t('Open edges'),
      nonManifoldEdges: t('Non-manifold edges'),
      flippedEdges: t('Edges between faces wound opposite ways'),
      shells: t('Shells'),
      degenerate: t('Faces without area'),
      notDefined: t("The material libraries don't define this material."),
    },
    compare: {
      tab: t('Changes'),
      note: t(
        'Things are matched by name. Geometry is compared by its counts and bounds, not vertex by vertex.',
      ),
      waiting: t('Waiting for the other version…'),
      none: t('No changes found.'),
      one: t('1 change'),
      many: t('{0} changes', '{0}'),
      added: t('Added'),
      removed: t('Removed'),
      changed: t('Changed'),
      contains: t('Contains changes'),
      visibility: t('Visibility'),
      geometry: t('Geometry'),
      bounds: t('Bounds'),
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
    notMesh: (format, objectFile) =>
      objectFile
        ? t(
            "This .obj file isn't a 3D model: it is binary, as the object files compilers write are.",
          )
        : format === 'obj'
          ? t("The file isn't an OBJ model, or it is damaged.")
          : format === 'stl'
            ? t("The file isn't an STL model, or it is damaged.")
            : t("The file isn't a PLY model, or it is damaged."),
    noGeometry: t('This file has no faces, lines or points to draw.'),
    badFaces: (count) =>
      t('Faces left out because they are incomplete or name vertices the file lacks: {0}', count),
    freeForm: (count) => t("Free-form curves and surfaces aren't drawn: {0}", count),
    missingMaterials: (names) => t("Materials the material libraries don't define: {0}", names),
    imageFormat: (name) =>
      t("{0} isn't shown: textures are shown from PNG, JPEG, WebP, GIF and BMP files.", name),
  };
}
