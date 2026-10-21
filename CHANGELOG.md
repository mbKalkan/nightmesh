# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **OBJ, STL and PLY models** open in Nightmesh by default, read in a thread of their own so
  VS Code stays responsive, with a progress bar for large files. The structure, inspector,
  statistics, selection, shading modes, Copy Reference, screenshots and reports work as they do
  for glTF.
  - **OBJ:** objects and groups, a part for each material, polygons (concave ones and rings
    written as one polygon too), lines and points, negative indices, vertex colors, and MTL
    material libraries with their textures. A texture given by an absolute path is looked for
    by its name next to the library and the model; a file that selects no material is drawn in
    its library's only one. Text in UTF-8, UTF-16 or Latin-1.
  - **STL:** binary and ASCII, each ASCII solid on its own, and Materialise facet colors.
    Vertices at the same place are welded, so the statistics count them once.
  - **PLY:** ASCII and binary of either byte order; vertex normals, colors and texture
    coordinates, faces (concave ones too), triangle strips and edges, and MeshLab's textures. A
    file without faces is drawn as a point cloud, its points the larger the fewer there are.
- For these formats the inspector shows what the file says about itself: an STL's header and
  solids, a PLY's elements, properties and comments, an OBJ's statements and the MTL statements
  of each material.
- A **mesh check** in the inspector, as for 3D printing: the surface area, whether the model is
  watertight and the volume it holds (in cubic centimetres too for millimetres), and what keeps
  it from being so: open edges, edges of more than two faces, edges between faces wound
  opposite ways, faces without area. It counts the separate shells too. It comes just after the
  model, so it never holds it up, and goes in Copy Reference with Details and the report.
- STL files are taken to be in millimetres with Z up, as CAD writes them; OBJ and PLY in metres
  with Y up, or Z up when their coordinates are georeferenced. An OBJ file that names its unit
  in a comment, as Maya's do, opens in that unit. The **View** menu sets the units
  (millimetres, centimetres, metres, inches, feet) and which axis is up; the next file of the
  same format opens that way. Sizes in the view and the inspector, and the grid's squares, are
  in the file's units. Georeferenced models are drawn around their first point, where the view
  is precise; the inspector keeps their coordinates.
- Parts the file gives no material are drawn matte grey from both sides.
- Problems in a file are listed over the model: missing material libraries and textures,
  textures in formats browsers can't show, faces naming vertices the file lacks, free-form
  curves and surfaces, a file cut short. A binary `.obj` is said to be a compiler's object file.

## [0.2.0] - 2026-10-15

Validation, size analysis, the glTF JSON and export.

### Added

- A **Validation** tab runs the Khronos glTF Validator on the model once it has loaded, in the
  background and without a network connection. Errors come first, then warnings, infos and
  hints; buttons above the list show how many there are of each and hide or show them. An
  issue's JSON pointer selects what it is about in the structure, and the tab counts the errors
  and warnings.
- A **Size** tab shows where a model's bytes go: JSON, vertex data, indices, morph targets,
  animations, skins, textures, unused data, and the files a `.gltf` uses. It says how the
  geometry and textures are compressed, estimates GPU memory, lists the largest meshes, textures
  and animations, and every image with its format, size and what may be wrong with it (larger
  than 4096 pixels, not a power of two, unused).
- Suggestions in the Size tab, each with a glTF Transform command to copy, for models that
  could be lighter: compressing geometry, KTX2 or WebP textures, scaling down very large
  textures, removing unused data. Nightmesh itself never changes the file.
- **Show glTF JSON** (toolbar, right-click menu, Command Palette) opens the model's glTF JSON
  beside the viewer, laid out for reading and read-only, at what is selected; for a GLB, this is
  the JSON chunk. It follows the selection, and moving through it selects what the cursor is in.
  Each validation issue can be shown in it, where its JSON pointer points.
- An **Export** menu in the toolbar, and commands in the Command Palette: **Save Screenshot…**
  saves the 3D view as a PNG, **Save Report…** saves a report on the model (its details,
  statistics, size breakdown, suggestions and validation issues) as Markdown or JSON. Both go to
  a new file you pick; the model is never written.

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

[Unreleased]: https://github.com/mbKalkan/nightmesh/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/mbKalkan/nightmesh/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/mbKalkan/nightmesh/releases/tag/v0.1.0
