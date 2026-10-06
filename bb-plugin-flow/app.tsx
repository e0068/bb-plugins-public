// Фронт Flow: директива `::decision{id="…"}` рисует бриф в сообщении агента,
// `::command{id="…"}` — команду с переносом, копированием и вводом, страница
// Flow в левом меню правит flow и их этапы — выбор и создание живут в шапке
// той же панели, — а кнопка в композере нового треда
// выбирает, по какому flow пойдёт тред, а баннер над композером треда показывает
// прогресс flow; секции настроек плагина задают путь журнала решений и папку flow.
import { definePluginApp } from "@get-bb/plugin-sdk/app";

import { CommandDirective } from "./app/command";
import { FlowPicker } from "./app/flow-picker";
import { FlowsPage } from "./app/flows-page";
import { FlowsSettingsButton } from "./app/flows-settings-button";
import { FLOWS_PANEL_PATH } from "./lib/panel-path";
import { JournalDirsSection } from "./app/journal-settings";
import { AutomationRetrySection } from "./app/flow-settings-sections";
import { FlowsFolderSection } from "./app/flows-folder-settings";
import { ProgressBanner } from "./app/progress-banner";
import { registerAwaitingStatus } from "./app/row-status";
import { systemLanguages } from "./app/locale-context";
import { lockAutoZoom } from "./app/viewport";
import { DecisionDirective } from "./app/widget";
import { resolveLocale } from "./lib/i18n";
import { messages } from "./lib/messages";

export default definePluginApp((app) => {
  // Каретка в поле на iPhone не приближает тред: предел масштаба на всю страницу с загрузки плагина до перезагрузки страницы.
  lockAutoZoom(document);
  app.slots.messageDirective({ id: "decision", component: DecisionDirective });
  app.slots.messageDirective({ id: "command", component: CommandDirective });
  // Заголовок секции регистрируется один раз, до настроек плагина, поэтому идёт за языком браузера.
  const t = messages(resolveLocale(undefined, systemLanguages())).settings;
  // Шестерёнка в титул-баре, левее крестика хоста, открывает настройки плагина.
  app.slots.navPanel({ id: "flows", title: "Flow", icon: "Workflow", path: FLOWS_PANEL_PATH, component: FlowsPage, headerContent: FlowsSettingsButton });
  app.composer.customize({ id: "flow", scopes: ["new-thread"], actions: [{ id: "flow-picker", component: FlowPicker }] });
  // Контейнер состояния Flow: пока прогон идёт — полоса этапов, без прогона и после завершённого — выбор flow.
  app.composer.customize({ id: "flow-progress", scopes: ["thread"], banners: [{ id: "progress", chrome: "bare", component: ProgressBanner }] });
  registerAwaitingStatus(app);
  app.slots.settingsSection({ id: "journal-dirs", title: t.journalTitle, description: t.journalDescription, component: JournalDirsSection });
  app.slots.settingsSection({ id: "automation-retry", title: t.retryTitle, description: t.retryDescription, component: AutomationRetrySection });
  app.slots.settingsSection({ id: "flows-folder", title: t.folderTitle, description: t.folderDescription, component: FlowsFolderSection });
});
