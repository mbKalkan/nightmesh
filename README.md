<img src="assets/icon.png" alt="" width="96" align="right">

# Nightmesh

[![Visual Studio Marketplace](https://vsmarketplacebadges.dev/version-short/MBKDevStudio.nightmesh.svg?label=Marketplace&color=007ec6)](https://marketplace.visualstudio.com/items?itemName=MBKDevStudio.nightmesh)
[![Visual Studio Marketplace installs](https://vsmarketplacebadges.dev/installs-short/MBKDevStudio.nightmesh.svg?label=Marketplace%20installs&color=4c1)](https://marketplace.visualstudio.com/items?itemName=MBKDevStudio.nightmesh)
[![Open VSX](https://img.shields.io/open-vsx/v/MBKDevStudio/nightmesh?label=Open%20VSX)](https://open-vsx.org/extension/MBKDevStudio/nightmesh)
[![Open VSX downloads](https://img.shields.io/open-vsx/dt/MBKDevStudio/nightmesh?label=Open%20VSX%20downloads&color=4c1)](https://open-vsx.org/extension/MBKDevStudio/nightmesh)
[![CI](https://github.com/mbKalkan/nightmesh/actions/workflows/ci.yml/badge.svg)](https://github.com/mbKalkan/nightmesh/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**View and inspect glTF and GLB 3D models in VS Code, in your dark theme.**

Nightmesh is a fast, offline, view-only viewer for glTF models (`.glb`, and `.gltf` with its
`.bin` files and textures). It shows the model in a 3D view that follows your color theme,
and next to it what the file holds: its node tree, meshes, materials, textures and animations,
how many triangles it draws and how big it is in metres. The structure is there as soon as the
file opens, before the geometry has loaded, even for files of hundreds of megabytes.

> **Preview.** glTF and GLB open today. OBJ, STL, PLY and 3D Tiles are planned.

![Nightmesh opening a concept car: the structure shows while the model loads, a door picked in the view is selected in the tree and described in the inspector, the paint changes to another variant, a wireframe is drawn over it, and the statistics count the scene](docs/images/demo.gif)

## Why Nightmesh

- **Structure first.** The node tree, the inspector and the statistics show right away, read
  from the file's JSON. You can find your way around a large model while its geometry is still
  loading, and also in a model that can't be drawn.
- **Inspect, not just look.** Click a part to see which node it is, where it sits in the
  hierarchy, its transform, mesh, materials and size in metres. Follow the links from a mesh to
  its materials and textures, and count what the scene puts on the GPU.
- **Point an AI assistant at a part.** Right-click a part and choose **Copy Reference** to get
  `models/robot.glb, node "Arm" (nodes[12]), under Root › Body` on the clipboard, ready to paste
  into a chat with Claude Code or any assistant that works in your workspace.
- **Offline and private.** The Draco, meshopt and KTX2 decoders and the lighting ship with the
  extension. No network access, no CDN, no telemetry.
- **View-only.** Your model files are never written to.

## Features

### The 3D view

- Orbit, pan and zoom with the mouse. The model is framed when it opens and keeps your view
  when the file changes on disk.
- Look from the front, right or top with the **View** menu or the number keys 1, 3 and 7, as in
  Blender, and from the other side with Shift. 5 switches between perspective and orthographic.
  An axes gizmo shows which way X, Y and Z point; click an axis to look along it.
- Look through the cameras saved in the model, with their field of view.
- A ground grid in squares of a power of ten metres, sized to the model, the world's axes and
  the model's bounding box. The background can follow your theme or be dark, neutral or light.
- The size of the model, or of what is selected, in metres in the corner of the view.
- Models are lit by a built-in environment, so they look right without any setup.
- Draco and meshopt compressed meshes, quantized models and KTX2 (Basis Universal) textures open
  too. Their decoders load only when a model needs them.

![The View menu over a toy car on a light background, with the bounding box drawn and the model's cameras listed](docs/images/view-light.png)

### Structure and inspector

- The **Structure** panel lists the scenes and node hierarchy, then the meshes, materials,
  textures, animations, skins, cameras and lights. It stays fast with tens of thousands of nodes.
- The **Inspector** shows what is selected: a node's transform and mesh, a mesh's primitives,
  vertices and attributes, material values with color swatches, texture size, mip levels and
  GPU memory with a preview of the image, animation channels and more, with links between them.
- **Show glTF JSON** opens the model's JSON beside the viewer, a GLB's too, at what is
  selected. It follows the selection both ways: move through the JSON and the viewer selects
  what the cursor is in.
- What is selected is outlined in the 3D view: a node, every node that uses a mesh, every part
  drawn with a material. Click the model to select what is under the pointer, and the tree opens
  to it. Frame Selection (F, or a double-click) brings it into view.

![A wheel picked in the 3D view is outlined, its node is selected in the structure tree, and the inspector gives its size, transform and mesh](docs/images/inspector-dark.png)

### Statistics

- The **Statistics** tab counts the scene that is shown, before its geometry loads: nodes, mesh
  instances, draw calls, vertices, triangles, materials, textures, estimated texture memory and
  the scene's dimensions.
- A table of meshes, sorted by the triangles they put on screen, finds the heavy ones. Click a
  name to select the mesh and see where it is drawn.
- For a model with animations: how many clips, the longest, channels, keyframes and the nodes
  they move.

![The statistics of a concept car: totals for the scene and its meshes sorted by triangles](docs/images/statistics-dark.png)

### Validation

- The **Validation** tab runs the official Khronos glTF Validator on the model, in the
  background once it has loaded. Its `.bin` files and textures are checked too.
- Errors, warnings, infos and hints are counted and can be hidden or shown; the tab counts the
  errors and warnings. Click an issue's JSON pointer to select what it is about, or show it in
  the glTF JSON.

### Size and optimization

- The **Size** tab breaks the file down into JSON, vertex data, indices, morph targets,
  animations, skins and textures, with the files a `.gltf` uses, and finds data nothing uses.
- How the geometry (Draco, meshopt, quantization) and the textures (KTX2, WebP, PNG, JPEG) are
  compressed, and the GPU memory they are estimated to take.
- The largest meshes, textures and animations, and each image's format, size and bytes, marked
  when it is larger than 4096 pixels or not a power of two.
- Suggestions for a lighter model, with the [glTF Transform](https://gltf-transform.dev) command
  that writes an improved copy. Nightmesh never changes the file itself.

### Shading and materials

- The **Shading** menu draws the model lit as its materials say, unlit in their base colors and
  textures, or colored by the direction its surfaces face, to check normals. A wireframe can be
  drawn over any of them.
- Models with material variants (`KHR_materials_variants`) switch between them from the same
  menu.
- Physically based materials with their Khronos extensions: clearcoat, sheen, transmission,
  volume, iridescence, anisotropy, dispersion, specular, IOR, emissive strength, bump and unlit.
  Textures can be PNG, JPEG, WebP, AVIF or KTX2.

![A chair in its Peacock Velvet variant with a wireframe drawn over it, and the Shading menu open](docs/images/shading-dark.png)

### Animations

- Play a model's animations from a bar below the view: pick a clip, play and pause (Space), scrub
  the time line and change the speed.
- A clip whose keyframes move nothing, as some exporters write them, is marked as such, so a
  model that doesn't move isn't mistaken for a viewer problem.

![A fox running in the Run clip, with the clip's channels in the inspector](docs/images/animation-dark.png)

### Everywhere

- **Export** the view as a PNG, or a report on the model (details, statistics, size, suggestions
  and validation) as Markdown or JSON, to a new file you pick.
- **Copy Reference** in the right-click menu, for a part in the view, a row in the structure or a
  link in the inspector. **Copy Reference with Details** adds what the inspector says about it.
  Both are in the Command Palette too, where they refer to the selection.
- Earlier versions from Git (the Timeline, Source Control, a comparison) open as they were
  committed, including models kept in Git LFS whose content is on this machine.
- Live reload that keeps your view when the file is saved.
- Files that can't be shown say why. When only part of a model can be loaded, such as a missing
  `.bin` or texture, the rest is drawn and a note lists what was left out.
- A model larger than 1 GB waits for **Draw Model** before it's loaded into the view; its
  structure and statistics show right away.
- Dark, light and high contrast themes.
- Keyboard and screen reader support.
- English and Turkish.

## Getting started

1. Install **Nightmesh** from the
   [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=MBKDevStudio.nightmesh)
   or, in VSCodium and other editors that use it,
   [Open VSX](https://open-vsx.org/extension/MBKDevStudio/nightmesh). Or search for "Nightmesh"
   in the Extensions view.
2. Open a `.glb` or `.gltf` file. Nightmesh is the default viewer for these files.

If another extension also opens these files, right-click the file and choose
**Open With… › Nightmesh**, then **Configure default editor**. Or add this to your settings:

```json
"workbench.editorAssociations": {
  "*.glb": "nightmesh.viewer",
  "*.gltf": "nightmesh.viewer"
}
```

## Mouse and keyboard

| Action                                     | Mouse or key                                                |
| ------------------------------------------ | ----------------------------------------------------------- |
| Orbit                                      | Drag, or the arrow keys in the view                         |
| Pan                                        | Right-drag, or <kbd>Shift</kbd>+drag                        |
| Zoom                                       | Mouse wheel, or <kbd>+</kbd> / <kbd>-</kbd>                 |
| Select what is under the pointer           | Click                                                       |
| Frame the selection                        | <kbd>F</kbd>, or double-click                               |
| Let go of the selection                    | <kbd>Esc</kbd>, or click empty space                        |
| Look from the front, right or top          | <kbd>1</kbd>, <kbd>3</kbd>, <kbd>7</kbd>                    |
| Look from the back, left or bottom         | <kbd>Shift</kbd>+<kbd>1</kbd>, <kbd>3</kbd>, <kbd>7</kbd>   |
| Look from the other side                   | <kbd>9</kbd>                                                |
| Switch between perspective and orthographic | <kbd>5</kbd>                                               |
| Look through the next camera in the model  | <kbd>0</kbd>                                                |
| Play or pause the animation                | <kbd>Space</kbd>                                            |

The number keys work on the main keyboard and the number pad. Nightmesh doesn't use
<kbd>Ctrl</kbd> shortcuts in the view, so VS Code's own stay as they are.

## Limitations

- Only glTF 2.0 is supported for now: OBJ, STL, PLY and 3D Tiles are planned.
- The glTF Validator doesn't know some extensions, such as `KHR_texture_basisu` and
  `EXT_meshopt_compression`: it says so, and may warn about what they change.
- Models that require `KHR_materials_pbrSpecularGlossiness` or `KHR_node_visibility` can't be
  drawn yet; Nightmesh says so and still shows their structure.
- One animation clip plays at a time.
- A `.gltf`'s `.bin` files and textures are read only from the model's folder and workspace:
  never from the network or an absolute path.
- Nightmesh needs desktop VS Code: it isn't available in VS Code for the Web yet.

## Contributing

Bug reports and ideas are welcome in [issues](https://github.com/mbKalkan/nightmesh/issues).
See [CONTRIBUTING.md](CONTRIBUTING.md) to build and test the extension.

## License

[MIT](LICENSE). Third-party components and their licenses are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), along with the credits for the models in the
screenshots above, from the [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets).
