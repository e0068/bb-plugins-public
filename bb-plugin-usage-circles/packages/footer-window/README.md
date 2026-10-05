# footer-window

One window for every plugin item in BB's sidebar footer: hover opens an item's window, a click on the item or inside the window pins it, only a click on its item closes it again, a click on another item pins that one instead, a pinned window resizes by its top edge, and hovering another item while one is pinned shows that item's window in its place, at the pinned window's height, until the pointer leaves; with nothing pinned a hovered window hugs its content. The window opens at once, with no animation: each plugin draws its header right away and fills the content in as it loads. A hovered window closes the moment the pointer moves past the footer; only in the footer's own gaps and in an open overflow menu does it wait a moment, so the pointer can cross from the item to the window. BB's rounded frame around the window becomes the thin line BB draws under the top menu.

- [core.ts](core.ts) — pure: `step(state, event)` — what hover, leave, click, a click inside the window and close do to the one pinned and the one shown window, and which disclosure to open or close; `windowHeight` — the pinned window's own height, the pinned one's height for a window shown over it, hugging otherwise; `dragHeight` and the stored-height codec; `pluginSettingsPath` — the plugin's page in Tools, for the settings action in a window's header.
- [footer-window.tsx](footer-window.tsx) — the DOM and React shell:
  - `registerFooterWindow({ pluginId, itemId, label }, controller)` — call in the plugin's setup with the controller `experimental_sidebarFooter.register({ kind: "disclosure" })` returned;
  - `withFooterWindow(Component, { pluginId, itemId })` — wrap the item's disclosure component: the frame restyle, the height (remembered per item in `localStorage`, hugging the content until dragged) and the resize handle on a pinned window;
  - `useOpenOnHover(pluginId, enabled)` — from an invisible overlay that reads the plugin's "Open on hover" setting.

```tsx
const item = { pluginId: "archived-sidebar", itemId: "archived" };
const controller = app.experimental_sidebarFooter.register({ kind: "disclosure", id: item.itemId, label: "Archived", icon: "Archive", component: withFooterWindow(Panel, item) });
registerFooterWindow({ ...item, label: "Archived" }, controller);
```

Every plugin bundle carries its own copy of this package, while the window is one per app: the state, the controllers and the document listeners live in a registry on `globalThis` under `Symbol.for("bb-plugins.footer-window.v1")`, and the first plugin to register installs the listeners. BB draws the footer and the window frame outside any plugin root, so the styles here are inline, on BB's theme tokens.

Plugins import it as `@bb-plugins/footer-window` (see [plugin-base](../plugin-base/README.md)). The package imports only `react`, which the host shims, so a plugin installed from git bundles it — [git-install.test.ts](git-install.test.ts) keeps it that way.

Used by [bb-plugin-archived-sidebar](../../bb-plugin-archived-sidebar), [bb-plugin-connection](../../bb-plugin-connection), [bb-plugin-notifications](../../bb-plugin-notifications) and [bb-plugin-usage-circles](../../bb-plugin-usage-circles); why — [sidebar-footer-ring-items](../../docs/decisions/sidebar-footer-ring-items.md).
