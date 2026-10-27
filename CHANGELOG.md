# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **3D Tiles tilesets** open in Nightmesh: right-click a `tileset.json` (or any tileset's JSON)
  and pick **Open With › Nightmesh 3D Tiles**. The tiles the camera needs load as it moves, the
  nearer ones in more detail, and those out of view leave memory. External tilesets, implicit
  tiling (binary subtrees) and Batched, Instanced, Point Cloud, Composite and glTF tiles are
  drawn, with Draco, meshopt and KTX2 compression. A tileset placed on the globe is shown at the
  origin with up as +Y, seen from the south. Tiles are read from disk by the extension, only
  inside the tileset's workspace folder, and the notice above the view says which ones couldn't
  be had.
- **Tile tree and inspector for tilesets**: the panels list a tileset's tiles as soon as it opens,
  by their content, with the path from the root. Selecting one shows its geometric error,
  refinement, content type, bounding volume (box, region or sphere) and implicit tiling, and
  whether the view has it loaded and drawn, with its screen-space error. The tile's bounding
  volume is boxed in the view and measured in its corner; Enter or a double-click frames it, and
  a click on the model selects the tile drawn there. The tileset itself shows how many tiles the
  file has and how many are loaded, drawn and on their way, and the memory they take.
- **b3dm tiles open on their own**: a `.b3dm` file opens in Nightmesh like a GLB, with the scene
  tree, inspector, statistics, glTF Validator, size breakdown, JSON, measuring and comparing.
  The model's details add what the tile says around its GLB: its header (also the shorter ones
  of files from before 3D Tiles 1.0), the sizes of its feature and batch tables, how many
  features it has, its `RTC_CENTER`, and the batch table's properties with their types. The Size
  tab counts the tile's header and tables apart.
- **pnts tiles open on their own**: a `.pnts` point cloud opens as a PLY point cloud does, in
  metres with Z up, with its colors (RGB, RGBA, RGB565 or one for the whole tile) and normals,
  plain or packed. Quantized positions are read within their volume, and points compressed with
  Draco (all of them or some of their data) are decoded by the decoder that ships with the
  extension. The inspector shows the tile's header and tables, its point count, the data its
  feature table gives, `RTC_CENTER` and the batch table's properties.
- **i3dm tiles open on their own**: a `.i3dm` file's model is drawn once for each instance, where
  the tile puts it, turned and sized as it says (`NORMAL_UP` and `NORMAL_RIGHT`, plain or packed,
  or east, north and up where it stands), with quantized positions read within their volume.
  Instances placed on the globe are shown around their middle, upright where they stand. The
  panels show the tile's GLB as the file has it, with the glTF Validator, JSON and measuring;
  sizes count every instance. The model's details add the tile's header, tables, instance count
  and the data its feature table gives. A tile whose model is in a file of its own names that
  file to open instead.
- **cmpt tiles open on their own**: a composite's b3dm and i3dm tiles, those in composites inside
  it too, are drawn together as one model, each where it says, under a node of its own in the
  scene tree. The model's details list the tiles the composite holds; the notice above the view
  names those not drawn (point clouds, models in files of their own).
- **b3dm tiles on the globe stand upright**: a tile whose `RTC_CENTER` is on the globe has its
  model along the Earth's axes, and was shown leaning; it is now turned to stand where it is.

### Changed

- **Models open faster**: the 3D view made its lighting anew for every file, which takes most of
  a second of GPU work on some machines. It is now made once and kept, so every viewer after the
  first starts drawing about 0.6 s sooner (measured on Windows: 740 ms to 75–105 ms).

### Fixed

- **Size of turned GPU instances**: a model whose instances (EXT_mesh_gpu_instancing) are turned,
  under a node that is turned too, measured larger than drawn in the corner of the view and was
  framed too far away. Each instance is now measured where it is.

## [0.4.0] - 2026-10-26

Compare two versions of a model side by side, measure distances on it, and OBJ smoothing groups.

### Added

- **Measure** the distance between two points on the model: turn the ruler on from the toolbar
  or with M, and click two points. The length shows over the line between them, and the corner
  of the view gives it with how far apart the points are along X, Y and Z, in the file's units
  for OBJ, STL and PLY. A click near a corner snaps to it, so an edge measures exactly; a ring
  shows the corner a click would take. Points are read from what the GPU draws, so they work on
  compressed, skinned (as posed) and instanced meshes, lines and point clouds too. Escape stops
  measuring.

- **Comparing two versions of a model.** When VS Code shows two versions side by side (Source
  Control, the Timeline, Compare Selected):
  - Both sides move together: orbiting, panning, zooming, standard views and the projection in
    one go to the other. The newer side frames both when they open.
  - A **Changes** tab lists what was added, removed or changed: nodes, meshes, materials,
    textures and animations, matched by name, with what changed about each (transform,
    geometry, a material's properties…), and the totals of both versions with the difference.
  - The structure marks the changes as Source Control marks files: A, D and M in its colors,
    and a dot on what holds a change. In the view, boxes in the same colors frame the nodes
    that were added, removed or changed (View › Changes turns them off).
  - Selecting something on one side selects the same on the other.
- OBJ files without normals draw their smoothing groups (`s 1`, `s 2`…) smooth, with sharp
  edges between groups, as Blender and 3ds Max do; faces with smoothing off stay flat. They
  were all drawn flat before.
- glTF models with nodes hidden by `KHR_node_visibility` open, with those nodes and all below
  them hidden, lights included. The view frames and measures what is shown, and the statistics
  count it; a hidden node can still be selected in the structure.

### Fixed

- A node drawn with GPU instances (`EXT_mesh_gpu_instancing`) measures across all of them in
  the inspector, the statistics, the report and a comparison, even before the model is drawn.
  It measured as a single instance before.

## [0.3.0] - 2026-10-21

OBJ, STL and PLY models, in their own units, with a mesh check for 3D printing.

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

[Unreleased]: https://github.com/mbKalkan/nightmesh/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/mbKalkan/nightmesh/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/mbKalkan/nightmesh/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/mbKalkan/nightmesh/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/mbKalkan/nightmesh/releases/tag/v0.1.0
