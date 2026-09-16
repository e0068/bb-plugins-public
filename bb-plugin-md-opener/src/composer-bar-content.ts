// Оболочка — стык с миром вместо чистого ядра. Content script не имеет
// useSettings: SDK data hooks падают в его headless-корне (нет
// QueryClientProvider — см. memory/decisions/row-status-rpc-not-frontend-hooks.md,
// тот же вывод для другого контент-скрипта этого репозитория). Поэтому флаг
// «Kasimov: use in Composer» читается обычным same-origin fetch к RPC
// плагина, тем же путём, каким его дёргает `useRpc` изнутри: `POST
// /api/v1/plugins/<pluginId>/rpc/<method>`, ответ `{ ok, result }`.
import type { PluginContentScriptContext } from "@get-bb/plugin-sdk/app";

import { mountComposerFormatBar } from "./composer-bar";

async function fetchComposerBarEnabled(
  pluginId: string,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    const res = await fetch(`/api/v1/plugins/${pluginId}/rpc/composerBarEnabled`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal,
    });
    if (!res.ok) return false;
    const body: { ok: boolean; result?: { enabled: boolean } } = await res.json();
    return body.ok ? (body.result?.enabled ?? false) : false;
  } catch {
    return false;
  }
}

/**
 * Поднимает панель форматирования Касимова над композером, только если
 * настройка плагина это разрешает. Проверяет `signal` ещё раз после ответа:
 * пока fetch летел, content script мог быть снят (перезагрузка плагина) —
 * тогда панель поднимать уже некому её снять.
 */
export async function mountComposerFormatBarIfEnabled(
  context: PluginContentScriptContext,
): Promise<(() => void) | void> {
  const enabled = await fetchComposerBarEnabled(context.pluginId, context.signal);
  if (!enabled || context.signal.aborted) return;
  return mountComposerFormatBar();
}
