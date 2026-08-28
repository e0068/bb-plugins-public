// app.tsx — the Workflow Composer frontend: a navPanel whose body is the tree editor + workflow list,
// with the compiled code preview as a resizable second column inside the panel. It used to be a host
// fixed-tab (experimental_fixedTabs), but bb 0.40.0 fails to mount a navPanel that declares that option
// and the sidebar entry vanishes (see task BP-53), so the preview moved into a column.
// All disk/CLI work is backend RPC; this file only edits the shared tree and calls the contract.
// Controls are plain native HTML elements styled with host theme token classes.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { definePluginApp, useBbContext, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "./server";
import { compile, blankTree, type Engine, type Tree } from "./workflow-model";
import { editorStore, engineForStore, type StoreKind } from "./store";
import { WorkflowEditor } from "./ui/tree-editor";
import { OutlineEditor } from "./ui/outline-editor";
import {
  ResizeHandle,
  useResizableWidth,
} from "packages/resizable-pane/react";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
interface WorkflowItem {
  name: string;
  path: string;
  store: StoreKind;
  description: string;
  hasTree: boolean;
}
interface ProjectOption {
  id: string;
  name: string;
}
// One discovered agent (~/.claude/agents, project .claude/agents, or a plugin's agents/), with its
// frontmatter-derived model/effort/provider so the agent detail column can follow the selected agent.
interface AgentOption {
  value: string;
  model: string;
  effort: string;
  provider: string;
  description?: string;
  path?: string;
  tools?: string[];
  scope?: "user" | "project" | "plugin";
}
interface ProviderCatalogEntry {
  id: string;
  name: string;
  models: { id: string; efforts: string[] }[];
}

// ---- native form control styling (host theme tokens only) ----
const BTN_BASE =
  "inline-flex h-8 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 text-xs font-medium transition disabled:pointer-events-none disabled:opacity-50";
const BTN_DEFAULT = `${BTN_BASE} bg-foreground text-background hover:bg-foreground/90`;
const BTN_OUTLINE = `${BTN_BASE} border border-border bg-transparent text-foreground hover:bg-muted`;
const INPUT_CLS =
  "flex h-8 w-full rounded-md border border-border bg-transparent px-3 py-1 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
const SELECT_CLS =
  "flex h-8 items-center rounded-md border border-border bg-transparent px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
const SELECT_FULL_CLS =
  "flex h-9 w-full items-center rounded-md border border-border bg-transparent px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const useEditor = () =>
  useSyncExternalStore(editorStore.subscribe, editorStore.getSnapshot, editorStore.getSnapshot);

function useModels(rpc: Rpc): string[] {
  const [models, setModels] = useState<string[]>([]);
  useEffect(() => {
    void rpc.call("models", null).then((r) => setModels(r.models));
  }, [rpc]);
  return models;
}

// Discovered Claude Code agent types (user/project/plugin), for the "Agent type" autocomplete and for
// following the selected agent's own model/effort/provider. Re-fetches when the selected project
// changes, since project agents depend on it.
function useAgents(rpc: Rpc, projectId: string | null): AgentOption[] {
  const [agents, setAgents] = useState<AgentOption[]>([]);
  useEffect(() => {
    void rpc.call("agents", { projectId }).then((r) => setAgents(r.agents));
  }, [rpc, projectId]);
  return agents;
}

// The live provider/model/effort catalog, so the agent detail column can restrict the Model/Effort
// selects to a pinned agent's own provider.
function useProviderCatalog(rpc: Rpc): ProviderCatalogEntry[] {
  const [catalog, setCatalog] = useState<ProviderCatalogEntry[]>([]);
  useEffect(() => {
    void rpc.call("providerCatalog", null).then((r) => setCatalog(r));
  }, [rpc]);
  return catalog;
}

function useProjects(rpc: Rpc): ProjectOption[] {
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  useEffect(() => {
    void rpc.call("projects", null).then((r) => setProjects(r));
  }, [rpc]);
  return projects;
}

// ---- panel body ----

