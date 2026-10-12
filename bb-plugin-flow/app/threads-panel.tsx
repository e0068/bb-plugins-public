// Содержимое левой панели bb: список тредов, а со включённой настройкой на странице Flow — список flow вместо тредов.
// Flow регистрирует слот списка тредов и сам отдаёт `Original` — настоящий список тредов bb — везде, где свой список не
// нужен: вне страницы Flow и при выключенной настройке. На телефоне панель — шторка, и на странице Flow в ней тоже список flow.
import { useLayoutEffect, useSyncExternalStore } from "react";
import { useSettings, type PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { watchRoutes } from "@bb-plugins/rail-collapse/dom";

import { FLOWS_IN_PANEL_SETTING } from "../lib/flows-in-panel-setting";
import { flowsSubPathOf } from "../lib/panel-path";
import { FlowsNav } from "./flows-list";
import { LocaleProvider } from "./locale";
import { registerPanelList } from "./panel-list-store";
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

export function ThreadsPanelList({ Original, isCompactViewport }: PluginThreadListProps) {
  const enabled = useSettings().values?.[FLOWS_IN_PANEL_SETTING] === true;
  const subPath = useFlowsSubPath();
  return enabled && subPath !== null ? <FlowsInPanel subPath={subPath} drawer={isCompactViewport} /> : <Original />;
}
