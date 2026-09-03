// Side-effect import of the editor's CSS (`import "../kasimov/kasimov.css"`).
// The bundler puts the css into the bundle; for typecheck we declare a css
// module with no exports. The kasimov engine's own types live next to its
// build: packages/kasimov/kasimov.d.ts (picked up via a relative import).
declare module "*.css";
