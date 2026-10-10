// Plugins that import React components from ../packages/* (see
// packages/md-editor, packages/resizable-pane) pull "react" from the
// package's node_modules, not the plugin's. Vite resolves bare imports by
// walking up from the importing file — for a file outside the plugin's tree
// this never reaches the plugin's own node_modules, and you end up with two
// copies of React: hooks fail with "Cannot read properties of null (reading
// 'useState')". dedupe forces all three modules to resolve from the plugin's
// root.
//
// Only needed in tests, but NOT because the bundler dedupes: esbuild does
// not. `bb plugin build` replaces a fixed set of specifiers (its own
// substitution map — the list below was read off bb 0.43 and travels with
// the host, not with this monorepo) — react,
// react-dom, react/jsx-runtime, clsx, tailwind-merge and a list of Radix
// packages — with the host's own shims, and a specifier the host shims
// cannot end up doubled whichever node_modules it came from. A package
// OUTSIDE that list still lands in the bundle twice; that costs bytes and,
// for a package that builds a React context, would split it in two.
export const reactDedupe = ["react", "react-dom", "react/jsx-runtime"];

/**
 * The same problem one level out. A shared package that keeps a THIRD-PARTY
 * React consumer in its own `node_modules` — packages/segmented-control holds
 * Radix — brings a second React with it: the list above is matched against the
 * specifier an importing file writes, so it covers the package's own
 * `import … from "react"`, but not the `react` that Radix imports from inside
 * the package's nested `node_modules`, which resolves to the copy sitting
 * right next to it. The first hook Radix calls then fails with "Cannot read
 * properties of null (reading 'useContext')".
 *
 * Deduping Radix itself fixes it at the root: the plugin's own copy wins, and
 * the React it pulls is the plugin's. Only the subpackages that actually build
 * a React context are listed — a package that merely re-exports markup cannot
 * split an instance in two. An alias on "react" does NOT work here: vitest
 * resolves imports made from inside node_modules before aliasing reaches them.
 *
 * This is a TEST-ONLY fix, and it is not the same thing as being safe at build
 * time. In the bundle the two Radix copies both survive (the host shims react
 * and ten Radix packages as of bb 0.43, and @radix-ui/react-tabs is not among
 * them) — they
 * cost bytes and nothing more, because Root/List/Trigger always come from one
 * of them. An OBJECT built by one copy and handed to the other is a different
 * matter and breaks in both places: see the note on onSave in
 * packages/code-editor/CodeEditor.tsx.
 */
export const radixDedupe = ["@radix-ui/react-tabs", "@radix-ui/react-direction"];

/**
 * The libraries packages/md-doc-view imports by value for its draft guard — a
 * Radix dialog and the host's diff viewer. The host shims both, so the bundle
 * never looks for them on disk; a test run does, from the package's folder,
 * where nothing is installed unless someone ran npm there. Resolved from the
 * plugin's root instead, which declares both, a plugin rendering MdDocView
 * tests the same whether or not the shared package has a node_modules.
 */
export const mdDocViewDedupe = ["@radix-ui/react-dialog", "@pierre/diffs"];
