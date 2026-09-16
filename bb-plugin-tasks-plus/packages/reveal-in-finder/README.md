# @bb-plugins/reveal-in-finder

Shared layer for "reveal in Finder" (`open -R`). Zero React, node-only.

- `resolveSourceAbsPath(rootPath, relativePath)` — joins a relative path onto
  an absolute root; `null` if the result would escape the root.
- `revealInFinder(absPath, deps)` — shells out to `open -R <absPath>`
  (argv-array, never shell-interpolated). macOS only — other platforms get
  `{ revealed: false, error: "... only available on macOS" }` without
  spawning anything. Pure-deps core, used directly by this package's own
  tests.
- `revealInFinderHere(absPath)` — what production call sites use instead:
  reads `process.platform` and `revealExecFileProvider.current` itself
  (fresh on every call, not captured at import time), so an RPC handler
  can't forget the platform gate or the provider seam.
- `revealExecFileProvider` / `resetRevealExecFileProvider()` — the RPC-level
  test seam behind `revealInFinderHere`: swap `.current` in a test to capture
  calls instead of spawning a real process, reset it in `afterEach`.

Finder belongs to the machine running bb's server, not necessarily the host
the file lives on — callers must confirm the source is local before calling
`revealInFinder` (see `bb-plugin-tasks-plus/api/index.ts`'s
`revealTaskSource` and `bb-plugin-md-opener/server.ts`'s `revealDoc` for the
two locality checks in use).
