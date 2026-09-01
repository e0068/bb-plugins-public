// bb-plugin-zz-pull-request — кнопки шапки треда: «Pull Request» и «Fast Forward».
//
// Слой UI: спрашивает бэкенд, показывать ли кнопку (prState / fastForwardState),
// и по клику просит действие (createPr / fastForward). Ни git, ни GitHub здесь
// нет — только вызовы rpc.
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  definePluginApp,
  useRealtime,
  useRpc,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { rpcContract } from "./server";

// Байт-в-байт оверрайд нативной кнопки шапки «Squash Merge»/«Merge» (variant
// outline size sm), извлечённый из бандла bb: h-7/px-2/cursor-pointer — часть
// общей базы _n, остальное — сам оверрайд. У нас были лишние text-muted-foreground
// и hover:text-foreground (второй и так есть в variant=outline) — из-за них
// текст кнопки был заметно светлее нативного; gap-1.5 сужал зазор мимо
// стандартного gap-2 из базовых cva-классов кнопки. Все три убраны.
const HEADER_ACTION_CLASS =
  "h-7 border-border/70 bg-transparent px-2 font-normal hover:bg-state-hover";

// У «changed» нет вида события на смену статуса PR саму по себе — только на
// git-refs/статус окружения. Закрытие или мёрдж PR вручную на GitHub ничего
// из этого не трогает, поэтому «changed» может не прийти вовсе. Поллим раз в
// 20 секунд как подстраховку — дёшево (один RPC), надёжнее, чем ждать
// несуществующее событие.
const POLL_INTERVAL_MS = 20_000;

/** Подписка на состояние видимости кнопки: первый запрос + рефетч по «changed» + поллинг. */
function useVisible(
  fetch: () => Promise<{ visible: boolean }>,
  mounted: RefObject<boolean>,
): boolean {
  const [visible, setVisible] = useState(false);
  const refresh = useCallback(() => {
    fetch().then(
      (state) => {
        if (mounted.current) setVisible(state.visible);
      },
      () => {
        if (mounted.current) setVisible(false);
      },
    );
  }, [fetch, mounted]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  // Коммит/смена ветки/refs в окружении → сервер шлёт «changed» → перечитываем.
  useRealtime("changed", refresh);
  // Изменение статуса PR на GitHub само по себе «changed» не шлёт — поллинг ловит это.
  useEffect(() => {
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);
  return visible;
}

function useMounted(): RefObject<boolean> {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function PullRequestHeaderAction({ threadId }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const mounted = useMounted();
  const [submitting, setSubmitting] = useState(false);
  const fetch = useCallback(
    () => rpc.call("prState", { threadId }),
    [rpc, threadId],
  );
  const visible = useVisible(fetch, mounted);

  const create = useCallback(() => {
    if (submitting) return;
    setSubmitting(true);
    rpc.call("createPr", { threadId }).then(
      ({ number }) => {
        if (mounted.current) setSubmitting(false);
        // PR открыт — кнопка больше не нужна (её роль только «создать»).
        // Вкладку в браузере не открываем: merge доступен прямо в BB.
        toast.success(`Pull Request #${number} открыт`);
      },
      (error: unknown) => {
        if (mounted.current) setSubmitting(false);
        toast.error(errorText(error, "Не удалось открыть Pull Request."));
      },
    );
  }, [rpc, submitting, threadId, mounted]);

  if (!visible) return null;

  return (
    <Button
      aria-label="Открыть Pull Request"
      className={HEADER_ACTION_CLASS}
      disabled={submitting}
      onClick={create}
      size="sm"
      type="button"
      variant="outline"
    >
      <Icon
        aria-hidden="true"
        className={submitting ? "size-3.5 animate-spin" : "size-3.5"}
        name={submitting ? "Loading" : "GitPullRequest"}
      />
      PR
    </Button>
  );
}

function FastForwardHeaderAction({ threadId }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const mounted = useMounted();
  const [submitting, setSubmitting] = useState(false);
  const fetch = useCallback(
    () => rpc.call("fastForwardState", { threadId }),
    [rpc, threadId],
  );
  const visible = useVisible(fetch, mounted);

  const run = useCallback(() => {
    if (submitting) return;
    setSubmitting(true);
    rpc.call("fastForward", { threadId }).then(
      () => {
        if (mounted.current) setSubmitting(false);
        // Ветка перемотана — «changed» перечитает состояние и спрячет кнопку.
        toast.success("Ветка перемотана на main");
      },
      (error: unknown) => {
        if (mounted.current) setSubmitting(false);
        toast.error(errorText(error, "Не удалось перемотать ветку."));
      },
    );
  }, [rpc, submitting, threadId, mounted]);

  if (!visible) return null;

  return (
    <Button
      aria-label="Догнать main (fast-forward)"
      className={HEADER_ACTION_CLASS}
      disabled={submitting}
      onClick={run}
      size="sm"
      type="button"
      variant="outline"
    >
      <Icon
        aria-hidden="true"
        className={submitting ? "size-3.5 animate-spin" : "size-3.5"}
        name={submitting ? "Loading" : "ArrowDown"}
      />
      Fast Forward
    </Button>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadHeaderAction({
    id: "fast-forward",
    title: "Догнать main (fast-forward)",
    component: FastForwardHeaderAction,
  });
  app.slots.experimental_threadHeaderAction({
    id: "pull-request",
    title: "Открыть Pull Request",
    component: PullRequestHeaderAction,
  });
});
