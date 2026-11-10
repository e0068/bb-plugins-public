# plugin-base

Shared layer 1 for plugin configs — no dependencies of its own, just static
settings referenced by the other plugins via a relative path (like the other
packages in [packages](..) — no npm linking, a plugin is never installed
separately from the repo anyway).

The list of dependencies already used by other plugins (so you don't pull in
a duplicate under a different name) lives in
[docs/wiki/plugin-dependency-stack.md](../../docs/wiki/plugin-dependency-stack.md).

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

## Importing shared packages: `@bb-plugins/<pkg>`

Plugin code imports a shared package as `@bb-plugins/<pkg>`, never as
`../packages/<pkg>`. Since bb 0.44 the load-time server build rejects a
relative import that resolves outside the plugin directory ("server source
import escapes the plugin directory"), and the plugin stays in `error`. A bare
specifier passes: bb resolves it through the plugin's tsconfig `paths` and
bundles it. `bb plugin build` doesn't run this check, so a relative import
builds fine locally and breaks only after install.

Each plugin that uses shared packages declares the path in its `tsconfig.json`
(its own `paths` replaces the base one, so it can't live in
`tsconfig.base.json`):

```json
"paths": { "@/*": ["./*"], "@bb-plugins/*": ["../packages/*"] }
```

Vitest doesn't read tsconfig `paths`, so `vitest.config.ts` spreads
`sharedPackagesAlias` from `vitest-shared-packages.ts` into `resolve.alias`.
Packages keep importing each other by relative path — the check only applies
to files inside the plugin.
