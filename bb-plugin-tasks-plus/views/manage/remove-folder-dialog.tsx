import { useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { FoldersRpcContract, SyncedFolder } from "../../folders/contract.js";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CheckboxField } from "./shared.js";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface RemoveFolderDialogProps {
  folder: SyncedFolder;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoved: () => void;
}

/**
 * Disconnects a synced folder. Always stops sync and never touches files on
 * disk; the checkbox controls only whether the tasks this folder created stay
 * on the board (unlinked, default) or are deleted with it.
 */
export function RemoveFolderDialog({
  folder,
  open,
  onOpenChange,
  onRemoved,
}: RemoveFolderDialogProps) {
  const rpc = useRpc<FoldersRpcContract>();
  const [alsoDeleteTasks, setAlsoDeleteTasks] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await rpc.call("removeSyncedFolder", {
        projectId: folder.projectId,
        alsoDeleteTasks,
      });
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
          <DialogTitle>Disconnect "{folder.tasksFolder}"?</DialogTitle>
          <DialogDescription>
            Stops syncing this folder to {folder.projectName}. Files on disk
            are never touched.{" "}
            {alsoDeleteTasks
              ? `The ${folder.taskCount} task${folder.taskCount === 1 ? "" : "s"} this folder created will also be deleted from the board.`
              : "Tasks this folder created stay on the board as regular tasks, unlinked from their files."}
          </DialogDescription>
        </DialogHeader>
        <CheckboxField
          checked={alsoDeleteTasks}
          onCheckedChange={setAlsoDeleteTasks}
          label="Also delete these tasks from the board"
        />
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
            Disconnect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
