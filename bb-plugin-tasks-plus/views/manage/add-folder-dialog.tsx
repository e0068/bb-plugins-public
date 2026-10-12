import { useEffect, useMemo, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type {
  FoldersRpcContract,
  ProjectRowBbProject,
} from "../../folders/contract.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "./shared.js";

const DEFAULT_TASKS_FOLDER = "docs/tasks";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateFolderPath(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return "Required.";
  if (trimmed.startsWith("/")) return "Must be a relative path.";
  if (trimmed.split("/").includes("..")) return "Must not contain '..' segments.";
  return null;
}

export interface AddFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: () => void;
  /** The bb project of the row the dialog was opened from. */
  bbProject: ProjectRowBbProject;
}

/**
 * "Add folder" — connects a repo-relative folder of markdown tasks in the
 * repository of the bb project of a row to a board. Reuses (or creates) the
 * tasks-plugin project linked to that bb project and runs the first sync
 * inline, so the dialog only closes once the connection is real.
 */
export function AddFolderDialog({
  open,
  onOpenChange,
  onConnected,
  bbProject,
}: AddFolderDialogProps) {
  const rpc = useRpc<FoldersRpcContract>();
  const [tasksFolder, setTasksFolder] = useState(DEFAULT_TASKS_FOLDER);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTasksFolder(DEFAULT_TASKS_FOLDER);
    setError(null);
  }, [open]);

  const pathError = useMemo(
    () => validateFolderPath(tasksFolder),
    [tasksFolder],
  );
  const canSubmit = pathError === null && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await rpc.call("addSyncedFolder", {
        bbProjectId: bbProject.id,
        tasksFolder: tasksFolder.trim(),
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      onOpenChange(false);
      onConnected();
    } catch (submitError) {
      setError(describeError(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add synced folder</DialogTitle>
          <DialogDescription>
            Connects a repository folder of markdown tasks to a board. Files
            stay the source of truth — the board mirrors them.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="bb project">
            <p className="text-sm">{bbProject.name}</p>
            {bbProject.repoPath === null ? null : (
              <p className="font-mono text-xs text-muted-foreground">
                {bbProject.repoPath}
              </p>
            )}
          </Field>
          <Field
            label="Folder path"
            hint={
              pathError ??
              "Repo-relative path holding <status>/<slug>.md files."
            }
          >
            <Input
              value={tasksFolder}
              placeholder={DEFAULT_TASKS_FOLDER}
              aria-invalid={pathError !== null}
              onChange={(event) => setTasksFolder(event.target.value)}
              className={
                pathError !== null
                  ? "h-8 border-destructive focus-visible:ring-destructive"
                  : "h-8"
              }
            />
          </Field>
        </div>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={!canSubmit} onClick={() => void submit()}>
            {submitting ? "Connecting…" : "Connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
