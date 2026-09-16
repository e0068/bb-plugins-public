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
 * Disconnects a folder from its board. Files on disk are never touched —
 * they're the tasks themselves, not a synced copy — so disconnecting just
 * stops this board from reading that folder.
 */
export function RemoveFolderDialog({
  folder,
  open,
  onOpenChange,
  onRemoved,
}: RemoveFolderDialogProps) {
  const rpc = useRpc<FoldersRpcContract>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await rpc.call("removeSyncedFolder", { projectId: folder.projectId });
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
            Stops {folder.projectName} from reading this folder. Files on disk
            are never touched — the {folder.taskCount} task
            {folder.taskCount === 1 ? "" : "s"} it holds simply stop showing
            up on this board.
          </DialogDescription>
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
            Disconnect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
