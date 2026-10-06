// The settings page's Board columns block: the narrowest and widest a board
// column may be dragged, and how wide an untouched one starts. Three whole
// numbers of pixels, kept when a field is left and only if they fit together
// (shared/board-column-width.ts).
import { useEffect, useId, useState } from "react";

import { Input } from "@/components/ui/input";
import { checkColumnWidthBounds, type ColumnWidthBounds } from "../shared/board-column-width.js";
import { useTasksRpc } from "./data.js";

/** Still asking, could not read the stored bounds, or the bounds shown. */
type Loaded =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly bounds: ColumnWidthBounds };

type Field = keyof ColumnWidthBounds;

const FIELDS: ReadonlyArray<{ readonly field: Field; readonly label: string }> = [
  { field: "min", label: "Minimum width" },
  { field: "initial", label: "Default width" },
  { field: "max", label: "Maximum width" },
];

/** What was typed → a number; nothing typed is not a number, and not 0. */
const toNumber = (text: string): number => (text.trim() === "" ? Number.NaN : Number(text));

const sameBounds = (a: ColumnWidthBounds, b: ColumnWidthBounds): boolean =>
  a.min === b.min && a.initial === b.initial && a.max === b.max;

const toDraft = (bounds: ColumnWidthBounds): Record<Field, string> => ({
  min: String(bounds.min),
  initial: String(bounds.initial),
  max: String(bounds.max),
});

export function BoardColumnWidthSetting() {
  const rpc = useTasksRpc();
  const idPrefix = useId();
  const problemId = `${idPrefix}-problem`;
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [draft, setDraft] = useState<Record<Field, string> | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const bounds = await rpc.call("loadColumnWidthBounds", {});
        if (!live) return;
        setLoaded({ kind: "ready", bounds });
        setDraft(toDraft(bounds));
      } catch {
        // Defaults shown as if stored would overwrite the owner's choice on the first save.
        if (live) setLoaded({ kind: "failed" });
      }
    })();
    return () => {
      live = false;
    };
  }, [rpc]);

  if (loaded.kind === "failed") return failure();
  if (loaded.kind === "loading" || draft === null) return null;

  const commit = () => {
    const checked = checkColumnWidthBounds({
      min: toNumber(draft.min),
      initial: toNumber(draft.initial),
      max: toNumber(draft.max),
    });
    if (!checked.ok) {
      setProblem(checked.reason);
      return;
    }
    setProblem(null);
    setDraft(toDraft(checked.bounds));
    if (sameBounds(loaded.bounds, checked.bounds)) return;
    rpc.call("saveColumnWidthBounds", checked.bounds).then(
      () => {
        setLoaded({ kind: "ready", bounds: checked.bounds });
        setSaveFailed(false);
      },
      () => setSaveFailed(true),
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-3">
        {FIELDS.map(({ field, label }) => (
          <div key={field} className="flex flex-col gap-1">
            <label htmlFor={`${idPrefix}-${field}`} className="text-xs text-muted-foreground">
              {label}
            </label>
            <div className="flex items-center gap-1.5">
              <Input
                id={`${idPrefix}-${field}`}
                type="text"
                inputMode="numeric"
                className="w-24"
                aria-invalid={problem !== null}
                aria-describedby={problem !== null ? problemId : undefined}
                value={draft[field]}
                onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
                onBlur={commit}
              />
              <span className="text-xs text-muted-foreground">px</span>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        How narrow and how wide a board column may be dragged, and how wide a column starts. Saved when you leave a field.
      </p>
      {problem !== null && (
        <p id={problemId} role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}
      {saveFailed && (
        <p role="alert" className="text-xs text-destructive">
          Could not save — the last change is not stored.
        </p>
      )}
    </div>
  );
}

function failure() {
  return (
    <p role="alert" className="text-xs text-destructive">
      Could not load the column width bounds. Reopen the settings to try again.
    </p>
  );
}
