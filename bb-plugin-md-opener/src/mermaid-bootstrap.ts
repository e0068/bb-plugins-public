// Kasimov's own mermaid renderer (packages/kasimov/kasimov.js,
// createMermaidRenderer) never bundles a library — it reads one off
// window.Mermaid (capital M) and expects a CDN <script> to have put it there.
// This module is the plugin's side of that contract.
//
// Lives in the plugin, not packages/md-doc-view: mermaid is bb-plugin-md-opener's
// own dependency, installed into ITS node_modules only — a bare import from the
// shared package wouldn't resolve through the plugin bundler (the same wall
// memory/decisions/md-opener-vendor-kasimov.md hit vendoring "kasimov" itself).
import mermaid from "mermaid";

declare global {
  interface Window {
    Mermaid?: unknown;
  }
}

export function installMermaid(target: { Mermaid?: unknown }): void {
  target.Mermaid = mermaid;
}
