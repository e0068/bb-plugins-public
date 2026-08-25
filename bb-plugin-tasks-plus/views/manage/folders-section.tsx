import { useCallback, useEffect, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { FoldersRpcContract, SyncedFolder } from "../../folders/contract.js";
import { formatRelativeTime } from "../detail/meta.js";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { AddFolderDialog } from "./add-folder-dialog.js";
import { RemoveFolderDialog } from "./remove-folder-dialog.js";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function StatusPill({ status }: { status: SyncedFolder["status"] }) {
  switch (status.kind) {
    case "not_synced":
      return (
        <span className="text-xs text-muted-foreground">Not synced yet</span>
      );
    case "syncing":
      return (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Icon name="RotateCcw" className="size-3 animate-spin" />
          Syncing…
        </span>
      );
    case "synced": {
      const hasInvalid = status.invalidFiles.length > 0;
      const counts = `Created ${status.summary.created} · Updated ${status.summary.updated} · Adopted ${status.summary.adopted} · Deleted ${status.summary.deleted}`;
      const title = hasInvalid
        ? [
            `${counts} · Invalid ${status.invalidFiles.length}`,
            ...status.invalidFiles.map((file) => `${file.path} — ${file.reason}`),
          ].join("\n")
        : counts;
      return (
        <span
          className={cn(
            "flex items-center gap-1 text-xs",
            hasInvalid ? "text-destructive" : "text-muted-foreground",
          )}
          title={title}
        >
          <Icon
            name={hasInvalid ? "AlertCircle" : "CircleCheck"}
            className={cn("size-3", !hasInvalid && "text-success")}
          />
          Synced {formatRelativeTime(status.syncedAt)}
          {hasInvalid ? ` · ${status.invalidFiles.length} invalid` : null}
        </span>
      );
    }
    case "error":
      return (
        <span
          className="flex items-center gap-1 text-xs text-destructive"
          title={status.message}
        >
          <Icon name="AlertCircle" className="size-3" />
          Sync error
        </span>
      );
  }
}

function FolderRow({
  folder,
  onSynced,
  onRemove,
}: {
  folder: SyncedFolder;
  onSynced: () => void;
  onRemove: () => void;
}) {
  const rpc = useRpc<FoldersRpcContract>();
  const [syncing, setSyncing] = useState(false);
  const isSyncing = syncing || folder.status.kind === "syncing";

  const syncNow = async () => {
    setSyncing(true);
    try {
      await rpc.call("syncFolderNow", { projectId: folder.projectId });
    } finally {
      setSyncing(false);
      onSynced();
    }
  };

  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <Icon name="FolderGit" className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm">
          <span className="truncate font-medium">{folder.tasksFolder}</span>
          <span className="text-muted-foreground">·</span>
          <span className="truncate text-muted-foreground">
            {folder.linkedBbProjectName ?? folder.linkedBbProjectId}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
          <span>
            {folder.projectName} ({folder.projectPrefix}) · {folder.taskCount}{" "}
            task{folder.taskCount === 1 ? "" : "s"}
          </span>
          <span>·</span>
          <StatusPill status={folder.status} />
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-7 shrink-0"
        disabled={isSyncing}
        onClick={() => void syncNow()}
      >
        <Icon
          name="RotateCcw"
          className={cn("size-3.5", isSyncing && "animate-spin")}
        />
        Sync now
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
        aria-label={`Remove ${folder.tasksFolder}`}
        onClick={onRemove}
      >
        <Icon name="Trash2" className="size-3.5" />
      </Button>
    </div>
  );
}

/**
 * Connected sync folders: repo folders of markdown tasks mirrored onto a
 * board, with per-folder sync status and add/remove/sync-now actions.
 * Replaces the previous org-folder (grouping-only) tab — that concept still
 * lives in the database but has no UI surface anymore.
 */
export function FoldersSection() {
  const rpc = useRpc<FoldersRpcContract>();
  const [folders, setFolders] = useState<SyncedFolder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<SyncedFolder | null>(null);

  const refresh = useCallback(() => {
    rpc.call("listSyncedFolders", null).then(
      (result) => setFolders(result.folders),
      (fetchError: unknown) => setError(describeError(fetchError)),
    );
  }, [rpc]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useRealtime("projects:changed", refresh);
  useRealtime("folderSync:changed", refresh);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Repository folders of markdown tasks, synced to a board.
        </p>
        <Button size="sm" className="h-7" onClick={() => setAddOpen(true)}>
          <Icon name="Plus" className="size-3.5" />
          Add folder
        </Button>
      </div>
      <div className="divide-y divide-border-hairline rounded-md border border-border">
        {(folders ?? []).map((folder) => (
          <FolderRow
            key={folder.projectId}
            folder={folder}
            onSynced={refresh}
            onRemove={() => setRemoveTarget(folder)}
          />
        ))}
        {folders !== null && folders.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">
            No synced folders yet.
          </p>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <AddFolderDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onConnected={refresh}
      />
      {removeTarget ? (
        <RemoveFolderDialog
          folder={removeTarget}
          open
          onOpenChange={(open) => {
            if (!open) setRemoveTarget(null);
          }}
          onRemoved={refresh}
        />
      ) : null}
    </div>
  );
}
