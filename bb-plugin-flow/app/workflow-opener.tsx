// Открыватель .js в правой панели bb: файл workflow — `~/.claude/workflows` или `.bb/workflows` — открывается конструктором
// workflow из packages/workflow-builder, любой другой .js — встроенным превью bb. Сюда ведёт клик по чипу workflow в
// настройках этапа: сервер отдаёт сам .js. У каждой вкладки своё хранилище, так что две открытые workflow не делят дерево.
import { useEffect, useState, type ReactNode } from "react";
import { useRpc, type PluginFileOpenerProps } from "@get-bb/plugin-sdk/app";
import { MdDocView, NATIVE_VIEWER_TOKEN_DEFAULTS, kasimovCssVars, kasimovFlags, parseKasimovSettings } from "@bb-plugins/md-doc-view";
import { withBuiltinAgents } from "@bb-plugins/workflow-builder/agents";
import { blankTree, compile, recognize } from "@bb-plugins/workflow-builder/model";
import type { OutlinePath } from "@bb-plugins/workflow-builder/outline-ops";
import { createEditorStore } from "@bb-plugins/workflow-builder/store";
import { agentsMissingTemplate } from "@bb-plugins/workflow-builder/validity";
import { EditorStoreContext, useEditorSnapshot, WorkflowEditor, type AgentOption, type ProviderCatalogEntry } from "@bb-plugins/workflow-builder/react";

import { workflowFileEngine, type WorkflowEngine } from "../core/workflow-file";
import { Button } from "../components/ui/button";
import { docLibraries } from "./doc-libraries";
import type { workflowFilesRpcContract } from "../shared/contract";

const fileName = (path: string): string => path.slice(path.lastIndexOf("/") + 1).replace(/\.js$/, "");

export function WorkflowOpener({ path, source, Original }: PluginFileOpenerProps) {
  const engine = source.kind === "host" ? workflowFileEngine(path) : null;
  return engine === null ? <Original /> : <WorkflowFile path={path} engine={engine} />;
}

type Loaded = { state: "loading" } | { state: "ready" } | { state: "failed"; message: string };

/**
 * Редактор одного файла workflow: читает его и показывает конструктором, а нераспознанный — кодом для правки. `create` —
 * файла ещё нет: пустое дерево с именем файла, первое сохранение его создаёт; `onSaved` зовётся после каждой записи.
 */
export function WorkflowFile({ path, engine, create = false, onSaved }: { path: string; engine: WorkflowEngine; create?: boolean; onSaved?: () => void }) {
  const rpc = useRpc<typeof workflowFilesRpcContract>();
  const [store] = useState(createEditorStore);
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [agents, setAgents] = useState<AgentOption[]>(() => withBuiltinAgents([]));
  const [providers, setProviders] = useState<ProviderCatalogEntry[]>([]);
  const identity = { store: engine === "claude" ? ("global" as const) : ("project" as const), path, name: fileName(path) };

  useEffect(() => {
    let alive = true;
    if (create) {
      store.newWorkflow();
      store.setName(identity.name);
      setLoaded({ state: "ready" });
      return;
    }
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
  }, [path, engine, create]);

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
      <WorkflowFileEditor path={path} engine={engine} agents={agents} providers={providers} create={create} onSaved={onSaved} />
    </EditorStoreContext.Provider>
  );
}

function WorkflowFileEditor({
  path,
  engine,
  agents,
  providers,
  create,
  onSaved,
}: {
  path: string;
  engine: WorkflowEngine;
  agents: AgentOption[];
  providers: ProviderCatalogEntry[];
  create: boolean;
  onSaved?: () => void;
}) {
  const rpc = useRpc<typeof workflowFilesRpcContract>();
  const { tree, rawSource, version } = useEditorSnapshot();
  const [selectedPath, setSelectedPath] = useState<OutlinePath | null>(null);
  // Новый файл несохранён с самого начала: кнопка «Save» его создаёт.
  const [savedVersion, setSavedVersion] = useState(create ? -1 : version);
  const [saving, setSaving] = useState<{ state: "idle" } | { state: "saving" } | { state: "failed"; message: string }>({ state: "idle" });

  const codeOnly = rawSource !== null;
  const invalid = agentsMissingTemplate(tree);
  const save = async () => {
    setSaving({ state: "saving" });
    const at = version;
    try {
      // Первая запись нового файла — созданием: занятое имя сервер отклоняет, а не затирает.
      await rpc.call("workflowSave", { path, source: rawSource !== null ? rawSource : compile(tree, engine), ...(create && savedVersion === -1 ? { create: true } : {}) });
      setSavedVersion(at);
      setSaving({ state: "idle" });
      onSaved?.();
    } catch (error) {
      setSaving({ state: "failed", message: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    // Настройки узла встают колонкой справа от дерева при любой ширине: узкая вкладка прокручивается вбок, а не прячет дерево.
    <div className="flex h-full min-h-0 min-w-0 overflow-x-auto">
      <WorkflowEditor
        agents={agents}
        providerCatalog={providers}
        previewEngine={engine}
        columns="all"
        selectedPath={selectedPath}
        onSelect={setSelectedPath}
        storageKey="flow:workflow-opener"
        editableCode
        agentFile={(agentPath, back) => <AgentDoc path={agentPath} leading={back} />}
        footer={
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-xs text-muted-foreground" title={path}>
              {saving.state === "failed" ? `Not saved: ${saving.message}` : version !== savedVersion ? "Unsaved changes" : path}
            </span>
            <Button size="sm" onClick={() => void save()} disabled={(!codeOnly && invalid > 0) || version === savedVersion || saving.state === "saving"}>
              Save
            </Button>
          </div>
        }
      />
    </div>
  );
}

/** Вид Kasimov по умолчанию: у Flow нет своих настроек просмотрщика, а без значений документ встал бы чёрным. */
const KASIMOV = parseKasimovSettings(undefined, NATIVE_VIEWER_TOKEN_DEFAULTS);

/**
 * Файл агента-шаблона над настройками шага — тот же просмотрщик Kasimov, что в Claude Config: Read, Write и Raw, запись
 * с проверкой версии. Ссылки из файла не уводят в другие файлы: сервер отдаёт только файлы агентов.
 */
function AgentDoc({ path, leading }: { path: string; leading: ReactNode }) {
  const rpc = useRpc<typeof workflowFilesRpcContract>();
  return (
    <MdDocView
      key={path}
      libraries={docLibraries}
      initialPath={path}
      load={(target) => rpc.call("agentDocRead", { path: target })}
      save={(target, content, expectedSha256) => rpc.call("agentDocWrite", { path: target, content, expectedSha256 })}
      resolveLinkTarget={() => null}
      vars={kasimovCssVars(KASIMOV)}
      {...kasimovFlags(KASIMOV)}
      leading={leading}
    />
  );
}
