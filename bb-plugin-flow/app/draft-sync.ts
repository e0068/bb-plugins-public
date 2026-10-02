// Черновик брифа на сервере: владелец, написавший в чат вместо отправки, возвращает бриф агенту, и выбор должен
// дожить до нового брифа — а localStorage окна сервер не видит. Правка уходит с короткой паузой, последняя — и при
// размонтировании. Сбой записи молчит: черновик в окне остаётся, теряется только перенос.
import { useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef } from "react";

import type { briefDraftRpcContract } from "../shared/contract";
import type { Draft } from "./draft";
import { encodeDraft } from "./draft-storage";

/** Пауза после правки: клик по варианту и сразу Enter в чате должен успеть уйти. */
export const DRAFT_SYNC_MS = 300;

/** Отправитель правок черновика брифа на сервер; какая правка считается правкой, решает `useStoredDraft`. */
export function useDraftSender(briefId: string): (draft: Draft) => void {
  const rpc = useRpc<typeof briefDraftRpcContract>();
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const pending = useRef<Draft | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    const next = pending.current;
    pending.current = null;
    if (next === null) return;
    try {
      void rpcRef.current.call("saveBriefDraft", { id: briefId, draft: encodeDraft(next) }).catch(() => undefined);
    } catch {
      // нет RPC — переносить нечего
    }
  }, [briefId]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      flush();
    },
    [flush],
  );

  return useCallback(
    (draft: Draft) => {
      pending.current = draft;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(flush, DRAFT_SYNC_MS);
    },
    [flush],
  );
}
