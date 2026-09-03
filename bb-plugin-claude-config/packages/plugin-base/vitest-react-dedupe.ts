// Plugins that import React components from ../packages/* (see
// packages/md-editor, packages/resizable-pane) pull "react" from the
// package's node_modules, not the plugin's. Vite resolves bare imports by
// walking up from the importing file — for a file outside the plugin's tree
// this never reaches the plugin's own node_modules, and you end up with two
// copies of React: hooks fail with "Cannot read properties of null (reading
// 'useState')". dedupe forces all three modules to resolve from the plugin's
// root. Only needed in tests — esbuild dedupes on its own at build time.
export const reactDedupe = ["react", "react-dom", "react/jsx-runtime"];
