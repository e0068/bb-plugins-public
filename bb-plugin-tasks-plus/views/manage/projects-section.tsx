import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { FoldersRpcContract, ProjectRow, ProjectRowBbProject, ProjectRowBoard, SyncedSource } from "../../folders/contract.js";
import { databaseHost } from "../../folders/database-address.js";
import { TOKEN_MISSING_TEXT, TOKEN_REFUSED_TEXT } from "../../folders/token-refused.js";
import { useTasksRpc } from "../../client/data.js";
import { ConfirmDialog } from "../../components/confirm-dialog.js";
import { ProjectIcon } from "@/components/project-icon";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { DetailToasts, useDetailToasts } from "../detail/toast.js";
import { AddFolderDialog } from "./add-folder-dialog.js";
import { ConnectDatabaseDialog } from "./connect-database-dialog.js";
import { ProjectIconPicker } from "./project-icon-picker.js";
import { RemoveFolderDialog } from "./remove-folder-dialog.js";
import { prefixProblem } from "./shared.js";

// ---------------------------------------------------------------------------
// Core: what the rows say, without a screen or a server
// ---------------------------------------------------------------------------

type DatabaseSource = Extract<SyncedSource, { kind: "database" }>;

const LINK_DOT: Record<DatabaseSource["state"], string> = {
  live: "bg-success",
  reconnecting: "bg-warning",
  offline: "bg-destructive",
  refused: "bg-destructive",
  "no-token": "bg-destructive",
};

const LINK_TEXT: Record<DatabaseSource["state"], string> = {
  live: "text-success",
  reconnecting: "text-warning",
  offline: "text-destructive",
  refused: "text-destructive",
  "no-token": "text-destructive",
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
    case "refused":
      return TOKEN_REFUSED_TEXT;
    case "no-token":
      return TOKEN_MISSING_TEXT;
  }
}

/** What a new prefix does beyond the keys: where the change lands and what is left to do. */
function renameConsequence(source: SyncedSource): string {
  const mentions = "Mentions of the old keys in task descriptions and comments are rewritten too.";
  switch (source.kind) {
    case "database":
      return `${mentions} Every machine that opens this board takes the new prefix.`;
    case "folder":
      return `${mentions} The task files in the repository change — commit them. Other machines keep the old prefix until it is changed there too.`;
  }
}

/** Why the server turned a new prefix down, in the words of the screen. */
const refusalText = (error: { code: string; message: string }, prefix: string): string =>
  error.code === "project_prefix_conflict" ? `Another board already uses the prefix ${prefix}.` : error.message;

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const INVITE_COPIED = "Invite copied — paste it into Connect database on the other machine.";

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

const CELL = "px-3 py-2";
const COLUMNS = ["Project", "Icon", "Key prefix", "Tasks", "Address"] as const;

function BoardsTable({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table aria-label={label} className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border-hairline text-xs text-muted-foreground">
            {COLUMNS.map((column) => (
              <th key={column} className={cn(CELL, "font-medium")}>
                {column}
              </th>
            ))}
            <th className={CELL} />
          </tr>
        </thead>
        <tbody className="divide-y divide-border-hairline">{children}</tbody>
      </table>
    </div>
  );
}

/** A quiet icon button at the end of a row. */
function RowAction({ label, icon, danger, onClick }: { label: string; icon: "Container" | "Share" | "Trash2"; danger?: boolean; onClick: () => void }) {
  return (
    <Button
      size="icon"
      variant="ghost"
      className={cn("size-7 shrink-0 text-muted-foreground", danger ? "hover:text-destructive" : "hover:text-foreground")}
      aria-label={label}
      onClick={onClick}
    >
      <Icon name={icon} className="size-3.5" />
    </Button>
  );
}

/** Where the board's tasks live: a folder's path, or a database's host with the state of the link. */
function AddressCell({ board }: { board: ProjectRowBoard }) {
  const { source } = board;
  switch (source.kind) {
    case "folder":
      return (
        <td className={cn(CELL, "text-muted-foreground")}>
          <span className="flex items-center gap-1.5">
            <Icon name="FolderGit" className="size-3.5 shrink-0" />
            <span className="truncate">{board.tasksFolder}</span>
          </span>
        </td>
      );
    case "database":
      return (
        <td className={CELL}>
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Icon name="Container" className="size-3.5 shrink-0" />
            <span className="truncate">{databaseHost(source.url)}</span>
          </span>
          <span className={cn("mt-0.5 inline-flex items-center gap-1 text-xs", LINK_TEXT[source.state])}>
            <span aria-hidden className={cn("size-1.5 rounded-full", LINK_DOT[source.state])} />
            {linkText(source)}
          </span>
        </td>
      );
  }
}

const TasksCell = ({ board }: { board: ProjectRowBoard }) => <td className={cn(CELL, "tabular-nums text-muted-foreground")}>{board.taskCount}</td>;

