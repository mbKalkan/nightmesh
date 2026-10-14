# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
  mesh, every part drawn with a material. Click the model to select what is under the pointer;
  click empty space or press Escape to let go.
- Frame Selection (F, the toolbar button, or a double-click in the view or the tree) brings the
  selection into view, so a small part next to a large ground plane is easy to look at.
- A Statistics tab beside the Inspector counts the scene shown, before its geometry loads:
  nodes, mesh instances (GPU instancing included), draw calls, vertices, triangles, materials,
  textures and the scene's dimensions in metres, then a table of meshes sorted by the triangles
  they put on screen. Mesh names select the mesh and outline where it is drawn.
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
- Textures show their size in pixels, mip levels and estimated GPU memory, read from each
  image's header as the model opens, and a preview of the image once the model is drawn. The
  Statistics tab adds up the texture memory of the scene.
- Files that can't be shown say why: an empty file, a file that isn't glTF, a Git LFS pointer
  whose model isn't downloaded, an extension Nightmesh can't draw yet. When only part of a
  model can be loaded (a missing `.bin` or texture, a file cut off while copying), the rest is
  drawn and a note lists what was left out.
- Files next to a `.gltf` are read only from the model's folder and workspace, never from the
  network or an absolute path.

[Unreleased]: https://github.com/mbKalkan/nightmesh/commits/main
