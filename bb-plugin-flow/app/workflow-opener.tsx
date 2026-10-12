// Открыватель .js в правой панели bb: файл workflow — `~/.claude/workflows` или `.bb/workflows` — открывается конструктором
// workflow из packages/workflow-builder, любой другой .js — встроенным превью bb. Сюда ведёт клик по чипу workflow в
// настройках этапа: сервер отдаёт сам .js. У каждой вкладки своё хранилище, так что две открытые workflow не делят дерево.
import { useEffect, useRef, useState } from "react";
import { useRpc, type PluginFileOpenerProps } from "@get-bb/plugin-sdk/app";
import { withBuiltinAgents } from "@bb-plugins/workflow-builder/agents";
import { blankTree, compile, recognize } from "@bb-plugins/workflow-builder/model";
import type { OutlinePath } from "@bb-plugins/workflow-builder/outline-ops";
import { nodeAt } from "@bb-plugins/workflow-builder/outline-ops";
import { createEditorStore } from "@bb-plugins/workflow-builder/store";
import { agentsMissingTemplate } from "@bb-plugins/workflow-builder/validity";
import { EditorStoreContext, useEditorSnapshot, WorkflowEditor, type AgentOption, type ProviderCatalogEntry } from "@bb-plugins/workflow-builder/react";

import { workflowFileEngine, type WorkflowEngine } from "../core/workflow-file";
import { Button } from "../components/ui/button";
import type { workflowFilesRpcContract } from "../shared/contract";

/** Уже панели — одна колонка за раз: дерево, а по выбору узла — его настройки с «Назад». */
const COMPACT_BELOW_PX = 720;

const fileName = (path: string): string => path.slice(path.lastIndexOf("/") + 1).replace(/\.js$/, "");

export function WorkflowOpener({ path, source, Original }: PluginFileOpenerProps) {
  const engine = source.kind === "host" ? workflowFileEngine(path) : null;
  return engine === null ? <Original /> : <WorkflowFile path={path} engine={engine} />;
}

type Loaded = { state: "loading" } | { state: "ready" } | { state: "failed"; message: string };

function WorkflowFile({ path, engine }: { path: string; engine: WorkflowEngine }) {
  const rpc = useRpc<typeof workflowFilesRpcContract>();
  const [store] = useState(createEditorStore);
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [agents, setAgents] = useState<AgentOption[]>(() => withBuiltinAgents([]));
  const [providers, setProviders] = useState<ProviderCatalogEntry[]>([]);
  const identity = { store: engine === "claude" ? ("global" as const) : ("project" as const), path, name: fileName(path) };

  useEffect(() => {
    let alive = true;
    setLoaded({ state: "loading" });
    rpc.call("workflowRead", { path }).then(
      ({ source }) => {
        if (!alive) return;
        const result = recognize(source, engine);
        if (result.kind === "tree") store.load(result.tree, identity);
        else store.load(blankTree(identity.name), identity, source, result.kind);
        setLoaded({ state: "ready" });
      },
      (error: unknown) => alive && setLoaded({ state: "failed", message: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, engine]);

  useEffect(() => {
    void rpc.call("workflowAgents", null).then(
      (found) => setAgents(withBuiltinAgents(found)),
      () => {},
    );
    void rpc.call("workflowProviders", null).then(setProviders, () => {});
  }, [rpc]);

  if (loaded.state === "failed") return <div className="p-4 text-sm text-muted-foreground">Can't read {path}: {loaded.message}</div>;
  if (loaded.state === "loading") return <div className="p-4 text-sm text-muted-foreground">Reading {identity.name}…</div>;
  return (
    <EditorStoreContext.Provider value={store}>
      <WorkflowFileEditor path={path} engine={engine} agents={agents} providers={providers} />
    </EditorStoreContext.Provider>
  );
}

function WorkflowFileEditor({ path, engine, agents, providers }: { path: string; engine: WorkflowEngine; agents: AgentOption[]; providers: ProviderCatalogEntry[] }) {
  const rpc = useRpc<typeof workflowFilesRpcContract>();
  const { tree, rawSource, version } = useEditorSnapshot();
  const [selectedPath, setSelectedPath] = useState<OutlinePath | null>(null);
  const [savedVersion, setSavedVersion] = useState(version);
  const [saving, setSaving] = useState<{ state: "idle" } | { state: "saving" } | { state: "failed"; message: string }>({ state: "idle" });
  const box = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);

  // Колонок столько, сколько влезает в саму вкладку: правая панель уже окна.
  useEffect(() => {
    const node = box.current;
    if (node === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setCompact((entry?.contentRect.width ?? 0) < COMPACT_BELOW_PX));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const codeOnly = rawSource !== null;
  const invalid = agentsMissingTemplate(tree);
  const hasDetail = !codeOnly && selectedPath !== null && nodeAt(tree, selectedPath) !== null;
  const save = async () => {
    setSaving({ state: "saving" });
    const at = version;
    try {
      await rpc.call("workflowSave", { path, source: compile(tree, engine) });
      setSavedVersion(at);
      setSaving({ state: "idle" });
    } catch (error) {
      setSaving({ state: "failed", message: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <div ref={box} className="flex h-full min-h-0 min-w-0 overflow-x-auto">
      <WorkflowEditor
        agents={agents}
        providerCatalog={providers}
        previewEngine={engine}
        columns={!compact ? "all" : hasDetail ? "detail" : "builder"}
        selectedPath={selectedPath}
        onSelect={setSelectedPath}
        storageKey="flow:workflow-opener"
        renderBack={(label, onClick) => (
          <button type="button" onClick={onClick} aria-label={`Back to ${label}`} className="flex w-full shrink-0 items-center gap-1.5 border-b border-border px-3 py-2 text-left text-sm text-muted-foreground hover:text-foreground">
            ← {label}
          </button>
        )}
        footer={
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-xs text-muted-foreground" title={path}>
              {saving.state === "failed" ? `Not saved: ${saving.message}` : version !== savedVersion ? "Unsaved changes" : path}
            </span>
            {!codeOnly && (
              <Button size="sm" onClick={() => void save()} disabled={invalid > 0 || version === savedVersion || saving.state === "saving"}>
                Save
              </Button>
            )}
          </div>
        }
      />
    </div>
  );
}