/**
 * The prefix of a board as a field: upper case as it is typed; Enter or leaving the field asks before
 * the task keys are renamed, and sends nothing for a prefix that cannot be one. Declined or refused,
 * the field goes back to the board's own prefix.
 */
function PrefixField({ board, name, onRename }: { board: ProjectRowBoard; name: string; onRename: (prefix: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState(board.prefix);
  const [asking, setAsking] = useState<string | null>(null);
  const changed = draft !== board.prefix;
  // Whether another board holds the prefix is the server's to say: it alone sees every board.
  const problem = changed ? prefixProblem(draft, [], null) : null;

  const ask = () => {
    if (changed && problem === null) setAsking(draft);
  };

  return (
    <div className="space-y-1">
      <Input
        value={draft}
        aria-label={`Key prefix of ${name}`}
        aria-invalid={problem !== null}
        className={cn("h-7 w-28 text-xs", problem !== null && "border-destructive focus-visible:ring-destructive")}
        onChange={(event) => setDraft(event.target.value.toUpperCase())}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          ask();
        }}
        onBlur={ask}
      />
      {problem === null ? null : <p className="text-xs text-destructive">{problem}</p>}
      <ConfirmDialog
        open={asking !== null}
        onOpenChange={(open) => {
          if (open) return;
          setAsking(null);
          setDraft(board.prefix);
        }}
        title={`Rename the board's task keys from ${board.prefix}-n to ${asking ?? ""}-n?`}
        description={renameConsequence(board.source)}
        confirmLabel="Rename keys"
        onConfirm={() => {
          if (asking === null) return;
          setDraft(asking);
          void onRename(asking).then((renamed) => renamed || setDraft(board.prefix));
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

type ConnectKind = "folder" | "database";

interface RowActions {
  edit: (board: ProjectRowBoard, change: { icon?: string; color?: string }) => void;
  rename: (board: ProjectRowBoard, prefix: string) => Promise<boolean>;
  share: (board: ProjectRowBoard) => void;
  /** Moves the folder board of the project into a database: opens the database dialog with that board to copy. */
  move: (board: ProjectRowBoard, bbProject: ProjectRowBbProject) => void;
  connect: (kind: ConnectKind, bbProject: ProjectRowBbProject) => void;
  remove: (board: ProjectRowBoard) => void;
}

function ConnectMenu({ bbProject, onConnect }: { bbProject: ProjectRowBbProject; onConnect: (kind: ConnectKind) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="h-7" aria-label={`Connect ${bbProject.name}`}>
          <Icon name="Plus" className="size-3.5" />
          Connect
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" collisionPadding={8} mobileTitle={`Connect ${bbProject.name}`}>
        <DropdownMenuItem disabled={bbProject.repoPath === null} onSelect={() => onConnect("folder")}>
          Folder…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onConnect("database")}>Database…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The action at the end of a project's row that fits where its board lives: share a database, move a folder into one. */
function BoardAction({ board, name, bbProject, actions }: { board: ProjectRowBoard; name: string; bbProject: ProjectRowBbProject; actions: RowActions }) {
  switch (board.source.kind) {
    case "database":
      return <RowAction label={`Share ${name}`} icon="Share" onClick={() => actions.share(board)} />;
    case "folder":
      return <RowAction label={`Move ${name} to a database`} icon="Container" onClick={() => actions.move(board, bbProject)} />;
  }
}

/** A bb project: its board's cells, or Connect in the place of them. */
function ProjectLine({ row: { bbProject, board }, actions }: { row: ProjectRow; actions: RowActions }) {
  const { name } = bbProject;
  return (
    <tr>
      <td className={cn(CELL, "font-medium")}>{name}</td>
      {board === null ? (
        <>
          <td colSpan={3} className={CELL} />
          <td className={CELL}>
            <ConnectMenu bbProject={bbProject} onConnect={(kind) => actions.connect(kind, bbProject)} />
          </td>
          <td className={CELL} />
        </>
      ) : (
        <>
          <td className={CELL}>
            <ProjectIconPicker
              icon={board.icon}
              color={board.color}
              label={`Icon and color of ${name}`}
              onIcon={(icon) => actions.edit(board, { icon })}
              onColor={(color) => actions.edit(board, { color })}
            />
          </td>
          <td className={CELL}>
            <PrefixField key={`${board.id}:${board.prefix}`} board={board} name={name} onRename={(prefix) => actions.rename(board, prefix)} />
          </td>
          <TasksCell board={board} />
          <AddressCell board={board} />
          <td className={CELL}>
            <BoardAction board={board} name={name} bbProject={bbProject} actions={actions} />
          </td>
        </>
      )}
    </tr>
  );
}

/** A board no bb project holds: what it is, and a way to take it off this machine. */
function OrphanLine({ board, actions }: { board: ProjectRowBoard; actions: RowActions }) {
  return (
    <tr>
      <td className={cn(CELL, "font-medium")}>{board.name}</td>
      <td className={CELL}>
        <ProjectIcon icon={board.icon} color={board.color} className="size-4" />
      </td>
      <td className={cn(CELL, "font-mono text-xs")}>{board.prefix}</td>
      <TasksCell board={board} />
      <AddressCell board={board} />
      <td className={CELL}>
        <RowAction label={`Delete ${board.name}`} icon="Trash2" danger onClick={() => actions.remove(board)} />
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

/** What the open dialog connects to the project of a row: a folder, or a database — which may take the project's folder board along. */
type Connecting = { kind: "folder"; bbProject: ProjectRowBbProject } | { kind: "database"; bbProject: ProjectRowBbProject; copyFromBoardId?: string };

/** The dialog that connects a folder or a database to the project of the row it was asked from. */
function ConnectDialog({ connecting, onClose, onConnected }: { connecting: Connecting; onClose: () => void; onConnected: () => void }) {
  const props = { open: true, onOpenChange: (open: boolean) => open || onClose(), onConnected, bbProject: connecting.bbProject };
  switch (connecting.kind) {
    case "folder":
      return <AddFolderDialog {...props} />;
    case "database":
      return <ConnectDatabaseDialog {...props} {...(connecting.copyFromBoardId === undefined ? {} : { copyFromBoardId: connecting.copyFromBoardId })} />;
  }
}

/**
 * The Projects tab: every bb project in one row — icon, colour, key prefix and where the tasks
 * live — and, in a second table, the boards no bb project holds, each with a way to delete it.
 * A shell over the RPC: what the rows say is worked out above.
 */
export function ProjectsSection() {
  const folders = useRpc<FoldersRpcContract>();
  const tasks = useTasksRpc();
  const [rows, setRows] = useState<{ projects: ProjectRow[]; orphans: ProjectRowBoard[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<Connecting | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ProjectRowBoard | null>(null);
  const { toasts, push, dismiss } = useDetailToasts();

  const refresh = useCallback(
    () => folders.call("listProjectRows", null).then(setRows, (fetchError: unknown) => setError(describeError(fetchError))),
    [folders],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useRealtime("projects:changed", () => void refresh());

  /** Runs a write, shows what went wrong under the table and reads the rows again. Answers whether the write went through. */
  const attempt = async (write: () => Promise<string | null>): Promise<boolean> => {
    try {
      const problem = await write();
      setError(problem);
      await refresh();
      return problem === null;
    } catch (writeError) {
      setError(describeError(writeError));
      return false;
    }
  };

  /** Puts the invite of a database board on the clipboard, or says why it cannot. */
  const share = async (board: ProjectRowBoard) => {
    try {
      const result = await folders.call("databaseInvite", { boardId: board.id });
      if (!result.ok) return push("error", result.error.message);
      await navigator.clipboard.writeText(result.invite);
      push("info", INVITE_COPIED);
    } catch (shareError) {
      push("error", describeError(shareError));
    }
  };

  const actions: RowActions = {
    edit: (board, change) =>
      void attempt(async () => {
        await tasks.call("updateProject", { projectId: board.id, ...change });
        return null;
      }),
    rename: (board, prefix) =>
      attempt(async () => {
        const result = await tasks.call("renameProjectPrefix", { projectId: board.id, prefix });
        return result.ok ? null : refusalText(result.error, prefix);
      }),
    share: (board) => void share(board),
    move: (board, bbProject) => setConnecting({ kind: "database", bbProject, copyFromBoardId: board.id }),
    connect: (kind, bbProject) => setConnecting({ kind, bbProject }),
    remove: (board) => setRemoveTarget(board),
  };

  const orphans = rows?.orphans ?? [];

  return (
    <div className="space-y-4">
      {rows === null ? null : (
        <BoardsTable label="bb projects">
          {rows.projects.map((row) => (
            <ProjectLine key={row.bbProject.id} row={row} actions={actions} />
          ))}
        </BoardsTable>
      )}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {orphans.length === 0 ? null : (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Boards without a bb project</h3>
          <p className="text-xs text-muted-foreground">
            Their bb project was removed or isn't on this machine. Delete takes a board off Tasks+ here; its files or database stay.
          </p>
          <BoardsTable label="Boards without a bb project">
            {orphans.map((board) => (
              <OrphanLine key={board.id} board={board} actions={actions} />
            ))}
          </BoardsTable>
        </section>
      )}
      {connecting === null ? null : (
        <ConnectDialog connecting={connecting} onClose={() => setConnecting(null)} onConnected={() => void refresh()} />
      )}
      {removeTarget === null ? null : (
        <RemoveFolderDialog
          board={removeTarget}
          open
          onOpenChange={(open) => open || setRemoveTarget(null)}
          onRemoved={() => void refresh()}
        />
      )}
      <DetailToasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
