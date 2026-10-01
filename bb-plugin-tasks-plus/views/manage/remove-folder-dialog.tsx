import { useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { FoldersRpcContract, SyncedFolder } from "../../folders/contract.js";
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
  folder: SyncedFolder;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoved: () => void;
}

/** What disconnecting takes away, said for the kind of source. */
function disconnectCopy(folder: SyncedFolder): { title: string; description: string } {
  switch (folder.source.kind) {
    case "folder":
      return {
        title: `Disconnect "${folder.tasksFolder}"?`,
        description: `Stops ${folder.projectName} from reading this folder. Files on disk are never touched — the ${taskCountText(folder.taskCount)} it holds simply stop showing up on this board.`,
      };
    case "database":
      return {
        title: `Disconnect ${databaseHost(folder.source.url)}?`,
        description: `${folder.projectName} leaves this machine and its saved token is forgotten. The database and its ${taskCountText(folder.taskCount)} stay where they are: other machines keep working, and an invite connects it again.`,
      };
  }
}

/**
 * Disconnects a board from its source. Files on disk are never touched —
 * they're the tasks themselves, not a synced copy — so disconnecting a
 * folder just stops this board from reading it; a database board leaves
 * this machine while the database keeps serving the others.
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

  const copy = disconnectCopy(folder);
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
            Disconnect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
