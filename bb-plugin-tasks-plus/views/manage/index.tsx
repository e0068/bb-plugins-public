// Creation + management surfaces. The shell (shell/app-shell.tsx) mounts the
// New task dialog; ManagePanel is exported for the manage route/slot (see
// its doc comment).

export {
  NewTaskDialog,
  type NewTaskDialogProps,
} from "./new-task-dialog.js";
export { ManagePanel } from "./manage-panel.js";
