import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { SavedView } from "../../shared/contract.js";
import { useSavedViews, useTasksRpc } from "../../shell/data.js";
import {
  applyFieldDisplay,
  type FieldDisplayConfig,
  type FieldScope,
} from "./row-field-preference.js";

export interface SavedViewsSectionProps {
  scope: FieldScope;
  /** The surface's live configuration — what "Save current view" captures. */
  config: FieldDisplayConfig;
}

/**
 * One row of confirmation pending in this section at a time: either "this
 * name is taken, replace it?" (from the naming row) or "delete this view?"
 * (from a view row). Both render through the same `ConfirmRow`, so there is
 * one confirmation flow rather than two near-identical copies.
 */
type PendingConfirm =
  | { kind: "replace"; name: string }
  | { kind: "delete"; view: SavedView };

function findByName(
  views: readonly SavedView[],
  name: string,
): SavedView | undefined {
  const needle = name.trim().toLowerCase();
  return views.find((view) => view.name.trim().toLowerCase() === needle);
}

function ConfirmRow({
  message,
  confirmLabel,
  cancelAriaLabel,
  confirmAriaLabel,
  destructive,
  onConfirm,
  onCancel,
}: {
  message: string;
  confirmLabel: string;
  /** Named after the message's subject — "Cancel"/"Delete" alone read fine
   * visually but say nothing in isolation to a screen reader. */
  cancelAriaLabel: string;
  confirmAriaLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-sm px-1.5 py-1 text-sm">
      <span className="flex-1 truncate text-muted-foreground">{message}</span>
      <button
        type="button"
        aria-label={cancelAriaLabel}
        onClick={onCancel}
        className="rounded-sm px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground"
      >
        Cancel
      </button>
      <button
        type="button"
        aria-label={confirmAriaLabel}
        // The row's own trigger (the deleted view's trash icon, or the
        // naming input) unmounts the instant this row appears, so the
        // popover — non-modal, does not trap focus — would otherwise drop a
        // keyboard user out to the document body.
        autoFocus
        onClick={onConfirm}
        className={cn(
          "rounded-sm px-1.5 py-0.5 text-xs hover:bg-state-hover",
          destructive ? "text-destructive" : "text-foreground",
        )}
      >
        {confirmLabel}
      </button>
    </div>
  );
}

function ViewRow({
  view,
  scope,
  onRequestDelete,
}: {
  view: SavedView;
  scope: FieldScope;
  onRequestDelete: (view: SavedView) => void;
}) {
  return (
    <div className="group flex items-center gap-1 rounded-sm">
      <button
        type="button"
        onClick={() => applyFieldDisplay(scope, view.config)}
        className="flex flex-1 items-center rounded-sm px-1.5 py-1 text-left text-sm hover:bg-state-hover"
      >
        <span className="flex-1 truncate">{view.name}</span>
      </button>
      <button
        type="button"
        aria-label={`Delete view ${view.name}`}
        onClick={() => onRequestDelete(view)}
        className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <Icon name="Trash2" className="size-3.5" />
      </button>
    </div>
  );
}

/**
 * Saved-views list inside the Display menu's popover: click a view's name to
 * apply it, "Save current view…" to name and store the surface's live
 * config, a hover-revealed trash icon to delete. Confirmation for both a
 * same-name save (replace) and a delete stays inline in the popover rather
 * than a Dialog — a Dialog's own outside-click handling would close this
 * popover and drop the pending confirmation before the user can act on it.
 */
