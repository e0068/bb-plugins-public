// bb-plugin-zz-pull-request — кнопка «Pull Request» в шапке треда.
//
// Слой UI: спрашивает бэкенд, показывать ли кнопку (prState), и по клику просит
// открыть PR (createPr). Ни git, ни GitHub здесь нет — только вызовы rpc.
import { useCallback, useEffect, useRef, useState } from "react";
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

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Не удалось открыть Pull Request.";
}

function PullRequestHeaderAction({ threadId }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [visible, setVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(() => {
    rpc.call("prState", { threadId }).then(
      (state) => {
        if (mounted.current) setVisible(state.visible);
      },
      () => {
        if (mounted.current) setVisible(false);
      },
    );
  }, [rpc, threadId]);

  // Первый запрос при монтировании и при смене треда.
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Коммит/смена ветки в окружении → сервер шлёт «changed» → перечитываем.
  useRealtime("changed", refresh);

  const create = useCallback(() => {
    if (submitting) return;
    setSubmitting(true);
    rpc.call("createPr", { threadId }).then(
      ({ number }) => {
        if (mounted.current) {
          setSubmitting(false);
          // PR открыт — кнопка больше не нужна (её роль только «создать»).
          // Вкладку в браузере не открываем: merge доступен прямо в BB.
          setVisible(false);
        }
        toast.success(`Pull Request #${number} открыт`);
      },
      (error: unknown) => {
        if (mounted.current) setSubmitting(false);
        toast.error(errorText(error));
      },
    );
  }, [rpc, submitting, threadId]);

  if (!visible) return null;

  return (
    <Button
      aria-label="Открыть Pull Request"
      className="gap-1.5 px-2 text-muted-foreground hover:text-foreground"
      disabled={submitting}
      onClick={create}
      size="sm"
      type="button"
      variant="ghost"
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

export default definePluginApp((app) => {
  app.slots.experimental_threadHeaderAction({
    id: "pull-request",
    title: "Открыть Pull Request",
    component: PullRequestHeaderAction,
  });
});
