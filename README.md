# Nightmesh

> **Status:** early development — not yet published.

A fast, dark-first, **read-only** 3D model viewer and inspector for VS Code: glTF/GLB first, with
OBJ, STL, PLY and 3D Tiles planned.

- **See and inspect in one place.** Orbit the model, browse its scene tree, meshes, materials,
  textures and animations, and check triangle counts, validation results and where the bytes go.
- **Instant structure.** The scene structure and statistics appear right away, even in very large
  files; geometry streams in after.
- **Fully offline.** Draco, meshopt and KTX2 decoders ship with the extension. No CDN, no telemetry,
  no network access.
- **Point an AI assistant at a part.** Right-click a node in the view or the structure and choose
  **Copy Reference** to get `models/robot.glb, node "Arm" (nodes[12]), under Root › Body` on the
  clipboard, ready to paste into a chat with Claude Code or any assistant that works in your
  workspace. **Copy Reference with Details** adds what the inspector says about it.
- **Look from any side.** Front, right and top views on the number keys, as in Blender,
  perspective or orthographic, and an axes gizmo to click.
- **Dark-first.** Follows your VS Code theme, including high contrast.
- **Read-only.** Your model files are never written to.

## License

[MIT](LICENSE)
