// Слой 4 — оболочка UI: живой список черновиков и обмен с композером.
//
// Кнопка, секция Home и баннер треда — разные монтирования без общего
// состояния. Каждое читает список по RPC и перечитывает его по сигналу
// сервера и после переподключения: сигналы не переигрываются.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  experimental_useSidebarThreads,
  useComposer,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  type PluginComposerScope,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { DRAFTS_CHANGED, isBlank, type Draft, type DraftList } from "../core/drafts";
import { placeOf, type Where } from "../core/place";
import type { rpcContract } from "../server";

/** Клиент RPC приходит новым объектом на каждый рендер — держим его ссылкой. */
function useRpcRef() {
  const rpc = useRpc<typeof rpcContract>();
  const ref = useRef(rpc);
  ref.current = rpc;
  return ref;
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Провал записи виден тостом: молча потерянный черновик хуже шума. */
export function reportFailure(error: unknown): void {
  toast.error(`Draft was not saved: ${errorText(error)}`);
}

/** Черновики новыми вперёд; null, пока первый ответ не пришёл. */
export function useDrafts(): DraftList | null {
  const rpc = useRpcRef();
  const [drafts, setDrafts] = useState<DraftList | null>(null);

  const load = useCallback(() => {
    rpc.current.call("list", null).then(
      ({ drafts: next }) => setDrafts(next),
      () => {},
    );
  }, [rpc]);

  useEffect(load, [load]);
  useRealtime(DRAFTS_CHANGED, load);

  const connection = useRealtimeConnectionState();
  const previous = useRef(connection);
  useEffect(() => {
    if (connection === "connected" && previous.current !== "connected") load();
    previous.current = connection;
  }, [connection, load]);

  return drafts;
}

/** Откуда пишет композер: тред или Home с его проектом; прочие области не наши. */
export function whereOf(scope: PluginComposerScope): Where | null {
  switch (scope.kind) {
    case "thread":
    case "queued-message":
      return { threadId: scope.threadId };
    case "new-thread":
      return { projectId: scope.projectId };
    case "side-chat":
      return null;
  }
}

export function useDraftActions() {
  const rpc = useRpcRef();
  const sidebar = experimental_useSidebarThreads();
  return {
    save: (where: Where, text: string) => rpc.current.call("save", { text, place: placeOf(where, sidebar) }),
    /** Скрытый слот композера: пустой текст гасит слот, непустой переписывает. */
    autosave: (where: Where, text: string) => rpc.current.call("autosave", { text, place: placeOf(where, sidebar) }),
    remove: (id: string) => rpc.current.call("remove", { id }),
    /** Снимает черновик; непустой текст композера встаёт на его место. */
    swap: (draft: Draft, where: Where, current: string) =>
      rpc.current.call("swap", {
        takeId: draft.id,
        put: isBlank(current) ? null : { text: current, place: placeOf(where, sidebar) },
      }),
  };
}

/**
 * Клик по карточке: обмен на сервере, затем текст черновика — в композер.
 * Пока обмен в пути, следующие клики не принимаются: оба обмена прочли бы
 * один и тот же текст композера, и один черновик пропал бы, а другой задвоился.
 */
export function useSendToComposer(where: Where): { send: (draft: Draft) => void; busy: boolean } {
  const composer = useComposer();
  const actions = useDraftActions();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);

  const send = (draft: Draft) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    actions
      .swap(draft, where, composer.text)
      .then(({ taken }) => {
        if (taken === null) return;
        composer.setText(taken.text);
        composer.focus();
      }, reportFailure)
      .finally(() => {
        inFlight.current = false;
        setBusy(false);
      });
  };

  return { send, busy };
}
