# Contributing

[中文](CONTRIBUTING.md) | [English](CONTRIBUTING.en.md)

Thanks for working on this plugin. Two things matter before you open a change: the repository is dual-licensed, and some files must not be edited by hand.

## License boundary

| Part | License | When you change it |
|---|---|---|
| Plugin body `lib/**`, icon, README, this file, `SECURITY.md` | **MIT** | Keep the root `LICENSE` and `NOTICE` |
| Bundled renderer `renderer/**` | **GPL-3.0-or-later** | Keep `LICENSE-render`, `renderer/LICENSE`, and the modification notice |

`lib/**` talks to the renderer only through an iframe and `postMessage`. Do not `import` or `require` its source. Renderer edits stay inside `renderer/**` and follow the GPLv3 notice requirement. New third-party material is recorded in `THIRD-PARTY.md`.

## What to change

- Bug fixes, settings, wallpaper loading, appearance, and diagnostics.
- Gates: if behavior changes, add or update the matching `tools/*-test.mjs`. Do not delete an assertion to make a run green.
- Text people read stays in both languages: `README.md` / `README.en.md`, plus the English pair of this file and `SECURITY.md`.

Do not hand-edit:

- Generated Now Playing / audio-bus regions inside `lib/client.js`.
- Build output under `dist/`.
- The version number. Releases are bumped by the maintainers.

## Local checks

Node.js ≥ 20. Run the gates that match the change. Do not rerun the full gate for every small edit.

```bash
node --check lib/client.js
node tools/integrity-check.mjs
node tools/secret-scan-test.mjs
node tools/style-scope-guard.mjs
```

When the change touches styles, the published package, or install files, also run:

```bash
bash tools/check.sh
```

The full gate includes headless-browser steps. If memory is tight, or a local DSH process is in use, run the offline checks above and do not start more than one browser.

## Pull requests

One pull request, one purpose. In the description, include:

1. What changed and why.
2. Which gates ran, with pass and fail counts.
3. What you did not check in a real browser.

Do not commit:

- Tokens, keys, or live addresses from a diagnostics export.
- Machine-local absolute paths or personal directories.
- `node_modules/`, `dist/`, probe output, or screenshots.

General feedback is in the [README feedback section](README.en.md#feedback). Report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md).
