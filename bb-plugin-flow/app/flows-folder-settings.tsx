// Секция настроек: папка этого компа, где flow лежат файлами, и итог последней
// сверки с ней. Путь сохраняется по уходу фокуса; итог приходит с сервера и
// обновляется по своему каналу.
import { useEffect, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";

import { Input } from "../components/ui/input";
import { FLOW_SYNC_CHANNEL } from "../lib/channels";
import { cn } from "../lib/utils";
import type { FlowSyncState, flowSyncRpcContract } from "../shared/contract";
import { LocaleProvider } from "./locale";
import { useMessages } from "./locale-context";

type Rpc = ReturnType<typeof useRpc<typeof flowSyncRpcContract>>;

function FlowsFolder() {
  const t = useMessages().settings;
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
      <Input
        aria-label={t.folderTitle}
        placeholder={t.folderPlaceholder}
        value={draft ?? state.dir}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className={cn("h-8 font-mono text-xs", (failed || status.kind === "error") && "border-destructive")}
      />
      {failed ? (
        <span className="text-xs text-destructive">{t.folderSaveFailed}</span>
      ) : status.kind === "error" ? (
        <span className="text-xs break-words text-destructive">{t.folderError(status.message)}</span>
      ) : (
        <span className="text-xs text-muted-foreground">{status.kind === "off" ? t.folderOff : status.kind === "pending" ? t.folderPending : t.folderSynced}</span>
      )}
    </div>
  );
}

export function FlowsFolderSection() {
  return (
    <LocaleProvider>
      <FlowsFolder />
    </LocaleProvider>
  );
}
