import { useCallback, useEffect, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { FoldersRpcContract, SyncedFolder, SyncedSource } from "../../folders/contract.js";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { databaseHost } from "../../folders/database-address.js";
import { AddFolderDialog } from "./add-folder-dialog.js";
import { ConnectDatabaseDialog } from "./connect-database-dialog.js";
import { RemoveFolderDialog } from "./remove-folder-dialog.js";
import { taskCountText } from "./shared.js";
import { DetailToasts, useDetailToasts } from "../detail/toast.js";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type DatabaseSource = Extract<SyncedSource, { kind: "database" }>;

const LINK_DOT: Record<DatabaseSource["state"], string> = {
  live: "bg-success",
  reconnecting: "bg-warning",
  offline: "bg-destructive",
};

const LINK_TEXT: Record<DatabaseSource["state"], string> = {
  live: "text-success",
  reconnecting: "text-warning",
  offline: "text-destructive",
};

const formatMoment = (iso: string): string => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

/** The link of a database board in words: what the person needs to know, and no more. */
function linkText(source: DatabaseSource): string {
  switch (source.state) {
    case "live":
      return "Live";
    case "reconnecting":
      return "Reconnecting…";
    case "offline":
      return source.lastSyncAt === null ? "Unreachable · not synced yet" : `Unreachable · last sync ${formatMoment(source.lastSyncAt)}`;
  }
}

const INVITE_COPIED = "Invite copied — paste it into Connect database on the other machine.";

/** A quiet icon button at the end of a source row. */
function RowAction({ label, icon, danger, onClick }: { label: string; icon: "Share" | "Trash2"; danger?: boolean; onClick: () => void }) {
  return (
    <Button
      size="icon"
      variant="ghost"
      className={`size-7 shrink-0 text-muted-foreground ${danger ? "hover:text-destructive" : "hover:text-foreground"}`}
      aria-label={label}
      onClick={onClick}
    >
      <Icon name={icon} className="size-3.5" />
    </Button>
  );
}

function DatabaseRow({
  folder,
  source,
  onShare,
  onRemove,
}: {
  folder: SyncedFolder;
  source: DatabaseSource;
  onShare: () => void;
  onRemove: () => void;
}) {
  const host = databaseHost(source.url);
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <Icon name="Container" className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm">
          <span className="truncate font-medium">{host}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
          <span>
            {folder.projectName} ({folder.projectPrefix}) · {taskCountText(folder.taskCount)}
          </span>
          <span className="text-muted-foreground">·</span>
          <span className={`inline-flex items-center gap-1 ${LINK_TEXT[source.state]}`}>
            <span aria-hidden className={`size-1.5 rounded-full ${LINK_DOT[source.state]}`} />
            {linkText(source)}
          </span>
        </div>
      </div>
      <RowAction label={`Share an invite to ${host}`} icon="Share" onClick={onShare} />
      <RowAction label={`Remove ${host}`} icon="Trash2" danger onClick={onRemove} />
    </div>
  );
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
      <RowAction label={`Remove ${folder.tasksFolder}`} icon="Trash2" danger onClick={onRemove} />
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
  const [connectOpen, setConnectOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<SyncedFolder | null>(null);
  const { toasts, push, dismiss } = useDetailToasts();

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

  /** Puts the invite of a database board on the clipboard, or says why it cannot. */
  const share = async (folder: SyncedFolder) => {
    try {
      const result = await rpc.call("databaseInvite", { boardId: folder.projectId });
      if (!result.ok) return push("error", result.error.message);
      await navigator.clipboard.writeText(result.invite);
      push("info", INVITE_COPIED);
    } catch (shareError) {
      push("error", describeError(shareError));
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Repository folders of markdown tasks and online databases, read directly by a board.
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-7" onClick={() => setAddOpen(true)}>
            <Icon name="Plus" className="size-3.5" />
            Add folder
          </Button>
          <Button size="sm" variant="outline" className="h-7" onClick={() => setConnectOpen(true)}>
            <Icon name="Container" className="size-3.5" />
            Connect database
          </Button>
        </div>
      </div>
      <div className="divide-y divide-border-hairline rounded-md border border-border">
        {(folders ?? []).map((folder) =>
          folder.source.kind === "database" ? (
            <DatabaseRow
              key={folder.projectId}
              folder={folder}
              source={folder.source}
              onShare={() => void share(folder)}
              onRemove={() => setRemoveTarget(folder)}
            />
          ) : (
            <FolderRow
              key={folder.projectId}
              folder={folder}
              onRemove={() => setRemoveTarget(folder)}
            />
          ),
        )}
        {folders !== null && folders.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">
            No connected folders or databases yet.
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
      <ConnectDatabaseDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
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
      <DetailToasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
