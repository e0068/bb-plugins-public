# viewport-clamp

Keeps a tooltip placed by the pointer inside the window, 8 px from every edge — the same padding Radix tooltips of the plugins keep through `collisionPadding`.

- `clampToViewport(natural, size, viewport, margin?)` in [core.ts](core.ts) — pure: the top-left corner closest to `natural` at which a box stays inside the window. A box bigger than the window is pinned to the left or top margin.
- `useViewportClamp(natural)` in [react.ts](react.ts) — renders the tooltip where the pointer put it, measures it and moves it back inside before the browser paints. Pass the pointer plus your offset, put `ref` on the tooltip and `position` into its `left`/`top`.

```tsx
const { ref, position } = useViewportClamp<HTMLDivElement>({ x: pointer.x + 12, y: pointer.y + 12 });
return <div ref={ref} role="tooltip" className="fixed" style={{ left: position.x, top: position.y }} />;
```

Plugins import it as `@bb-plugins/viewport-clamp` (see [plugin-base](../plugin-base/README.md)). The package imports only `react`, which the host shims, so a plugin installed from git bundles it — [git-install.test.ts](git-install.test.ts) keeps it that way.

## The guard

[repo-guard.test.ts](repo-guard.test.ts) reads every plugin and package and fails the run when:

- a `.tsx` file renders `role="tooltip"` without importing `@bb-plugins/viewport-clamp`;
- a file using `@radix-ui/react-tooltip` or `@radix-ui/react-hover-card` passes no `collisionPadding` or turns `avoidCollisions` off.

A hand-placed tooltip therefore carries `role="tooltip"` and goes through the hook; a Radix one keeps its collision handling. The rules read whole files as text: a tooltip at the pointer without `role="tooltip"` passes unseen, and the guard runs only with this package's tests — run them after touching a tooltip anywhere in the repo.
