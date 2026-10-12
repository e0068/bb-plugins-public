import { useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { FoldersRpcContract, ProjectRowBoard } from "../../folders/contract.js";
import { databaseHost } from "../../folders/database-address.js";
import { taskCountText } from "./shared.js";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface RemoveFolderDialogProps {
  board: ProjectRowBoard;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoved: () => void;
}

/** What deleting the board takes away, said for the kind of source. */
function deleteCopy(board: ProjectRowBoard): { title: string; description: string } {
  const title = `Delete ${board.name}?`;
  switch (board.source.kind) {
    case "folder":
      return {
        title,
        description: `${board.name} leaves Tasks+ on this machine. The task files in ${board.tasksFolder ?? "its folder"} stay where they are.`,
      };
    case "database":
      return {
        title,
        description: `${board.name} leaves this machine and its saved token is forgotten. The database ${databaseHost(board.source.url)} and its ${taskCountText(board.taskCount)} stay where they are: other machines keep working, and an invite connects it again.`,
      };
  }
}

/**
 * Deletes a board from this machine. The tasks are never touched — they are
 * the files of a folder or the rows of a database, not a copy kept here — so a
 * folder board only stops showing them, and a database board leaves this
 * machine while the database keeps serving the others.
 */
export function RemoveFolderDialog({
  board,
  open,
  onOpenChange,
  onRemoved,
}: RemoveFolderDialogProps) {
  const rpc = useRpc<FoldersRpcContract>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = deleteCopy(board);
  const confirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await rpc.call("removeSyncedFolder", { projectId: board.id });
      onOpenChange(false);
      onRemoved();
    } catch (removeError) {
      setError(describeError(removeError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={submitting}
            onClick={() => void confirm()}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
