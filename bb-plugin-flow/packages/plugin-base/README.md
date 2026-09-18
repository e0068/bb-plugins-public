# plugin-base

Shared layer 1 for plugin configs — no dependencies of its own, just static
settings referenced by the other plugins via a relative path (like the other
packages in [packages](..) — no npm linking, a plugin is never installed
separately from the repo anyway).

The list of dependencies already used by other plugins (so you don't pull in
a duplicate under a different name) lives in
[memory/wiki/plugin-dependency-stack.md](../../memory/wiki/plugin-dependency-stack.md).

## tsconfig.base.json

Compiler options that are identical across nearly all 14 `tsconfig.json`
files. Pulled in via `extends`:

```json
{
  "extends": "../packages/plugin-base/tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx"
  },
  "include": ["server.ts", "app.tsx", "lib"]
}
```

What stays local to a plugin is only what actually differs: `jsx` (if it uses
React), `types`, `paths`, a non-standard `lib`. `include` isn't pulled into
the base file — each plugin has its own set of directories.

## vitest-react-dedupe.ts

`reactDedupe` is an array for `resolve.dedupe` in `vitest.config.ts`, needed
only by plugins that import UI from `packages/*` (they pull "react" from the
package's node_modules, not the plugin's — without dedupe, tests fail on a
second copy of React). Imported directly, with no config factory — the rest
of each plugin's `vitest.config.ts` is its own (jsdom/node, aliases, timeouts)
and it wasn't worth forcing that into a shared template: real differences, not duplication.
