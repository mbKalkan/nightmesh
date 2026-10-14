# Contributing to Nightmesh

Thanks for your interest! Bug reports, ideas and pull requests are all welcome.

## Reporting a bug

Open an [issue](https://github.com/mbKalkan/nightmesh/issues/new/choose) with:

- what you expected and what you saw (a screenshot helps a lot),
- your VS Code version, OS, graphics card and color theme,
- if you can share it, a small model that shows the problem, or where a public one can be found.
  Please remove anything private first.

## Development setup

Requires [Node.js](https://nodejs.org/) 22 or later.

```bash
npm install
npm run build        # bundle the extension and the webview into dist/
npm run watch        # rebuild on change
```

Press <kbd>F5</kbd> in VS Code to start an Extension Development Host with the sample models in
`test/fixtures`. Alternatively, build a package with `npm run package` and install the `.vsix`
with **Extensions: Install from VSIX…**.

## Project layout

| Path                       | What lives there                                                              |
| -------------------------- | ----------------------------------------------------------------------------- |
| `src/extension/`           | Extension host: the custom editor, commands, reading files and Git versions   |
| `src/extension/model/`     | Turning a file into messages: GLB layout, resources, the render plan          |
| `src/webview/`             | The viewer UI that runs in the webview: shell, panels, menus, keys            |
| `src/webview/structure/`   | The structure tree, inspector and statistics, from the glTF JSON alone         |
| `src/webview/scene/`       | The 3D view (three.js), loaded on demand: camera, selection, shading, helpers |
| `src/shared/`              | Code used on both sides: the message protocol, formats, references            |
| `test/unit/`               | Unit tests (Vitest)                                                           |
| `test/visual/`             | Browser tests of the viewer UI, with WebGL (Playwright)                       |
| `test/smoke/`              | End-to-end tests in a real copy of VS Code                                    |
| `scripts/`                 | Build, fixture generation and helper scripts                                  |

The webview never touches the file system: the extension host reads the model, a GLB's header and
JSON first, and sends its parts as they are needed, so the structure shows at once and remote and
virtual workspaces work too. The webview runs under a strict Content Security Policy with no
network access; the Draco, meshopt and KTX2 decoders are bundled.

## Checks

Run these before opening a pull request. CI runs the same ones.

```bash
npm run format:check # Prettier (npm run format fixes it)
npm run lint         # ESLint
npm run typecheck    # TypeScript
npm test             # unit tests
npm run test:visual  # browser tests (uses Microsoft Edge on Windows, Chromium elsewhere)
npm run test:smoke   # end-to-end tests in a downloaded copy of VS Code
```

Other useful scripts:

- `npm run fixtures` regenerates the sample models in `test/fixtures` from code.
- `npm run fixtures:large` writes a model of about two million triangles for performance checks.

If you change the UI, look at the screenshots the browser tests save in `test-results/screens`,
in both the dark and the light theme.

## Pull requests

- Keep each pull request to one change, and add or update tests for it.
- Write commit messages and PR titles as
  [Conventional Commits](https://www.conventionalcommits.org/) in the imperative mood:
  `feat: …`, `fix: …`, `docs: …`, `test: …`, `refactor: …`, `chore: …`, `ci: …`.
- Note user-visible changes in the `[Unreleased]` section of [CHANGELOG.md](CHANGELOG.md).
- User-facing text goes through localization: add new strings in English to
  `src/extension/texts.ts` or `package.nls.json`, and their Turkish translations to
  `l10n/bundle.l10n.tr.json` or `package.nls.tr.json`.
- New dependencies need an MIT, Apache-2.0, BSD or ISC license and an entry in
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Pull requests are squash-merged once CI passes.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
