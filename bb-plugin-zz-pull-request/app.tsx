// bb-plugin-zz-pull-request — кнопки шапки треда: «Pull Request», «Fast Forward»,
// «Merge» (и её плашка «main не подтянут» после мёржа).
//
// Слой UI: спрашивает бэкенд, показывать ли кнопку (prState / fastForwardState /
// mergeState / mainPullState), и по клику просит действие (createPr /
// fastForward / mergePr). Ни git, ни GitHub здесь нет — только вызовы rpc.
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  definePluginApp,
  useRealtime,
  useRpc,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
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

/**
 * Общая схема подписки для всех состояний кнопок шапки: первый запрос +
 * рефетч по «changed» (коммит/смена ветки/refs в окружении) + поллинг раз в
 * {@link POLL_INTERVAL_MS} (изменение статуса PR на GitHub само по себе
 * «changed» не шлёт — поллинг ловит это). Три состояния (видимость PR/Fast
 * Forward, mergeState, mainPullState) отличаются только формой ответа и
 * фолбэком на ошибку — сама подписка одна.
 */
function usePolledState<T>(
  fetch: () => Promise<T>,
  fallback: T,
  mounted: RefObject<boolean>,
): T {
  const [state, setState] = useState<T>(fallback);
  const refresh = useCallback(() => {
    fetch().then(
      (next) => {
        if (mounted.current) setState(next);
      },
      () => {
        if (mounted.current) setState(fallback);
      },
    );
  }, [fetch, fallback, mounted]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useRealtime("changed", refresh);
  useEffect(() => {
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);
  return state;
}

const VISIBLE_FALLBACK: { visible: boolean } = { visible: false };

/** Подписка на состояние видимости кнопки. */
function useVisible(
  fetch: () => Promise<{ visible: boolean }>,
  mounted: RefObject<boolean>,
): boolean {
  return usePolledState(fetch, VISIBLE_FALLBACK, mounted).visible;
}

interface MergeState {
  visible: boolean;
  indicator: "success" | "failure" | "pending" | "neutral" | "unknown";
  prUrl: string | null;
}

const MERGE_STATE_FALLBACK: MergeState = { visible: false, indicator: "unknown", prUrl: null };

interface MainPullState {
  attempted: boolean;
  ok: boolean;
  reason: string | null;
}

const MAIN_PULL_STATE_FALLBACK: MainPullState = { attempted: false, ok: true, reason: null };

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

// Иконка кнопки Merge отражает агрегированный статус проверок PR (checks.state
// из bb, см. src/core/merge-readiness.ts): «Pull Request» гаснет ровно тогда,
// когда «Merge» загорается, — это одна и та же роль кнопки на двух стадиях жизни PR.
const MERGE_INDICATOR_ICON: Record<MergeState["indicator"], IconName> = {
  success: "CircleCheck",
  failure: "CircleX",
  pending: "Clock",
  neutral: "GitMerge",
  unknown: "CircleQuestion",
};

const MERGE_INDICATOR_LABEL: Record<MergeState["indicator"], string> = {
  success: "проверки прошли",
  failure: "проверки не прошли",
  pending: "проверки выполняются",
  neutral: "проверок нет",
  unknown: "статус проверок неизвестен",
};

function MergeHeaderAction({ threadId }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const mounted = useMounted();
  const [submitting, setSubmitting] = useState(false);
  const fetchMerge = useCallback(() => rpc.call("mergeState", { threadId }), [rpc, threadId]);
  const { visible, indicator } = usePolledState(fetchMerge, MERGE_STATE_FALLBACK, mounted);
  // После мёржа кнопка гаснет (visible: false) — на её месте показываем,
  // подтянулся ли локальный main (см. memory/decisions/local-main-pull-after-merge.md).
  const fetchMainPull = useCallback(
    () => rpc.call("mainPullState", { threadId }),
    [rpc, threadId],
  );
  const mainPull = usePolledState(fetchMainPull, MAIN_PULL_STATE_FALLBACK, mounted);

  const merge = useCallback(() => {
    if (submitting) return;
    setSubmitting(true);
    rpc.call("mergePr", { threadId }).then(
      () => {
        if (mounted.current) setSubmitting(false);
        toast.success("Pull Request смёржен");
      },
      (error: unknown) => {
        if (mounted.current) setSubmitting(false);
        toast.error(errorText(error, "Не удалось смёржить Pull Request."));
      },
    );
  }, [rpc, submitting, threadId, mounted]);

  if (!visible) {
    if (!mainPull.attempted || mainPull.ok) return null;
    return (
      <Button
        aria-label={`Локальный main не подтянут: ${mainPull.reason ?? "неизвестная причина"}`}
        className={HEADER_ACTION_CLASS}
        disabled
        size="sm"
        type="button"
        variant="outline"
      >
        <Icon aria-hidden="true" className="size-3.5" name="AlertTriangle" />
        main не подтянут
      </Button>
    );
  }

  return (
    <Button
      aria-label={`Смёржить Pull Request (${MERGE_INDICATOR_LABEL[indicator]})`}
      className={HEADER_ACTION_CLASS}
      disabled={submitting}
      onClick={merge}
      size="sm"
      type="button"
      variant="outline"
    >
      <Icon
        aria-hidden="true"
        className={submitting ? "size-3.5 animate-spin" : "size-3.5"}
        name={submitting ? "Loading" : MERGE_INDICATOR_ICON[indicator]}
      />
      Merge
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
  // Регистрируется последней среди кнопок этого плагина — занимает то же
  // крайнее правое место, что держала кнопка «Pull Request»
  // (memory/decisions/pr-button-rightmost-via-plugin-id.md), пока живой PR не
  // открыт: ровно одна из двух видна в любой момент.
  app.slots.experimental_threadHeaderAction({
    id: "merge",
    title: "Смёржить Pull Request",
    component: MergeHeaderAction,
  });
});
