import { useEffect, useState } from "react";
import { DEFAULT_COLUMN_WIDTH_BOUNDS, type ColumnWidthBounds } from "../../shared/board-column-width.js";
import { useTasksRpc } from "../../client/data.js";

/**
 * The owner's column width bounds from the settings: the old 200 / 480 / 230
 * until they arrive, and for good if they cannot be read — a board drawn at
 * the usual widths is the safe way to fail.
 */
export function useColumnWidthBounds(): ColumnWidthBounds {
  const rpc = useTasksRpc();
  const [bounds, setBounds] = useState<ColumnWidthBounds>(DEFAULT_COLUMN_WIDTH_BOUNDS);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const stored = await rpc.call("loadColumnWidthBounds", {});
        if (live) setBounds(stored);
      } catch {
        // Kept the defaults: the settings page says when the stored bounds are unreadable.
      }
    })();
    return () => {
      live = false;
    };
  }, [rpc]);
  return bounds;
}
