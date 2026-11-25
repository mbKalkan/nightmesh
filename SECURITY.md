# Security policy

Nightmesh makes no network requests and draws models in a webview with a strict Content
Security Policy. It writes to a model file only when you save transforms you made to a glTF or
GLB model, and then only to that file or the one you pick in **Save As**. Model files are
treated as untrusted input; files a `.gltf` refers to are read only from its folder and
workspace.

## Reporting a vulnerability

Please don't open a public issue for security problems. Report them privately with GitHub's
**Report a vulnerability** button on the repository's
[Security tab](https://github.com/mbKalkan/nightmesh/security). Include the file or steps that
show the problem if you can.

You'll get a reply within a week. Fixes are released as soon as they're ready, and reporters are
credited unless they prefer not to be.

## Supported versions

Only the latest release receives fixes.
