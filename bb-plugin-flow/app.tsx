// Фронт Flow: директива `::decision{id="…"}` рисует бриф в сообщении агента,
// `::command{id="…"}` — команду с переносом, копированием и вводом, `::rule{id="…"}` — правило на одобрение, страница
// Flow в левом меню правит flow и их этапы — выбор и создание живут в шапке
// той же панели, — а кнопка в композере нового треда
// выбирает, по какому flow пойдёт тред, а баннер над композером треда показывает
// прогресс flow; секции настроек плагина задают путь журнала решений и папку flow.
import { definePluginApp, useSettings } from "@get-bb/plugin-sdk/app";
import { registerSelectedThread } from "@bb-plugins/rail-collapse";

import { CommandDirective } from "./app/command";
import { RuleDirective } from "./app/rule-card";
import { FlowPicker } from "./app/flow-picker";
import { FlowsPage } from "./app/flows-page";
import { FlowsSettingsButton } from "./app/flows-settings-button";
import { FLOWS_PANEL_PATH } from "./lib/panel-path";
import { JournalDirsSection } from "./app/journal-settings";
import { AutomationRetrySection } from "./app/flow-settings-sections";
import { FlowsFolderSection } from "./app/flows-folder-settings";
import { ProgressBanner } from "./app/progress-banner";
import { SilentTurnBanner } from "./app/silent-turn-banner";
import { ThreadsPanelList } from "./app/threads-panel";
import { registerAwaitingStatus } from "./app/row-status";
import { systemLanguages } from "./app/locale-context";
import { lockAutoZoom } from "./app/viewport";
import { TaskPanel, TASK_PANEL_ACTION } from "./app/task-card";
import { DecisionDirective } from "./app/widget";
import { WorkflowOpener } from "./app/workflow-opener";
import { OWN_PLUGIN_ID } from "./core/plugin-id";
import { resolveLocale } from "./lib/i18n";
import { messages } from "./lib/messages";
import "./app/theme.css";

export default definePluginApp((app) => {
  // Каретка в поле на iPhone не приближает тред: предел масштаба на всю страницу с загрузки плагина до перезагрузки страницы.
  lockAutoZoom(document);
  app.slots.messageDirective({ id: "decision", component: DecisionDirective });
  app.slots.messageDirective({ id: "command", component: CommandDirective });
  // Правило в память или навык — с похожими местами и записью по «Записать» владельца.
  app.slots.messageDirective({ id: "rule", component: RuleDirective });
  // Файл workflow — .js из ~/.claude/workflows или .bb/workflows — открывается конструктором; прочие .js — превью bb.
  app.slots.fileOpener({ id: "workflow", title: "Workflow", extensions: ["js"], component: WorkflowOpener });
  // Задача из Демонстрации открывается сбоку своей вкладкой: чужую вкладку Tasks+ плагин открыть не может.
  app.slots.threadPanelAction({ id: TASK_PANEL_ACTION, title: "Task", icon: "ListTodo", component: TaskPanel });
  // Заголовок секции регистрируется один раз, до настроек плагина, поэтому идёт за языком браузера.
  const t = messages(resolveLocale(undefined, systemLanguages())).settings;
  // Шестерёнка в титул-баре, левее крестика хоста, открывает настройки плагина.
  app.slots.navPanel({ id: "flows", title: "Flow", icon: "Workflow", path: FLOWS_PANEL_PATH, component: FlowsPage, headerContent: FlowsSettingsButton });
  // На странице Flow панель тредов показывает список flow вместо тредов, если владелец включил это в настройках; в остальных местах — родной список тредов bb (хост не отдаёт `Original`, поэтому его подключает сам Flow).
  app.slots.experimental_threadList({ id: "threads-or-flows", title: "Threads, flows on the Flow page", description: "bb's threads list; on the Flow page it lists the flows instead when Flow's setting is on.", component: ThreadsPanelList });
  // Страница Flow открывает flow треда, с которого пришёл владелец, — тоже по настройке.
  registerSelectedThread(app, OWN_PLUGIN_ID, useSettings);
  app.composer.customize({ id: "flow", scopes: ["new-thread"], actions: [{ id: "flow-picker", component: FlowPicker }] });
  // Плашка немого хода: провайдер отказал, а bb показал пустой ход. Свой контейнер над контейнером состояния Flow.
  app.composer.customize({ id: "flow-silent-turn", scopes: ["thread"], banners: [{ id: "silent-turn", chrome: "bare", component: SilentTurnBanner }] });
  // Контейнер состояния Flow: пока прогон идёт — полоса этапов, без прогона и после завершённого — выбор flow.
  app.composer.customize({ id: "flow-progress", scopes: ["thread"], banners: [{ id: "progress", chrome: "bare", component: ProgressBanner }] });
  registerAwaitingStatus(app);
  app.slots.settingsSection({ id: "journal-dirs", title: t.journalTitle, description: t.journalDescription, component: JournalDirsSection });
  app.slots.settingsSection({ id: "automation-retry", title: t.retryTitle, description: t.retryDescription, component: AutomationRetrySection });
  app.slots.settingsSection({ id: "flows-folder", title: t.folderTitle, description: t.folderDescription, component: FlowsFolderSection });
});
