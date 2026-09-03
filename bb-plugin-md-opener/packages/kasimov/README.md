# kasimov (vendored build)

A ready-made ESM build of the [Kasimov](https://github.com/e0068/Kasimov)
editor, committed into this repo: `kasimov.js` (the engine) and `kasimov.css`
(styles). The package exposes them via `exports` — `.` and `./css` — like a
real `kasimov` from npm. The consumer
([packages/md-doc-view](../md-doc-view)) imports it by the bare name
`kasimov` / `kasimov/css` and doesn't know the source is vendored.

## Why vendor instead of pulling a github dependency

The original `github:e0068/Kasimov` package builds its own `dist/` via a
`prepare: node build.js` lifecycle script — in the Kasimov repo, `dist/` is
deliberately in `.gitignore`. The BB daemon installs plugin dependencies with
`--ignore-scripts`, so `prepare` never runs, `dist/` never appears, and the
front-end build fails with `Could not resolve "kasimov" / "kasimov/css"`. A
ready-made build in git removes the build-on-install step: it resolves without scripts.

Analysis and rejected alternatives —
[memory/decisions/md-opener-vendor-kasimov.md](../../memory/decisions/md-opener-vendor-kasimov.md).

## Files at the root, not in dist/

The root [.gitignore](../../.gitignore) ignores any `dist/` folder. So the
built files live at the package root, and `exports` points to them directly.

## How to update (bump Kasimov)

```
npm install github:e0068/Kasimov#<commit>     # builds dist via prepare
cp node_modules/kasimov/dist/kasimov.js  packages/kasimov/kasimov.js
cp node_modules/kasimov/dist/kasimov.css packages/kasimov/kasimov.css
```

The pinned source commit is in `description` in [package.json](package.json).
