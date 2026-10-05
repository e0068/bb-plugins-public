// Дерево flow слева на странице Flow: «История», за ней flow верхнего уровня
// по порядку коллекции, под каждым — flow, на которые он ссылается строкой
// «Flow», — та же раскладка, что в папке синхронизации, — и «+» в конце. Клик
// пишет flow в `subPath` панели, страница читает тот же адрес обратно; подсветка
// идёт за `flowById`, как и содержимое. Под деревом — папка синхронизации этого
// компа и итог последней сверки.
import { useEffect, useState } from "react";
import { useBbNavigate, useRealtime, useRpc, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";

import { flowOutline, freeFlowName } from "../core/flow-files";
import { addFlow, flowById, newFlow } from "../core/flows";
import { Icon } from "../components/ui/icon";
import { Input } from "../components/ui/input";
import { FLOW_SYNC_CHANNEL } from "../lib/channels";
import { cn } from "../lib/utils";
import { FLOWS_PANEL_PATH } from "../lib/panel-path";
import type { FlowSyncState, flowSyncRpcContract } from "../shared/contract";
import { HISTORY_SUB_PATH } from "./run-history";
import { useMessages } from "./locale-context";
import { updateFlowSettings, useFlowSettings } from "./stage-settings-store";

const ROW = "flex h-7 w-full min-w-0 items-center rounded-md px-2.5 text-left text-[13px] text-muted-foreground hover:bg-state-hover hover:text-foreground";
const ACTIVE_ROW = "bg-state-active font-medium text-foreground";
/** Сдвиг уровня дерева: rem на уровень, чтобы вложенность читалась и на узкой панели. */
const INDENT_REM = 0.875;

const newFlowId = (): string => `flow-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function FlowsTree({ subPath, className }: Pick<PluginNavPanelProps, "subPath"> & { className?: string }) {
  return (
    <aside className={cn("flex min-w-0 flex-col gap-4", className)}>
      <FlowsNav subPath={subPath} />
      <SyncFolder />
    </aside>
  );
}

function FlowsNav({ subPath }: Pick<PluginNavPanelProps, "subPath">) {
  const t = useMessages();
  const navigate = useBbNavigate();
  const { settings } = useFlowSettings();
  if (settings === null) return null;
  const history = subPath === HISTORY_SUB_PATH;
  const current = history ? null : flowById(settings, subPath);
  const open = (id: string) => navigate.toPluginPanel(FLOWS_PANEL_PATH, { subPath: id });
  const create = () => {
    const id = newFlowId();
    updateFlowSettings((s) => addFlow(s, newFlow(id, freeFlowName(s.flows, t.flows.newName))));
    open(id);
  };
  return (
    <nav aria-label={t.flows.list} className="flex flex-col gap-0.5">
      <button type="button" aria-current={history ? "page" : undefined} onClick={() => open(HISTORY_SUB_PATH)} className={cn(ROW, "gap-1.5", history && ACTIVE_ROW)}>
        <Icon name="Clock" aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate">{t.history.tab}</span>
      </button>
      {flowOutline(settings).map((row, i) => (
        <div key={`${row.id}-${i}`} data-tree-level={row.depth} style={{ paddingLeft: `${row.depth * INDENT_REM}rem` }}>
          <button
            type="button"
            aria-current={row.id === current?.id ? "page" : undefined}
            onClick={() => open(row.id)}
            title={row.name}
            className={cn(ROW, row.id === current?.id && ACTIVE_ROW)}
          >
            <span className="truncate">{row.name}</span>
          </button>
        </div>
      ))}
      <button
        type="button"
        aria-label={t.flows.add}
        title={t.flows.add}
        onClick={create}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground"
      >
        <Icon name="Plus" aria-hidden="true" className="size-4" />
      </button>
    </nav>
  );
}

type Rpc = ReturnType<typeof useRpc<typeof flowSyncRpcContract>>;

/** Папка синхронизации: сохраняется по уходу фокуса; итог сверки приходит с сервера и обновляется по своему каналу. */
function SyncFolder() {
  const t = useMessages().flows;
  const rpc: Rpc = useRpc<typeof flowSyncRpcContract>();
  const [state, setState] = useState<FlowSyncState | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const load = () => void rpc.call("getFlowSync", {}).then(setState, () => undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- чтение — на монтирование, а не на новый объект клиента
  useEffect(load, []);
  useRealtime(FLOW_SYNC_CHANNEL, load);
  if (state === null) return null;
  const save = async () => {
    if (draft === null || draft.trim() === state.dir) return setDraft(null);
    try {
      setState(await rpc.call("setFlowSyncDir", { dir: draft }));
      setFailed(false);
      setDraft(null);
    } catch {
      // Набранный путь остаётся в поле: владелец видит, что не сохранилось, и жмёт ещё раз, не перепечатывая.
      setFailed(true);
    }
  };
  const status = state.status;
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground" htmlFor="flow-sync-dir">
        {t.syncDir}
      </label>
      <Input
        id="flow-sync-dir"
        aria-label={t.syncDir}
        placeholder={t.syncDirPlaceholder}
        value={draft ?? state.dir}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className={cn("h-8 font-mono text-xs", (failed || status.kind === "error") && "border-destructive")}
      />
      {failed ? (
        <span className="text-xs text-destructive">{t.syncSaveFailed}</span>
      ) : status.kind === "error" ? (
        <span className="text-xs break-words text-destructive">{t.syncError(status.message)}</span>
      ) : (
        <span className="text-xs text-muted-foreground">{status.kind === "off" ? t.syncOff : status.kind === "pending" ? t.syncPending : t.synced}</span>
      )}
    </div>
  );
}
