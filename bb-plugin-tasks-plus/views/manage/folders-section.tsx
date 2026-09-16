import { useCallback, useEffect, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { FoldersRpcContract, SyncedFolder } from "../../folders/contract.js";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { AddFolderDialog } from "./add-folder-dialog.js";
import { RemoveFolderDialog } from "./remove-folder-dialog.js";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function FolderRow({
  folder,
  onRemove,
}: {
  folder: SyncedFolder;
  onRemove: () => void;
}) {
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
        </div>
      </div>
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
 * Connected folders: repo folders of markdown tasks a board reads directly
 * — files are the source of truth, read fresh on every request, so there is
 * no sync status or sync-now action here (see decisions/tasks-files-are-
 * the-store.md).
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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Repository folders of markdown tasks, read directly by a board.
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
            onRemove={() => setRemoveTarget(folder)}
          />
        ))}
        {folders !== null && folders.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">
            No connected folders yet.
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
