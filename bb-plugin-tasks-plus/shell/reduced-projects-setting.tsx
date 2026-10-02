// The row under the Reduced Colors block: whether the ramp repaints the
// analytics' projects too, or each keeps the colour set on it. Tasks+'s own
// choice, stored apart from the shared setting (shared/reduced-projects.ts).
import { useEffect, useState } from "react";

import type { ReducedProjects } from "../shared/reduced-projects.js";
import { CheckboxField } from "../views/manage/shared.js";
import { useTasksRpc } from "./data.js";

/** Still asking, could not read the stored choice, or the choice shown. */
type Loaded = { readonly kind: "loading" } | { readonly kind: "failed" } | { readonly kind: "ready"; readonly value: ReducedProjects };

export function ReducedProjectsSetting() {
  const rpc = useTasksRpc();
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    let live = true;
    rpc.call("loadReducedProjects", {}).then(
      (value) => live && setLoaded({ kind: "ready", value }),
      // A default shown as if stored would overwrite the owner's choice on the first click.
      () => live && setLoaded({ kind: "failed" }),
    );
    return () => {
      live = false;
    };
  }, [rpc]);

  switch (loaded.kind) {
    case "loading":
      return null;
    case "failed":
      return (
        <p role="alert" className="pt-3 text-xs text-destructive">
          Could not load whether projects are repainted. Reopen the settings to try again.
        </p>
      );
    case "ready":
      break;
  }

  const choose = (value: ReducedProjects) => {
    setLoaded({ kind: "ready", value });
    rpc.call("saveReducedProjects", { value }).then(
      () => setSaveFailed(false),
      () => setSaveFailed(true),
    );
  };

  return (
    <div className="flex flex-col gap-1 border-t border-border pt-3">
      <CheckboxField checked={loaded.value === "ramp"} onCheckedChange={(checked) => choose(checked ? "ramp" : "own")} label="Repaint projects too" />
      <p className="text-xs text-muted-foreground">Off — each project keeps the colour set on it.</p>
      {saveFailed && (
        <p role="alert" className="text-xs text-destructive">
          Could not save — the last change is not stored.
        </p>
      )}
    </div>
  );
}
