# rail-collapse

Two things a plugin page reached from bb's left rail can do, each behind its own boolean setting of the plugin; Tasks+, Usage Analytics and Flow use both. **Collapse the threads panel** when the owner opens the plugin from the rail, and open it again when they leave for a thread. **Show the selected thread**: the page opens on the item of the thread the owner came from — its task, flow or usage — and a click on a thread in the threads panel switches the page to it instead of leaving for the thread, and the selected thread's row is highlighted there the way bb highlights an open thread.

- [core.ts](core.ts) — pure: `railStep(memory, event)` decides from a rail click, a route change or a hand toggle whether to collapse, expand or do nothing. The panel is reopened only if the rail collapsed it, and moving between two plugins that joined keeps it collapsed — no flash.
- [dom.ts](dom.ts) — the shell: `joinRailCollapse(pluginId, env)` reads the panel state from bb's sidebar markup, clicks bb's own trigger, records rail clicks (`data-nav-rail-item`) and follows routes through the Navigation API, polling the path where there is none. Any change of the panel's `data-state` it did not cause itself — the button, bb's hotkey — counts as the owner's hand toggle. bb has no plugin API for the panel, so these selectors follow bb's DOM. One hub per window serves every plugin bundle that joined, keyed by a global symbol, so a navigation is decided once.
- [react.ts](react.ts) — `registerRailCollapse(app, pluginId, useSettings)` registers an app overlay that joins the hub while the setting is on; `registerSelectedThread(app, pluginId, useSettings)` registers one that makes the plugin follow the selection; `useFollowSelectedThread(useSettings, enteredAtRoot, { resolve, openThread })` is the page's side — `resolve(threadId)` answers the page's own navigation to the thread's item, or null when it has none; a picked thread without one goes to `openThread`. Only the latest answer of a page still open moves it. The plugin passes its own `app` and `useSettings`, so the package imports nothing from the SDK; an SDK without app overlays registers nothing.
- [selection.ts](selection.ts) — pure: which thread is selected — `routed` moves it with bb's routes: a thread page (`/threads/<id>`, or `/projects/<projectId>/threads/<id>` for a project's thread) selects its thread, a following plugin's page keeps it, any other page drops it; `pick` is a thread clicked in the panel — and `followStep`, when a page follows it: once on entry at its root, then on every pick.
- [selection-dom.ts](selection-dom.ts) — the shell: the selection kept once per window under a global symbol; while a plugin follows it, every route moves it, and a plain click on a threads-panel row (`data-sidebar-thread-id`) made on that plugin's page is taken from bb and becomes a pick; on that page a `<style data-bb-selected-thread>` rule gives the selected thread's row bb's own selected-row background — `--state-active` laid over the panel's `--sidebar` fill (`markedThread` in selection.ts says which thread).
- [membership.ts](membership.ts) — the per-plugin join count both window hubs share.
- [setting.ts](setting.ts) — the settings' keys and descriptors, spread into the plugin's `bb.settings.define`. Off by default ([decision](../../docs/decisions/rail-collapse-default-off.md)).

```ts
// server.ts
bb.settings.define({ ...railCollapseSetting, ...selectedThreadSetting("the flow") });
// app.tsx
registerRailCollapse(app, "flow", useSettings);
registerSelectedThread(app, "flow", useSettings);
// the page
useFollowSelectedThread(useSettings, subPath === "", {
  resolve: (threadId) => rpc.call("threadFlow", { threadId }).then(({ flowId }) => (flowId === null ? null : () => openFlow(flowId))),
  openThread: (threadId) => navigate.toThread(threadId),
});
```

Plugins import it as `@bb-plugins/rail-collapse` (server: `@bb-plugins/rail-collapse/setting`, see [plugin-base](../plugin-base/README.md)). The package imports only `react`, which the host shims — [git-install.test.ts](git-install.test.ts) keeps it that way.
