// Кнопки в титул-баре страницы Flow, левее крестика хоста: часы открывают историю прогонов, а шестерёнка правее ведёт на страницу
// настроек плагина в bb. Навигации на неё в SDK нет, а внутренние ссылки хост
// перехватывает только в теле слота — шапку он в перехватчик не заворачивает.
// Поэтому обычный клик кнопка проводит сама: новая запись истории и popstate,
// на который роутер bb перечитывает адрес, — переход без перезагрузки, как из
// Tools. Клик с модификатором остаётся браузеру, как у любой ссылки.
import type { MouseEvent } from "react";
import { useBbNavigate, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";

import { Button } from "../components/ui/button";
import { Icon } from "../components/ui/icon";
import { cn } from "../lib/utils";
import { FLOWS_PANEL_PATH, SETTINGS_ROUTE } from "../lib/panel-path";
import { LocaleProvider } from "./locale";
import { useMessages } from "./locale-context";
import { HISTORY_SUB_PATH } from "./run-history";

const plainClick = (event: MouseEvent): boolean => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

/** Запись истории той же формы, что держит роутер bb, на шаг дальше — popstate читается как переход вперёд. */
const nextHistoryState = (state: unknown): unknown => {
  if (typeof state !== "object" || state === null) return state;
  const entry = state as Record<string, unknown>;
  return Object.fromEntries(Object.entries(entry).map(([key, value]) => [key, (key === "__TSR_index" || key === "idx") && typeof value === "number" ? value + 1 : value]));
};

const openSettings = (event: MouseEvent<HTMLAnchorElement>) => {
  if (!plainClick(event)) return;
  event.preventDefault();
  window.history.pushState(nextHistoryState(window.history.state), "", SETTINGS_ROUTE);
  window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
};

function SettingsLink() {
  const t = useMessages();
  return (
    <Button asChild variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground hover:text-foreground">
      <a href={SETTINGS_ROUTE} aria-label={t.flows.settings} title={t.flows.settings} onClick={openSettings}>
        <Icon name="Settings" aria-hidden="true" className="size-4" />
      </a>
    </Button>
  );
}

/** История прогонов: та же кнопка, что шестерёнка; при открытой истории она текущая. */
function HistoryButton({ open }: { open: boolean }) {
  const t = useMessages();
  const navigate = useBbNavigate();
  return (
    <Button asChild variant="ghost" size="icon" className={cn("size-7 shrink-0 text-muted-foreground hover:text-foreground", open && "text-foreground")}>
      <button
        type="button"
        aria-label={t.history.tab}
        title={t.history.tab}
        aria-current={open ? "page" : undefined}
        onClick={() => navigate.toPluginPanel(FLOWS_PANEL_PATH, { subPath: HISTORY_SUB_PATH })}
      >
        <Icon name="Clock" aria-hidden="true" className="size-4" />
      </button>
    </Button>
  );
}

export function FlowsSettingsButton({ subPath }: Pick<PluginNavPanelProps, "subPath">) {
  return (
    <LocaleProvider>
      <HistoryButton open={subPath === HISTORY_SUB_PATH} />
      <SettingsLink />
    </LocaleProvider>
  );
}
