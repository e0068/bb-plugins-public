// Содержимое левой панели bb: список тредов, а со включённой настройкой на странице Flow — список flow вместо тредов.
// Flow регистрирует слот списка тредов и показывает настоящие треды везде, где свой список не нужен: вне страницы Flow и при
// выключенной настройке. Хост 0.46.0 не отдаёт слоту `Original`, поэтому треды рисует встроенный список bb, подключённый
// Flow (`builtin-thread-list.ts`), а если он не подключился или упал — запасной простой список (`fallback-thread-list.tsx`).
// На телефоне панель — шторка, и на странице Flow в ней тоже список flow.
import { useLayoutEffect, useSyncExternalStore } from "react";
import { useSettings, type PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { watchRoutes } from "@bb-plugins/rail-collapse/dom";

import { FLOWS_IN_PANEL_SETTING } from "../lib/flows-in-panel-setting";
import { flowsSubPathOf } from "../lib/panel-path";
import { chooseThreadListSource } from "../lib/thread-list-source";
import { useBuiltinThreadList } from "./builtin-thread-list";
import { FallbackThreadList } from "./fallback-thread-list";
import { FlowsNav } from "./flows-list";
import { LocaleProvider } from "./locale";
import { registerPanelList } from "./panel-list-store";
import { RenderGuard } from "./render-guard";
import { useFlowSettingsLive } from "./stage-settings-store";

const subscribe = (listener: () => void) => watchRoutes(window, listener);
const snapshot = () => flowsSubPathOf(window.location.pathname);

/** Адрес страницы Flow из окна: панель тредов не получает его свойствами. */
const useFlowsSubPath = (): string | null => useSyncExternalStore(subscribe, snapshot, () => null);

function FlowsInPanel({ subPath, drawer }: { subPath: string; drawer: boolean }) {
  useFlowSettingsLive();
  // Страница Flow прячет свой список, пока этот стоит в постоянной панели; шторку телефона закрывают, и странице без
  // своего списка нечего показать.
  useLayoutEffect(() => (drawer ? undefined : registerPanelList()), [drawer]);
  return (
    <LocaleProvider>
      <div className="h-full overflow-y-auto px-2 py-2">
        <FlowsNav subPath={subPath} />
      </div>
    </LocaleProvider>
  );
}

type SlotProps = Omit<PluginThreadListProps, "Original"> & Partial<Pick<PluginThreadListProps, "Original">>;

export function ThreadsPanelList({ Original, ...props }: SlotProps) {
  const enabled = useSettings().values?.[FLOWS_IN_PANEL_SETTING] === true;
  const subPath = useFlowsSubPath();
  const builtin = useBuiltinThreadList(Original === undefined && !(enabled && subPath !== null));
  const source = chooseThreadListSource({ subPath, enabled, hostOriginal: Original !== undefined, builtin: builtin.status });
  const fallback = <FallbackThreadList activeThreadId={props.activeThreadId} onNavigate={props.onNavigate} />;
  switch (source.kind) {
    case "flows":
      return <FlowsInPanel subPath={source.subPath} drawer={props.isCompactViewport} />;
    case "original":
      return Original === undefined ? null : <Original />;
    case "builtin":
      return builtin.status === "ready" ? (
        <RenderGuard fallback={fallback}>
          <builtin.Component {...props} />
        </RenderGuard>
      ) : null;
    case "pending":
      return null;
    case "fallback":
      return fallback;
  }
}
