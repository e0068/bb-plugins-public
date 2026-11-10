// Layer 1 — the marks a portaled node carries. Portaled nodes live outside the
// plugin's root, so they carry the same marks the root does — the host scopes
// plugin chrome and its in-app links by them. Shared by every dialog of the
// package: the draft guard and the file's rename and delete.

declare const __BB_PLUGIN_ID__: string | undefined;

export const portalScope = {
  "data-bb-portaled-overlay": "",
  "data-bb-plugin-root": "",
  ...(typeof __BB_PLUGIN_ID__ === "string" ? { "data-bb-plugin": __BB_PLUGIN_ID__ } : {}),
};
