# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-14

First preview release.

### Added

- Open glTF models (`.glb`, and `.gltf` with its `.bin` files and textures) in a 3D view that
  follows your color theme. Orbit, pan and zoom with the mouse; the model is framed when it
  opens, and keeps your view when the file changes on disk.
- Models are lit by a built-in environment, so they look right without any setup and without
  a network connection. meshopt-compressed and quantized models open too.
- Draco-compressed meshes and KTX2 (Basis Universal) textures open too. Their decoders ship
  with the extension and load only when a model needs them.
- A Structure panel lists the model's scenes and node hierarchy, then its meshes, materials,
  textures, animations, skins, cameras and lights. It shows as soon as the file is opened,
  before the geometry has loaded, and also for models that can't be drawn.
- An Inspector panel shows what is selected: the file and its contents, a node's transform and
  mesh, primitive counts and attributes, material values with color swatches, texture samplers,
  animation channels and more, with links between them. Values can be selected and copied.
- Both panels can be hidden from the toolbar and resized; the tree works with the keyboard
  (arrow keys, Home/End, type to find) and stays fast with tens of thousands of nodes.
- What is selected in the structure is outlined in the 3D view: a node, every node using a
  mesh, every part drawn with a material. Click the model to select what is under the pointer,
  and the tree opens to it and brings it to the middle; click empty space or press Escape to let
  go.
- Frame Selection (F, the toolbar button, or a double-click in the view or the tree) brings the
  selection into view from the direction you look at it, so a small part next to a large ground
  plane is easy to look at.
- Look from the front, right or top with the View menu or the number keys 1, 3 and 7, and from
  the opposite side with Shift; 9 turns to the other side. 5 switches between perspective and
  orthographic, keeping what you see the same size. An axes gizmo in the corner of the view shows
  which way X, Y and Z point; click an axis to look along it. In the view, the arrow keys orbit
  and + and - zoom.
- A ground grid under the model, in squares of a power of ten metres sized to the model (the View
  menu says how big), and the world's axes through the origin, from the View menu. The grid shows
  by default; the axes when you ask.
- The model's bounding box can be drawn from the View menu, and the view's background set to dark,
  neutral grey or light instead of the theme's; the grid and box change shade to show on it.
- The panels, their widths, the grid, axes, bounding box and background stay as you left them, for
  every model you open next.
- A Shading menu draws the model lit as its materials say, unlit in their base colors and
  textures, or colored by the direction its surfaces face, to check normals; a wireframe can be
  drawn over any of them.
- Models with material variants (KHR_materials_variants) switch between them from the Shading
  menu, in any shading.
- Look through the cameras in the model from the View menu, or with 0, which goes from one to
  the next: from where each camera is, with its field of view, perspective or orthographic.
- A Statistics tab beside the Inspector counts the scene shown, before its geometry loads:
  nodes, mesh instances (GPU instancing included), draw calls, vertices, triangles, materials,
  textures and the scene's dimensions in metres, then a table of meshes sorted by the triangles
  they put on screen. Mesh names select the mesh and outline where it is drawn. For a model with
  animations it sums them up too: clips, the longest, channels, keyframes, the nodes they move,
  and how many move nothing.
- The size of the model in metres shows in the corner of the 3D view, and the size of the
  selection when something is selected: a node along its own axes, so a turned part keeps its
  real length. The Inspector gives the dimensions of the model, scenes and nodes, and each
  mesh's size, before the geometry has loaded. Selection boxes turn with what they outline.
- Animations play from a bar below the view: pick a clip (or select it in the structure),
  play and pause (Space), scrub the time line, change the speed. Clips loop; switching clips
  puts the model back in its rest pose first. When the file changes, the clip stays.
- A clip whose keyframes move nothing (all equal to the rest pose, as some exporters write
  them) is marked in the bar and the Inspector, so a model that doesn't move when played isn't
  mistaken for a viewer problem. Clips that hold a single pose are marked too.
- **Copy Reference** in the right-click menu puts the file's path and what was right-clicked on
  the clipboard, such as `models/robot.glb, node "Arm" (nodes[12]), under Root › Body`, ready to
  paste into a chat with an AI assistant: a part of the model in the view, a row in the
  structure, or a link in the inspector. **Copy Reference with Details** adds what the inspector
  says about it. Both are in the Command Palette too, where they refer to the selection.
- Textures show their size in pixels, mip levels and estimated GPU memory, read from each
  image's header as the model opens, and a preview of the image once the model is drawn. The
  Statistics tab adds up the texture memory of the scene.
- A model that takes a moment to load says so in the middle of the view, with how much has
  arrived, while its structure and statistics already show in the panels. A model of more than
  1 GB waits for **Draw Model** before it is loaded into the view.
- Screen readers hear what the view's keys do when it takes the focus, and what a click in the
  view picked; the size in its corner and the loading progress don't repeat themselves while a
  clip plays or bytes arrive.
- Files that can't be shown say why: an empty file, a file that isn't glTF, a Git LFS pointer
  whose model isn't downloaded, an extension Nightmesh can't draw yet. When only part of a
  model can be loaded (a missing `.bin` or texture, a file cut off while copying), the rest is
  drawn and a note lists what was left out.
- Earlier versions from Git (the Timeline, Source Control, a comparison) open as committed, also
  where git is set up to convert the file to text and for models kept in Git LFS, whose objects
  are read from the local store; a `.gltf`'s `.bin` and textures come from the same version.
- Files next to a `.gltf` are read only from the model's folder and workspace, never from the
  network or an absolute path.

[Unreleased]: https://github.com/mbKalkan/nightmesh/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mbKalkan/nightmesh/releases/tag/v0.1.0