function ComposerPanel() {
  const { projectId } = useBbContext();
  const rpc = useRpc<typeof rpcContract>();
  const models = useModels(rpc);
  const projects = useProjects(rpc);
  const { tree, identity, rawSource } = useEditor();
  const codeOnly = rawSource != null;
  const { width: codeWidth, startResize } = useResizableWidth({
    initial: 480,
    min: 320,
    max: 1000,
    storageKey: "workflow-composer:code-pane-width",
  });
  // Код-превью — колонка по требованию (как прежняя вкладка «Code»): по умолчанию
  // скрыта, открывается кнопкой в тулбаре.
  const [showCode, setShowCode] = useState(false);
  // Статичный макет нового конструктора (вложенный аутлайн) vs. текущий Miller-редактор.
  const [preview, setPreview] = useState(false);

  const [items, setItems] = useState<WorkflowItem[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [output, setOutput] = useState<string>("");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(projectId);
  const agents = useAgents(rpc, selectedProjectId);
  const providerCatalog = useProviderCatalog(rpc);
  // Feeds the description column's "Refers to" drill-in: given a .md file's path, its content plus the
  // .md/skill files it references. Re-bound when the project changes since the RPC is path-confined per
  // project.
  const loadRefs = useCallback(
    (path: string) => rpc.call("agentRefs", { path, projectId: selectedProjectId }),
    [rpc, selectedProjectId],
  );

  // The host's own projectId may be null (no project in view); once the project list arrives, fall
  // back to its first entry so the panel isn't stuck with nothing selected.
  useEffect(() => {
    if (selectedProjectId == null && projects.length > 0) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  const refresh = useCallback(() => {
    void rpc.call("list", { projectId: selectedProjectId }).then((r) => setItems(r.items as WorkflowItem[]));
  }, [rpc, selectedProjectId]);
  useEffect(refresh, [refresh]);

  const openItem = async (item: WorkflowItem) => {
    const res = await rpc.call("read", { projectId: selectedProjectId, store: item.store, path: item.path });
    const parsedTree = res.tree as Tree | null;
    // No composer tree → hand-written file: open it read-only as its own source, not a blank placeholder
    // tree (which a Save would then compile over the real code).
    editorStore.load(parsedTree ?? blankTree(item.name), { store: item.store, path: item.path, name: item.name }, parsedTree ? null : res.source);
  };

  // `bb workflows` only handles project (bb) workflows, and only inside the project workspace. Global
  // (~/.claude) workflows belong to Claude Code, so validate/run are project-only.
  const bbRunnable = identity?.store === "project";

  const doValidate = async () => {
    if (!identity) return toast.error("Save the workflow first — validation checks the file on disk");
    if (!bbRunnable) return toast.error("Validation is only for project workflows; global ones run through Claude Code");
    const res = await rpc.call("validate", { projectId: selectedProjectId, store: identity.store, path: identity.path });
    setOutput(res.output || (res.ok ? "No errors" : "There are errors"));
    res.ok ? toast.success("Validation passed") : toast.error("Validation found errors — see the output below");
  };

  const doRun = async () => {
    if (!identity) return toast.error("Save the workflow first — running executes the file on disk");
    if (!bbRunnable) return toast.error("Run is only for project workflows; global ones run through Claude Code");
    const res = await rpc.call("run", { projectId: selectedProjectId, store: identity.store, path: identity.path });
    setOutput(res.output);
    if (res.runId) {
      toast.success("Started");
      pollStatus(rpc, res.runId, setOutput);
    } else {
      toast.error("Failed to start — see the output below");
    }
  };

  const doDelete = async () => {
    if (!identity) return;
    await rpc.call("remove", { projectId: selectedProjectId, store: identity.store, path: identity.path });
    toast.success("Workflow deleted");
    editorStore.newWorkflow();
    refresh();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <select
          aria-label="project"
          className={SELECT_CLS}
          value={projects.some((p) => p.id === selectedProjectId) ? selectedProjectId! : ""}
          disabled={projects.length === 0}
          onChange={(e) => setSelectedProjectId(e.target.value || null)}
        >
          {!projects.some((p) => p.id === selectedProjectId) && <option value="">{projects.length === 0 ? "No projects" : "—"}</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button type="button" className={BTN_DEFAULT} onClick={() => setSaveOpen(true)} disabled={codeOnly}>
          Save
        </button>
        <button type="button" className={BTN_OUTLINE} onClick={doValidate} disabled={!bbRunnable}>
          Validate
        </button>
        <button type="button" className={BTN_OUTLINE} onClick={doRun} disabled={!bbRunnable}>
          Run
        </button>
        <button type="button" className={BTN_OUTLINE} onClick={doDelete} disabled={!identity}>
          Delete
        </button>
        <button
          type="button"
          className={showCode ? BTN_DEFAULT : BTN_OUTLINE}
          onClick={() => setShowCode((v) => !v)}
          disabled={codeOnly}
          aria-pressed={showCode}
        >
          Code
        </button>
        {codeOnly ? (
          <span className="text-xs text-muted-foreground">
            Hand-written workflow — shown as code (read-only). Saving is disabled so the constructor can't overwrite it.
          </span>
        ) : (
          identity &&
          !bbRunnable && (
            <span className="text-xs text-muted-foreground">
              Global workflow (Claude Code) — validation and run are only available for project workflows
            </span>
          )
        )}
        <div className="ml-auto flex gap-0.5 rounded-md bg-muted p-0.5">
          <button
            type="button"
            className={`rounded px-2.5 py-1 text-xs transition ${!preview ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setPreview(false)}
          >
            Columns
          </button>
          <button
            type="button"
            className={`rounded px-2.5 py-1 text-xs transition ${preview ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setPreview(true)}
          >
            Outline
          </button>
        </div>
      </div>

      {output && (
        <pre className="max-h-32 shrink-0 overflow-auto border-b border-border bg-muted p-2 text-xs text-foreground" aria-label="output">
          {output}
        </pre>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex h-full w-64 shrink-0 flex-col overflow-y-auto border-r border-border">
          <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Workflows
          </div>
          <div className="space-y-3 p-3">
            <button type="button" className={`${BTN_OUTLINE} w-full`} onClick={() => editorStore.newWorkflow()}>
              + New workflow
            </button>
            <StoreGroup title="Project · bb engine" items={items.filter((i) => i.store === "project")} onOpen={openItem} activePath={identity?.path} />
            <StoreGroup title="Global · Claude Code" items={items.filter((i) => i.store === "global")} onOpen={openItem} activePath={identity?.path} />
          </div>
        </div>

        {preview ? (
          <OutlineEditor
            agents={agents}
            providerCatalog={providerCatalog}
            writeAgent={(input) => rpc.call("writeAgent", { projectId: selectedProjectId, ...input })}
          />
        ) : codeOnly ? (
          <CodeOnlyView source={rawSource!} />
        ) : (
          <>
            <WorkflowEditor models={models} agents={agents} providerCatalog={providerCatalog} loadRefs={loadRefs} />
            {showCode && (
              <>
                <ResizeHandle onPointerDown={startResize} />
                <div style={{ width: codeWidth }} className="h-full min-h-0 shrink-0 overflow-hidden">
                  <CodePreview />
                </div>
              </>
            )}
          </>
        )}
      </div>

      <SaveDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        rpc={rpc}
        projectId={selectedProjectId}
        tree={tree}
        defaultName={identity?.name ?? tree.name}
        defaultStore={identity?.store ?? (selectedProjectId ? "project" : "global")}
        onSaved={(identity) => {
          editorStore.load(structuredClone(editorStore.getSnapshot().tree), identity);
          refresh();
        }}
      />
    </div>
  );
}

// Read-only body shown instead of the tree editor when the open workflow is hand-written (no composer
// tree). Shows the file's real source verbatim — the honest "essence" the tree editor can't reconstruct.
function CodeOnlyView({ source }: { source: string }) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
        Hand-written workflow — no constructor tree. Read-only; edit the .js file directly.
      </div>
      <pre className="flex-1 overflow-auto p-4 font-mono text-xs text-foreground" aria-label="workflow source">
        {source}
      </pre>
    </div>
  );
}

function StoreGroup({
  title,
  items,
  onOpen,
  activePath,
}: {
  title: string;
  items: WorkflowItem[];
  onOpen: (i: WorkflowItem) => void;
  activePath?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      {items.length === 0 && <div className="px-1 py-0.5 text-xs text-muted-foreground">empty</div>}
      {items.map((item) => (
        <button
          key={item.path}
          type="button"
          onClick={() => onOpen(item)}
          className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm ${
            activePath === item.path ? "border-border bg-muted text-foreground" : "border-transparent text-foreground/90 hover:bg-muted"
          }`}
          title={item.description || item.name}
        >
          <span className="min-w-0 flex-1 truncate">{item.name}</span>
          {!item.hasTree && (
            <span className="shrink-0 text-xs text-muted-foreground" title="File has no constructor tree — opens as code">
              code only
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function SaveDialog({
  open,
  onOpenChange,
  rpc,
  projectId,
  tree,
  defaultName,
  defaultStore,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rpc: Rpc;
  projectId: string | null;
  tree: Tree;
  defaultName: string;
  defaultStore: StoreKind;
  onSaved: (identity: { store: StoreKind; path: string; name: string }) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [store, setStore] = useState<StoreKind>(defaultStore);
  useEffect(() => {
    if (open) {
      setName(defaultName);
      setStore(defaultStore);
    }
  }, [open, defaultName, defaultStore]);

  const engine: Engine = engineForStore(store);

  const save = async () => {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name.trim())) {
      return toast.error("Name must be lowercase letters, digits, and hyphens, no spaces (e.g. review-changes)");
    }
    // bb requires a non-empty description; enforce it here so the save can't produce an invalid file.
    if (engine === "bb" && !tree.description.trim()) {
      return toast.error("Add a description to save to the project — the bb engine requires it");
    }
    try {
      const res = await rpc.call("save", { projectId, store, name: name.trim(), source: compile(tree, engine) });
      toast.success(store === "project" ? "Saved to project" : "Saved globally");
      onOpenChange(false);
      onSaved({ store, path: res.path, name: name.trim() });
    } catch (e) {
      toast.error("Failed to save: " + String((e as Error).message ?? e));
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => onOpenChange(false)}>
      <div
        className="grid w-full max-w-lg grid-cols-[minmax(0,1fr)] gap-4 rounded-lg border border-border bg-background p-6 shadow-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-1.5 text-left">
          <h2 className="text-base font-semibold leading-none tracking-tight text-foreground">Save workflow</h2>
        </div>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Save to</label>
            <select aria-label="save destination" className={SELECT_FULL_CLS} value={store} onChange={(e) => setStore(e.target.value as StoreKind)}>
              <option value="project" disabled={!projectId}>
                Project · .bb/workflows · bb engine{!projectId ? " — no project" : ""}
              </option>
              <option value="global">Global · ~/.claude/workflows · Claude Code</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="save-name" className="text-xs text-muted-foreground">
              Name (kebab-case)
            </label>
            <input id="save-name" aria-label="save name" placeholder="review-changes" className={INPUT_CLS} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={BTN_OUTLINE} onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button type="button" className={BTN_DEFAULT} onClick={save} aria-label="confirm save">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// Poll `status` a bounded number of times; the CLI's status text is shown verbatim.
function pollStatus(rpc: Rpc, runId: string, setOutput: (s: string) => void) {
  let ticks = 0;
  const timer = setInterval(() => {
    ticks += 1;
    void rpc.call("status", { runId }).then((r) => setOutput(r.output));
    if (ticks >= 15) clearInterval(timer);
  }, 2000);
}

// ---- code preview (collapsible host fixed-tab) ----

function CodePreview() {
  const { tree, previewEngine, rawSource } = useEditor();
  const engines: { id: Engine; label: string }[] = [
    { id: "bb", label: "bb" },
    { id: "claude", label: "Claude Code" },
  ];
  // A hand-written workflow has no tree to compile — show its real source instead of compiling a
  // placeholder tree (which would misrepresent the file the engine actually runs).
  if (rawSource != null) {
    return (
      <div className="flex h-full flex-col bg-background">
        <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">Hand-written source (read-only)</div>
        <pre className="flex-1 overflow-auto p-4 font-mono text-xs text-foreground" aria-label="compiled code">
          {rawSource}
        </pre>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground">
        <span>Engine:</span>
        {engines.map((e) => (
          <button
            key={e.id}
            type="button"
            aria-label={`engine ${e.label}`}
            onClick={() => editorStore.setPreviewEngine(e.id)}
            className={`rounded-md border px-2 py-0.5 ${
              previewEngine === e.id ? "border-border bg-muted text-foreground" : "border-transparent hover:bg-muted"
            }`}
          >
            {e.label}
          </button>
        ))}
      </div>
      <pre className="flex-1 overflow-auto p-4 font-mono text-xs text-foreground" aria-label="compiled code">
        {compile(tree, previewEngine)}
      </pre>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "workflow-composer",
    title: "Workflows+",
    icon: "Zap",
    path: "workflow",
    component: ComposerPanel,
  });
});
