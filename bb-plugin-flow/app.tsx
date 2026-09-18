// Фронт Flow: директива `::decision{id="…"}` рисует бриф в сообщении агента,
// `::command{id="…"}` — команду с переносом, копированием и вводом, страница
// Flow в левом меню правит flow и их этапы, а кнопка в композере нового треда
// выбирает, по какому flow пойдёт тред, а баннер над композером треда показывает
// прогресс flow; секция настроек плагина задаёт путь журнала решений.
import { definePluginApp } from "@get-bb/plugin-sdk/app";

import { CommandDirective } from "./app/command";
import { FlowPicker } from "./app/flow-picker";
import { FLOWS_PANEL_PATH, FlowsPage } from "./app/flows-page";
import { JournalDirsSection } from "./app/journal-settings";
import { ProgressBanner } from "./app/progress-banner";
import { registerAwaitingStatus } from "./app/row-status";
import { systemLanguages } from "./app/locale-context";
import { DecisionDirective } from "./app/widget";
import { resolveLocale } from "./lib/i18n";
import { messages } from "./lib/messages";

export default definePluginApp((app) => {
  app.slots.messageDirective({ id: "decision", component: DecisionDirective });
  app.slots.messageDirective({ id: "command", component: CommandDirective });
  // Заголовок секции регистрируется один раз, до настроек плагина, поэтому идёт за языком браузера.
  const t = messages(resolveLocale(undefined, systemLanguages())).settings;
  app.slots.navPanel({ id: "flows", title: "Flow", icon: "Workflow", path: FLOWS_PANEL_PATH, component: FlowsPage });
  app.composer.customize({ id: "flow", scopes: ["new-thread"], actions: [{ id: "flow-picker", component: FlowPicker }] });
  app.composer.customize({ id: "flow-progress", scopes: ["thread"], banners: [{ id: "progress", chrome: "bare", component: ProgressBanner }] });
  registerAwaitingStatus(app);
  app.slots.settingsSection({ id: "journal-dirs", title: t.journalTitle, description: t.journalDescription, component: JournalDirsSection });
});
