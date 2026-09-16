# @bb-plugins/panel-state

Panel state that survives leaving the panel — and restarting the app.

A bb navPanel unmounts when you navigate away, so everything it held in React
state is gone by the time you come back: the section you were in, the project
you had open, the file you were reading.

```tsx
import { useRememberedRoute } from "../packages/panel-state/react";

useRememberedRoute(PANEL_PATH, subPath, (next) =>
  navigate.toPluginPanel(PANEL_PATH, { subPath: next, replace: true }),
);
```

**The route is the state.** One key per panel, constant; everything that
varies within a panel — the area, the section, the open file — belongs in the
route itself. That is what makes each place a link and lets Back walk through
them; a second carrier alongside the route buys nothing and has to be kept in
step (memory/decisions/panel-route-grammar.md).

**Reading is parsing.** The browser profile outlives builds, so a stored route
that a panel can no longer read costs only what it can't read — the panel
falls back rather than opening something that isn't there.

**Restoring is one-shot, and it beats nothing.** A deep link into a file wins
over the memory, and the empty route a panel mounts with is not recorded — it
would erase the memory being restored. Both rules are
[route-memory.ts](route-memory.ts), tested apart from React.