export function SavedViewsSection({ scope, config }: SavedViewsSectionProps) {
  const rpc = useTasksRpc();
  const { data, error: loadError, isLoading, refresh } = useSavedViews(scope);
  const views = data ?? [];

  const [isNaming, setIsNaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const reportError = (thrown: unknown) =>
    setError(thrown instanceof Error ? thrown.message : String(thrown));

  const saveAs = (name: string) => {
    rpc
      .call("createSavedView", { scope, name, config })
      .then(() => {
        setError(null);
        setIsNaming(false);
        setNameDraft("");
        setPendingConfirm(null);
        refresh();
      })
      .catch(reportError);
  };

  const requestSave = () => {
    const name = nameDraft.trim();
    if (name === "") return;
    const existing = findByName(views, name);
    if (existing) {
      setPendingConfirm({ kind: "replace", name });
      return;
    }
    saveAs(name);
  };

  const cancelNaming = () => {
    setIsNaming(false);
    setNameDraft("");
    setPendingConfirm(null);
    setError(null);
  };

  const confirmDelete = (view: SavedView) => {
    rpc
      .call("deleteSavedView", { savedViewId: view.id })
      .then(() => {
        setError(null);
        setPendingConfirm(null);
        refresh();
      })
      .catch(reportError);
  };

  const canSubmitName = nameDraft.trim() !== "";
  // Loading only matters before the first response arrives; a refetch after
  // that keeps showing the last known list instead of flashing a skeleton.
  const showSkeleton = isLoading && data === undefined;

  return (
    <div className="flex flex-col">
      <p className="px-1.5 py-1 text-xs font-medium text-muted-foreground">
        Views
      </p>
      {showSkeleton ? (
        <div className="h-6 px-1.5 py-1" />
      ) : (
        views.map((view) =>
          pendingConfirm?.kind === "delete" &&
          pendingConfirm.view.id === view.id ? (
            <ConfirmRow
              key={view.id}
              message={`Delete "${view.name}"?`}
              confirmLabel="Delete"
              cancelAriaLabel={`Cancel deleting view ${view.name}`}
              confirmAriaLabel={`Confirm deleting view ${view.name}`}
              destructive
              onConfirm={() => confirmDelete(view)}
              onCancel={() => setPendingConfirm(null)}
            />
          ) : (
            <ViewRow
              key={view.id}
              view={view}
              scope={scope}
              onRequestDelete={(target) =>
                setPendingConfirm({ kind: "delete", view: target })
              }
            />
          ),
        )
      )}
      {isNaming ? (
        pendingConfirm?.kind === "replace" ? (
          <ConfirmRow
            message={`Replace "${pendingConfirm.name}"?`}
            confirmLabel="Replace"
            cancelAriaLabel={`Cancel replacing view ${pendingConfirm.name}`}
            confirmAriaLabel={`Confirm replacing view ${pendingConfirm.name}`}
            onConfirm={() => saveAs(pendingConfirm.name)}
            onCancel={() => setPendingConfirm(null)}
          />
        ) : (
          <div className="flex items-center gap-1 px-1.5 py-1">
            <Input
              autoFocus
              aria-label="View name"
              value={nameDraft}
              placeholder="View name"
              onChange={(event) => setNameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  requestSave();
                } else if (event.key === "Escape") {
                  // Radix's popover already closes on Escape (capture-phase
                  // document listener, ahead of this handler), which drops
                  // the naming row too — that is an acceptable way to cancel,
                  // so this branch only clears local state, nothing more.
                  cancelNaming();
                }
              }}
              className="h-6 flex-1 text-sm"
            />
            <button
              type="button"
              aria-label="Save view"
              disabled={!canSubmitName}
              onClick={requestSave}
              className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-state-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <Icon name="Check" className="size-3.5" />
            </button>
          </div>
        )
      ) : (
        <button
          type="button"
          onClick={() => {
            setIsNaming(true);
            setError(null);
          }}
          className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left text-sm text-muted-foreground hover:bg-state-hover hover:text-foreground"
        >
          <Icon name="Plus" className="size-3.5" />
          Save current view…
        </button>
      )}
      {error ?? loadError ? (
        <p role="alert" className="px-1.5 py-1 text-xs text-destructive">
          {error ?? loadError}
        </p>
      ) : null}
    </div>
  );
}
