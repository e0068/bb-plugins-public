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

Run the pull script from the repo root, pointing it at a local Kasimov clone
where `npm run release` has just produced `dist/` and `dist/kasimov.manifest.json`:

```
node scripts/pull-kasimov.mjs --from ../Kasimov [--accept-new-exports] [--dry-run]
```

It verifies the build against the manifest (sizes + sha256), refuses to
overwrite a hand-edited vendored copy (the copy must match the
`kasimov.manifest.json` stored next to it), diffs the build's exports against
the hand-written [kasimov.d.ts](kasimov.d.ts), runs typecheck/tests of every
consumer in a temporary worktree of `origin/main` (only regressions block),
and opens a pull request through the GitHub API — nothing is pushed and your
checkout is not edited. After the merge, `scripts/publish-public.mjs` rolls
the change out to the public showcase.

The pinned source commit and version are in [package.json](package.json) and
in `kasimov.manifest.json` (written by the script; do not edit by hand).
