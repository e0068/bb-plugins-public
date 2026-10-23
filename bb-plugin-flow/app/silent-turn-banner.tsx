// Плашка немого хода над композером треда: агент закрыл ход без ответа,
// потому что провайдер отказал, а bb показал пустой ход. Причину держит
// сервер (server/silent-turn.ts); плашка опрашивает его раз в 5 секунд, как
// баннер прогресса, и пропадает, когда тред начинает следующий ход.
import { useEffect, useRef, useState } from "react";
import { useComposerView, useRpc } from "@get-bb/plugin-sdk/app";

import { Icon } from "../components/ui/icon";
import type { SilentTurnView, silentTurnRpcContract } from "../shared/contract";
import { LocaleProvider } from "./locale";
import { useMessages } from "./locale-context";

const POLL_MS = 5000;

export function SilentTurnBanner() {
  return (
    <LocaleProvider>
      <Notice />
    </LocaleProvider>
  );
}

function Notice() {
  const t = useMessages();
  const { scope } = useComposerView();
  const threadId = scope.kind === "thread" ? scope.threadId : null;
  const silent = useSilentTurn(threadId);
  if (silent === null) return null;
  const reason = silent.kind === "quota" ? t.silentTurn.quota : (silent.message ?? t.silentTurn.unknown);
  return (
    <div data-silent-turn role="status" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <Icon name="AlertCircle" aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <div className="font-medium">{t.silentTurn.title}</div>
        <div className="break-words text-xs opacity-90">{reason}</div>
        {silent.kind === "quota" && silent.message !== null && <div className="mt-0.5 break-words text-2xs opacity-70">{silent.message}</div>}
      </div>
    </div>
  );
}

/** Немой ход треда; `null` — его нет или сервер ещё не ответил. */
function useSilentTurn(threadId: string | null): SilentTurnView | null {
  const rpc = useRpc<typeof silentTurnRpcContract>();
  // Клиент RPC приходит новым объектом на каждый рендер: без ссылки опрос перезапускался бы каждую перерисовку.
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const [silent, setSilent] = useState<SilentTurnView | null>(null);
  useEffect(() => {
    setSilent(null);
    if (threadId === null) return;
    let alive = true;
    const pull = () =>
      rpcRef.current.call("getSilentTurn", { threadId }).then(
        (next) => alive && setSilent(next),
        // Плашка — справка: пропущенный такт не стоит тоста.
        () => undefined,
      );
    void pull();
    const timer = setInterval(() => void pull(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [threadId]);
  return silent;
}
