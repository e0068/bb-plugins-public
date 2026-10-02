import { useEffect, useState } from "react";
import type { Label, Preset } from "../../shared/contract.js";
import {
  listAllTasks,
  usePresets,
  useProjects,
  useSidebarSummary,
  useTasksQuery,
  useTasksRpc,
} from "../../client/data.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "../../components/confirm-dialog.js";
import {
  PERMISSION_LABELS,
  PERMISSION_MODES,
  PresetDialog,
  describePresetEnvironment,
  savePresetDraft,
  type PresetDraft,
} from "./preset-dialog.js";
import { ColorSwatchPicker, DEFAULT_COLOR, Field, prefixProblem } from "./shared.js";
import { FoldersSection } from "./folders-section.js";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

const NOT_EMPTY_HINT = "Move or delete this project's tasks to delete it.";

/** What a new prefix does beyond the keys: where the change lands and what is left to do. */
function renameConsequence(project: { database?: { url: string } | null }): string {
  const mentions = "Mentions of the old keys in task descriptions and comments are rewritten too.";
  return project.database
    ? `${mentions} Every machine that opens this board takes the new prefix.`
    : `${mentions} The task files in the repository change — commit them. Other machines keep the old prefix until it is changed there too.`;
}

function ProjectSection() {
  const rpc = useTasksRpc();
  const projects = useProjects();
  const projectList = projects.data ?? [];
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const projectId = selectedProjectId ?? projectList[0]?.id ?? null;
  const project = projectList.find((entry) => entry.id === projectId) ?? null;

  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [color, setColor] = useState<string>(DEFAULT_COLOR);
  const [confirmingRename, setConfirmingRename] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Unknown until the summary loads — deletion stays off rather than guessing.
  const taskCount = useSidebarSummary().data?.find(
    (entry) => entry.projectId === projectId,
  )?.taskCount;

  // The editor mirrors the selected project; resync whenever that project — or
  // its stored name/color — changes underneath us.
  useEffect(() => {
    if (project) {
      setName(project.name);
      setPrefix(project.prefix);
      setColor(project.color);
    }
  }, [project?.id, project?.name, project?.prefix, project?.color]);

  if (projectList.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No projects yet — create one first.
      </p>
    );
  }

  const prefixChanged = project !== null && prefix !== project.prefix;
  const prefixError = prefixChanged ? prefixProblem(prefix, projectList, project.id) : null;
  const fieldsChanged =
    project !== null &&
    (name.trim() !== project.name || color !== project.color);
  const canSave =
    project !== null &&
    name.trim() !== "" &&
    (fieldsChanged || prefixChanged) &&
    prefixError === null &&
    !saving &&
    !deleting;
  const canDelete =
    project !== null && taskCount === 0 && !saving && !deleting;

  // A new prefix renames every task key of the board, so it is asked first.
  const save = () => {
    if (!project || !canSave) return;
    if (prefixChanged) setConfirmingRename(true);
    else void write();
  };

  // The prefix goes first: refused, it leaves the name and color unsaved too.
  const write = async () => {
    if (!project) return;
    setSaving(true);
    setError(null);
    try {
      if (prefixChanged) {
        const renamed = await rpc.call("renameProjectPrefix", { projectId: project.id, prefix });
        if (!renamed.ok) {
          setError(
            renamed.error.code === "project_prefix_conflict"
              ? `Another board already uses the prefix ${prefix}.`
              : renamed.error.message,
          );
          return;
        }
      }
      if (fieldsChanged) {
        await rpc.call("updateProject", {
          projectId: project.id,
          name: name.trim(),
          color,
        });
      }
    } catch (saveError) {
      setError(describeError(saveError));
    } finally {
      setSaving(false);
    }
  };

  // Only empty projects are deletable here, so one click is enough: nothing
  // but the project record itself can be lost.
  const deleteProject = async () => {
    if (!project || !canDelete) return;
    setDeleting(true);
    setError(null);
    try {
      const result = await rpc.call("deleteProject", { projectId: project.id });
      if (result.ok) setSelectedProjectId(null);
      // The summary can lag behind a task created elsewhere; the server's own
      // message speaks API ("pass force: true"), so say it in UI terms.
      else if (result.error.code === "project_not_empty") setError(NOT_EMPTY_HINT);
      else setError(result.error.message);
    } catch (deleteError) {
      setError(describeError(deleteError));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-3">
      <Select
        value={projectId ?? undefined}
        onValueChange={(value) => {
          setSelectedProjectId(value);
          setError(null);
        }}
      >
        <SelectTrigger aria-label="Project" className="h-8 w-56">
          <SelectValue placeholder="Project" />
        </SelectTrigger>
        <SelectContent>
          {projectList.map((entry) => (
            <SelectItem key={entry.id} value={entry.id}>
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="size-2.5 rounded-sm"
                  style={{ backgroundColor: entry.color }}
                />
                {entry.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Field label="Name">
        <Input
          value={name}
          placeholder="Project name"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && canSave) {
              event.preventDefault();
              void save();
            }
          }}
          className="h-8 w-56"
        />
      </Field>
      <Field
        label="Key prefix"
        hint={prefixError ?? "Task keys use this prefix, e.g. TSK-12. Changing it renames every task key of the board."}
      >
        <Input
          value={prefix}
          aria-label="Key prefix"
          aria-invalid={prefixError !== null}
          onChange={(event) => setPrefix(event.target.value.toUpperCase())}
          className={
            prefixError !== null
              ? "h-8 w-32 border-destructive focus-visible:ring-destructive"
              : "h-8 w-32"
          }
        />
      </Field>
      <Field label="Color">
        <ColorSwatchPicker value={color} onChange={setColor} />
      </Field>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="h-7"
          disabled={!canSave}
          onClick={save}
        >
          Save
        </Button>
        <Button
          size="sm"
          variant="destructive"
          className="h-7"
          disabled={!canDelete}
          onClick={() => void deleteProject()}
        >
          Delete project
        </Button>
      </div>
      {taskCount !== undefined && taskCount > 0 ? (
        <p className="text-xs text-muted-foreground">{NOT_EMPTY_HINT}</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <ConfirmDialog
        open={confirmingRename}
        onOpenChange={setConfirmingRename}
        title={`Rename the board's task keys from ${project?.prefix ?? ""}-n to ${prefix}-n?`}
        description={project ? renameConsequence(project) : ""}
        confirmLabel="Rename keys"
        onConfirm={() => void write()}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

function LabelEditorRow({
  initialName,
  initialColor,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initialName: string;
  initialColor: string;
  submitLabel: string;
  onSubmit: (name: string, color: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={name}
        placeholder="Label name"
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && name.trim() !== "") {
            event.preventDefault();
            void onSubmit(name.trim(), color).then(() => {
              if (!onCancel) {
                setName("");
                setColor(DEFAULT_COLOR);
              }
            });
          }
        }}
        className="h-7 w-44 text-xs"
      />
      <ColorSwatchPicker value={color} onChange={setColor} />
      <Button
        size="sm"
        variant="outline"
        className="h-7"
        disabled={name.trim() === ""}
        onClick={() =>
          void onSubmit(name.trim(), color).then(() => {
            if (!onCancel) {
              setName("");
              setColor(DEFAULT_COLOR);
            }
          })
        }
      >
        {submitLabel}
      </Button>
      {onCancel ? (
        <Button size="sm" variant="ghost" className="h-7" onClick={onCancel}>
          Cancel
        </Button>
      ) : null}
    </div>
  );
}

function LabelsSection() {
  const rpc = useTasksRpc();
  const projects = useProjects();
  const projectList = projects.data ?? [];
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const projectId = selectedProjectId ?? projectList[0]?.id ?? null;
  const labels = useTasksQuery(
    async (rpc) =>
      projectId
        ? (await rpc.call("listLabels", { projectId })).labels
        : ([] as Label[]),
    ["projects:changed"],
    [projectId],
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    label: Label;
    usedBy: number;
  } | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (actionError) {
      setError(describeError(actionError));
    }
  };

  const askDelete = (label: Label) =>
    run(async () => {
      const tasks = await listAllTasks(rpc, { labelIds: [label.id] });
      setConfirmDelete({ label, usedBy: tasks.length });
    });

  if (projectList.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Create a project first — labels are project-scoped.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <Select
        value={projectId ?? undefined}
        onValueChange={(value) => {
          setSelectedProjectId(value);
          setEditingId(null);
        }}
      >
        <SelectTrigger aria-label="Project" className="h-8 w-56">
          <SelectValue placeholder="Project" />
        </SelectTrigger>
        <SelectContent>
          {projectList.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="size-2.5 rounded-sm"
                  style={{ backgroundColor: project.color }}
                />
                {project.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="divide-y divide-border-hairline rounded-md border border-border">
        {(labels.data ?? []).map((label) => (
          <div key={label.id} className="px-3 py-2">
            {editingId === label.id ? (
              <LabelEditorRow
                initialName={label.name}
                initialColor={label.color}
                submitLabel="Save"
                onCancel={() => setEditingId(null)}
                onSubmit={(name, color) =>
                  run(async () => {
                    await rpc.call("updateLabel", {
                      labelId: label.id,
                      name,
                      color,
                    });
                    setEditingId(null);
                  })
                }
              />
            ) : (
              <div className="group flex items-center gap-2">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: label.color }}
                />
                <span className="flex-1 text-sm">{label.name}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6 text-muted-foreground opacity-0 group-hover:opacity-100"
                  aria-label={`Edit label ${label.name}`}
                  onClick={() => setEditingId(label.id)}
                >
                  <Icon name="Edit" className="size-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                  aria-label={`Delete label ${label.name}`}
                  onClick={() => void askDelete(label)}
                >
                  <Icon name="Trash2" className="size-3.5" />
                </Button>
              </div>
            )}
          </div>
        ))}
        {(labels.data ?? []).length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">
            No labels yet.
          </p>
        ) : null}
      </div>
      <LabelEditorRow
        initialName=""
        initialColor={DEFAULT_COLOR}
        submitLabel="Add label"
        onSubmit={(name, color) =>
          run(async () => {
            if (!projectId) return;
            await rpc.call("createLabel", { projectId, name, color });
          })
        }
      />
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
        title={`Delete label “${confirmDelete?.label.name ?? ""}”?`}
        description={
          confirmDelete && confirmDelete.usedBy > 0
            ? `Used by ${confirmDelete.usedBy} task${confirmDelete.usedBy > 1 ? "s" : ""} — removing it detaches them.`
            : "This label isn't used by any tasks."
        }
        confirmLabel="Delete label"
        destructive
        onConfirm={() => {
          const target = confirmDelete;
          if (target) {
            void run(() =>
              rpc.call("deleteLabel", { labelId: target.label.id }),
            );
          }
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

function PresetsSection() {
  const rpc = useTasksRpc();
  const presets = usePresets();
  const machines = useTasksQuery(
    async (rpc) => (await rpc.call("listMachines", {})).machines,
    [],
  );
  // Keyed remount resets the dialog draft per open/target.
  const [dialog, setDialog] = useState<{
    key: number;
    editing: Preset | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (editing: Preset | null, draft: PresetDraft) => {
    await savePresetDraft(rpc, editing, draft);
    presets.refresh();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Presets available when dispatching a task to an agent.
        </p>
        <Button
          size="sm"
          className="h-7"
          onClick={() => setDialog({ key: Date.now(), editing: null })}
        >
          <Icon name="Plus" className="size-3.5" />
          New preset
        </Button>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border-hairline text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Provider</th>
              <th className="px-3 py-2 font-medium">Model</th>
              <th className="px-3 py-2 font-medium">Reasoning</th>
              <th className="px-3 py-2 font-medium">Permissions</th>
              <th className="px-3 py-2 font-medium">Environment</th>
              <th className="px-3 py-2 font-medium">Instructions</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border-hairline">
            {(presets.data ?? []).map((preset) => {
              const permission = PERMISSION_MODES.find(
                (mode) => mode === preset.permissionMode,
              );
              return (
                <tr key={preset.id} className="group">
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <Icon
                        name="Brain"
                        className="size-3.5 text-muted-foreground"
                      />
                      {preset.name}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {preset.providerId}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {preset.modelId}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {preset.reasoningLevel}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {permission
                      ? PERMISSION_LABELS[permission]
                      : preset.permissionMode}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    {describePresetEnvironment(preset, machines.data ?? [])}
                  </td>
                  <td
                    className="max-w-48 truncate px-3 py-2 text-xs text-muted-foreground"
                    title={preset.instructions}
                  >
                    {preset.instructions === "" ? "—" : preset.instructions}
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-6 text-muted-foreground"
                        aria-label={`Edit preset ${preset.name}`}
                        onClick={() =>
                          setDialog({ key: Date.now(), editing: preset })
                        }
                      >
                        <Icon name="Edit" className="size-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-6 text-muted-foreground hover:text-destructive"
                        aria-label={`Delete preset ${preset.name}`}
                        onClick={() => {
                          setError(null);
                          rpc
                            .call("deletePreset", { presetId: preset.id })
                            .then(() => presets.refresh())
                            .catch((deleteError: unknown) =>
                              setError(describeError(deleteError)),
                            );
                        }}
                      >
                        <Icon name="Trash2" className="size-3.5" />
                      </Button>
                    </span>
                  </td>
                </tr>
              );
            })}
            {(presets.data ?? []).length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-3 text-sm text-muted-foreground"
                >
                  No presets yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {dialog ? (
        <PresetDialog
          key={dialog.key}
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          editing={dialog.editing}
          onSave={(draft) => save(dialog.editing, draft)}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

/**
 * Settings-ish management surface: labels, agent presets, and folders.
 *
 * The shell does not yet reserve a manage route or sidebar-footer slot, so
 * this is exported unmounted; when the shell grows one (e.g. a `manage`
 * subPath or a sidebar "Manage" button), render <ManagePanel /> there.
 */
export function ManagePanel({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4",
        className,
      )}
    >
      <header className="space-y-1">
        <h2 className="text-base font-semibold">Manage</h2>
        <p className="text-sm text-muted-foreground">
          Project, labels, agent presets, and folders.
        </p>
      </header>
      <Tabs defaultValue="project">
        <TabsList>
          <TabsTrigger value="project">Project</TabsTrigger>
          <TabsTrigger value="labels">Labels</TabsTrigger>
          <TabsTrigger value="presets">Presets</TabsTrigger>
          <TabsTrigger value="folders">Folders</TabsTrigger>
        </TabsList>
        <TabsContent value="project" className="pt-3">
          <ProjectSection />
        </TabsContent>
        <TabsContent value="labels" className="pt-3">
          <LabelsSection />
        </TabsContent>
        <TabsContent value="presets" className="pt-3">
          <PresetsSection />
        </TabsContent>
        <TabsContent value="folders" className="pt-3">
          <FoldersSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
