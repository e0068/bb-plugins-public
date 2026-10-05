import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { TOKEN_REFUSED_TEXT, type FoldersRpcContract, type SyncedFolder, type SyncedSource } from "../../folders/contract.js";
import { databaseHost } from "../../folders/database-address.js";
import { Button } from "@/components/ui/button";

type DatabaseSource = Extract<SyncedSource, { kind: "database" }>;

/** A board of the scope whose database is not answering. */
interface PausedBoard {
  boardId: string;
  source: DatabaseSource;
}

/** The boards of the scope that lost their database; folder boards and live databases are not among them. */
function pausedBoards(folders: readonly SyncedFolder[], projectIds: readonly string[]): PausedBoard[] {
  return folders.flatMap((folder) =>
    projectIds.includes(folder.projectId) && folder.source.kind === "database" && folder.source.state !== "live"
      ? [{ boardId: folder.projectId, source: folder.source }]
      : [],
  );
}

const formatMoment = (iso: string): string => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

const lastSyncText = (source: DatabaseSource): string =>
  source.lastSyncAt === null ? "not synced yet" : `last sync ${formatMoment(source.lastSyncAt)}`;

/**
 * Above the columns of a board whose database is unreachable or reconnecting:
 * says taking and editing is paused and lets the owner retry at once. Draws
 * nothing for a live database, a folder board, or when the list cannot be read.
 */
export function SourceBanner({ projectIds }: { projectIds: readonly string[] }) {
  const rpc = useRpc<FoldersRpcContract>();
  const [folders, setFolders] = useState<readonly SyncedFolder[]>([]);
  const latest = useRef(0);

  const refresh = useCallback(() => {
    const request = (latest.current += 1);
    const settle = (next: readonly SyncedFolder[]) => {
      if (latest.current === request) setFolders(next);
    };
    rpc.call("listSyncedFolders", null).then(
      (result) => settle(result.folders),
      () => settle([]),
    );
  }, [rpc]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useRealtime("projects:changed", refresh);

  const retry = (boardId: string) => {
    void rpc.call("retryDatabase", { boardId }).then(refresh, refresh);
  };

  return (
    <>
      {pausedBoards(folders, projectIds).map(({ boardId, source }) => (
        <div
          key={boardId}
          role="status"
          className="flex shrink-0 items-center gap-2 border-b border-border-hairline bg-warning/10 px-4 py-1.5 text-xs text-muted-foreground"
        >
          <span className="min-w-0 flex-1 truncate">
            {databaseHost(source.url)} · {source.state === "refused" ? TOKEN_REFUSED_TEXT : `${lastSyncText(source)} · Taking and editing is paused`}
          </span>
          <Button size="sm" variant="outline" className="h-6 shrink-0" onClick={() => retry(boardId)}>
            Retry
          </Button>
        </div>
      ))}
    </>
  );
}
