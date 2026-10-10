# footer-window

One window for every plugin item in BB's sidebar footer: hover opens an item's window, only the pin in the window's header pins it — at the height the window shows at that moment — and only the pin again unpins it — a click on the item never pins: it opens a closed window like hover does and leaves a shown one, hovered or pinned, as it is; a pinned window BB closes by itself — Escape, a window of BB's own footer, a plugin reload — waits off screen and comes back as soon as no window is open in the footer — through the item's new controller after a reload, and forgotten when its window does not come back, its plugin turned off; the pinned pin is drawn as a filled glyph with no background under it; a pinned window resizes by its top edge, and hovering another item while one is pinned shows that item's window in its place, at its own height, until the pointer leaves. The window opens at once, with no animation: its header is drawn right away and the content fills in as it loads. A hovered window closes the moment the pointer moves past the footer; only in the footer's own gaps and in an open overflow menu does it wait a moment, so the pointer can cross from the item to the window. BB's rounded frame around the window becomes a line in BB's sidebar border colour, and the window spans the sidebar edge to edge, so the pin in its header sits as far from the panel's edge as from that line.

- [core.ts](core.ts) — pure: `step(state, event)` — what hover, leave, a click, the pin, BB's close, the plugin's dismiss and a free footer do to the one pinned and the one shown window, and which disclosure to open or close; `present` and `release` — a window the plugin opens itself and lets go; `dragHeight` and the stored-height codec; `pluginSettingsPath` — the plugin's page in BB's settings, where its settings sections render.
- [footer-window.tsx](footer-window.tsx) — the DOM and React shell:
  - `registerFooterWindow({ pluginId, itemId, label }, controller)` — call in the plugin's setup with the controller `experimental_sidebarFooter.register({ kind: "disclosure" })` returned;
  - `withFooterWindow(Component, { pluginId, itemId })` — wrap the item's disclosure component: the frame restyle, the height (remembered per item in `localStorage`, hugging the content until dragged) and the resize handle on a pinned window;
  - `usePinned` and `togglePin` — the pin's state and press, for the header;
  - `useHoldHeight()` — for content that swaps in place (Notifications' Show read): keeps the window at the height it shows now, unpinned, until it closes, so it neither jumps nor grows over the thread list;
  - `useOpenOnHover(pluginId, enabled)` — from an invisible overlay that reads the plugin's "Open on hover" setting.
  - `dismissFooterWindow(item)` — the plugin hides the item from the footer (Usage Limits when its layout changes): its window closes and its pin is forgotten, so it does not come back.
  - `presentFooterWindow(item)` and `releaseFooterWindow(item)` — the plugin opens its window by itself for the time something runs (Aloud while it reads) and lets it go: the window takes the pin's place, so moving the pointer away keeps it, while its header shows it unpinned; at release it closes, or the window pinned before it comes back; the pin in its header keeps it open past the release. Until pinned it hugs its content and has no resize handle. A record the package's older copies leave behind when they close it is dropped by the pin.

```tsx
const item = { pluginId: "archived-sidebar", itemId: "archived" };
const controller = app.experimental_sidebarFooter.register({ kind: "disclosure", id: item.itemId, label: "Archived", icon: "Archive", component: withFooterWindow(Panel, item) });
registerFooterWindow({ ...item, label: "Archived" }, controller);
```

- [window-view.tsx](window-view.tsx) — `FooterWindow`, the one window every plugin draws in: `FooterWindowHeader` — an optional leading icon (a provider's logo in Usage Circles), the title, a count — a number or words like Aloud's "3 queued", kept whole next to a long title —, the plugin's actions, the way to its settings and the pin — over the plugin's content.

```tsx
<FooterWindow icon={logo} title="Notifications" count={3} actions={[{ id: "read-all", label: "Mark all read", icon, onClick }]}>
  {list}
</FooterWindow>
```

Every plugin bundle carries its own copy of this package, while the window is one per app: the state, the controllers and the document listeners live in a registry on `globalThis` under `Symbol.for("bb-plugins.footer-window.v1")`, and the first plugin to register installs the listeners. BB draws the footer and the window frame outside any plugin root, so the styles here are inline, on BB's theme tokens.

Plugins import it as `@bb-plugins/footer-window` (see [plugin-base](../plugin-base/README.md)). The package imports only `react`, which the host shims, so a plugin installed from git bundles it — [git-install.test.ts](git-install.test.ts) keeps it that way.

Used by [bb-plugin-archived-sidebar](../../bb-plugin-archived-sidebar), [bb-plugin-connection](../../bb-plugin-connection), [bb-plugin-notifications](../../bb-plugin-notifications), [bb-plugin-read-aloud](../../bb-plugin-read-aloud) and [bb-plugin-usage-circles](../../bb-plugin-usage-circles); why — [sidebar-footer-ring-items](../../docs/decisions/sidebar-footer-ring-items.md).
