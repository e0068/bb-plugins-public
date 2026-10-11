import type { Task } from "../shared/contract.js";
import { Icon } from "@/components/ui/icon";
import { describeWorktreeOrigin } from "./task-meta.js";

/** Small marker for a task whose latest content came from an active
 *  worktree rather than the linked project's main checkout — see
 *  shared/contract.ts's fileTaskOriginSchema and filesync/fs-boards.ts for when
 *  that's the case. The board card and the list row draw the same mark. */
export function WorktreeSourceMark({ task }: { task: Task }) {
  if (task.source?.origin.kind !== "worktree") return null;
  const { identity, detail } = describeWorktreeOrigin(task.source.origin);
  return (
    <span
      data-worktree-mark
      className="flex shrink-0 items-center text-muted-foreground"
      title={`Not merged into main — synced from ${identity}${
        detail ? ` (${detail})` : ""
      }`}
    >
      <Icon name="FolderGit" className="size-3" />
    </span>
  );
}
