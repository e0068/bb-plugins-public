# @bb-plugins/resizable-pane

Draggable width for a plugin's navPanel second column.

Came about as a replacement for `experimental_fixedTabs`: in bb 0.40.0 a
navPanel with that option doesn't mount and the item disappears from the
sidebar (see task BP-53). Content that used to live as a fixed tab in the
host's right panel with its own divider is moved into a second column inside
the panel itself — and this package provides the draggable width.

## Usage

```tsx
import { ResizeHandle, useResizableWidth } from "../packages/resizable-pane/react";

function Panel({ subPath }: PluginNavPanelProps) {
  const { width, startResize } = useResizableWidth({
    initial: 420,
    min: 320,
    max: 900,
    storageKey: "my-plugin:doc-pane-width",
  });
  const open = /* something is selected */;
  return (
    <div className="flex h-full min-h-0">
      <div className="min-h-0 flex-1 overflow-y-auto">…main content…</div>
      {open && (
        <>
          <ResizeHandle onPointerDown={startResize} />
          <div style={{ width }} className="h-full min-h-0 shrink-0 overflow-hidden">
            …second column…
          </div>
        </>
      )}
    </div>
  );
}
```

Handle on the left side of the right pane: drag left — the pane gets wider.
The width is clamped to `[min, max]` and (if `storageKey` is given)
remembered in `localStorage`.

Pure geometry (`geometry.ts`) is separated from the DOM and covered by tests
(`geometry.test.ts`).
