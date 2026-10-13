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
- Files that can't be shown say why: an empty file, a file that isn't glTF, a Git LFS pointer
  whose model isn't downloaded, an extension Nightmesh can't draw yet. When only part of a
  model can be loaded (a missing `.bin` or texture, a file cut off while copying), the rest is
  drawn and a note lists what was left out.
- Files next to a `.gltf` are read only from the model's folder and workspace, never from the
  network or an absolute path.

[Unreleased]: https://github.com/mbKalkan/nightmesh/commits/main
