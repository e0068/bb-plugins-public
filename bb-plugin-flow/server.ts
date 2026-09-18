// Бэкенд Flow: инструменты агента `ask_decision`, `share_command` и `flow_stage`, исполнитель автоматизаций, коллекция
// flow и flow тредов, настройка языка и RPC виджетов поверх kv плагина.
import { randomBytes } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { createSteps } from "./packages/automation-steps/index";
import { OWN_PLUGIN_ID } from "./core/plugin-id";
import { registerApi } from "./server/api";
import { registerAskTool } from "./server/ask-tool";
import { scriptStep } from "./server/script-step";
import { createAutomationRunner, externalStep, registerAutomationRunner } from "./server/automation-runner";
import { automationsBridge } from "./server/automations";
import { registerCommands } from "./server/command";
import { createJournalDirStore } from "./server/dir-settings";
import { registerJournalSettingsApi } from "./server/journal-settings-api";
import { writeDecision } from "./server/journal-writer";
import { readClaudeTranscript, readPlanning, readWindowCost } from "./server/planning";
import { createProgress, registerProgress } from "./server/progress";
import { registerFlowPickerApi } from "./server/flow-picker-api";
import { createFlowSettings } from "./server/flow-settings";
import { registerFlowTools } from "./server/flow-tools";
import { registerFlowSettingsApi } from "./server/settings-api";
import { hostCatalogSources, hostRootSkillSources, hostSkillFileSources, readRootSkill, readSkillFile, readStageCatalog } from "./server/stage-catalog";
import { revealInFinderHere } from "./packages/reveal-in-finder/index";
import { createStore } from "./server/store";
import { createThreadFlows } from "./server/thread-flows";
import { registerVoiceApi } from "./server/voice";
import { flowById, stageSettingsOf } from "./core/flows";
import { LANGUAGE_OPTIONS, LANGUAGE_SETTING, LANGUAGE_SYSTEM } from "./lib/i18n";

/** Время в base36 спереди — идентификаторы сортируются по созданию. */
const newId = (): string => `${Date.now().toString(36)}${randomBytes(6).toString("hex")}`;
const now = (): string => new Date().toISOString();

export default async function plugin(bb: BbPluginApi): Promise<void> {
  // Язык читает фронт: System идёт за языком браузера, который знает только он.
  bb.settings.define({
    [LANGUAGE_SETTING]: { type: "select", label: "Language", description: "Language of the brief, the settings page and the answer sent to the thread. System follows the browser language.", options: [...LANGUAGE_OPTIONS], default: LANGUAGE_SYSTEM },
  });
  const store = createStore(bb.storage.kv);
  const flows = await createFlowSettings(bb.storage.kv);
  const threads = await createThreadFlows(bb.storage.kv);
  bb.events.on("thread.created", threads.onThreadCreated);
  bb.events.on("thread.deleted", threads.onThreadDeleted);
  const stagesOf = (threadId: string) => {
    const settings = flows.current();
    return stageSettingsOf(settings, flowById(settings, threads.flowOf(threadId)));
  };
  const flowNameOf = (threadId: string) => flowById(flows.current(), threads.flowOf(threadId)).name;
  // Automations — отдельный плагин: события Flow и этапы-автоматизации идут к нему по HTTP, без него Flow работает как раньше.
  const automations = automationsBridge(bb);
  const emit = (trigger: Parameters<typeof automations.emit>[0], threadId: string, context?: { stageId?: string }) => void automations.emit(trigger, threadId, context);
  // Прогресс и исполнитель ссылаются друг на друга: правка прогресса продвигает автоматизации, исполнитель пишет прогресс.
  let advance: (threadId: string) => void = () => undefined;
  // Ход агента идёт, пока тред в статусе active: значок этапа навыка без хода не мерцает.
  const thread = async (threadId: string) => {
    const row = await bb.sdk.threads.get({ threadId });
    return { environmentId: row.environmentId, active: row.status === "active", providerId: row.providerId };
  };
  const providers = () => bb.sdk.providers.list();
  const progress = createProgress(bb.storage.kv, { onChange: (threadId) => advance(threadId) });
  const runner = createAutomationRunner({
    progress,
    store,
    stages: stagesOf,
    // Своей настройки токена у Flow нет: шаги берут токен у `gh auth token` на машине bb.
    steps: createSteps({ sdk: bb.sdk, kv: bb.storage.kv, settings: { get: async () => ({ githubToken: undefined }) }, plugins: bb.sdk.plugins, ownPluginId: OWN_PLUGIN_ID }),
    external: externalStep(automations.run),
    script: scriptStep(bb.sdk),
    thread,
    providers,
    kv: bb.storage.kv,
    plugins: bb.sdk.plugins,
    now,
    onError: (error) => bb.log.warn(`automations: a run failed to record its progress (${error instanceof Error ? error.message : String(error)})`),
  });
  advance = (threadId) => void runner.advance(threadId);
  registerAutomationRunner(bb, runner);
  // Прогон, прерванный перезапуском сервера, продолжается сразу после загрузки плагина.
  void progress.threads().then((threads) => threads.forEach((threadId) => void runner.resume(threadId)), () => undefined);
  registerAskTool(bb, store, { newId, now, stages: stagesOf, emit, planning: (threadId) => readPlanning(bb.sdk, threadId, Date.now(), readClaudeTranscript()), progress });
  const journalDirs = createJournalDirStore(bb.storage.kv);
  registerApi(bb, store, { now, emit, writeDecision: (args) => writeDecision(bb, journalDirs, args), progress });
  // Удалённый тред не ждёт владельца и не показывает прогресс: записи снимаются, иначе значок висел бы в левой панели.
  bb.events.on("thread.deleted", ({ thread }) => {
    void store.dropAwaiting(thread.id).catch(() => undefined);
    void progress.remove(thread.id).catch(() => undefined);
  });
  registerProgress(bb, progress, {
    now,
    stages: stagesOf,
    flowName: flowNameOf,
    windowCost: (threadId, from, to) => readWindowCost(bb.sdk, threadId, from, to, readClaudeTranscript()),
    thread,
  });
  registerCommands(bb, { newId, now, readBrief: (id) => store.getBrief(id) });
  const catalog = () => readStageCatalog(hostCatalogSources(bb));
  registerFlowTools(bb, flows, { catalog, newId });
  registerFlowSettingsApi(bb, flows, { catalog, rootSkill: () => readRootSkill(hostRootSkillSources(bb)),
    skillFile: (name) => readSkillFile(hostSkillFileSources(bb), name),
    reveal: revealInFinderHere,
  });
  registerFlowPickerApi(bb, flows, threads);
  registerJournalSettingsApi(bb, journalDirs);
  registerVoiceApi(bb);
}
