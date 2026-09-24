// Бэкенд Flow: инструменты агента `ask_decision`, `share_command` и `flow_stage`, исполнитель автоматизаций, коллекция
// flow и flow тредов, настройка языка и RPC виджетов поверх kv плагина.
import { randomBytes } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { createSteps } from "./packages/automation-steps/index";
import { OWN_PLUGIN_ID } from "./core/plugin-id";
import { registerApi } from "./server/api";
import { flowTurnInstructions, registerAskTool } from "./server/ask-tool";
import { registerChooseFlow } from "./server/choose-flow";
import { scriptStep } from "./server/script-step";
import { createAutomationRunner, externalStep, registerAutomationRunner } from "./server/automation-runner";
import { automationsBridge } from "./server/automations";
import { registerCommands } from "./server/command";
import { createJournalDirStore } from "./server/dir-settings";
import { registerJournalSettingsApi } from "./server/journal-settings-api";
import { writeDecision } from "./server/journal-writer";
import { acrossThreads, readClaudeTranscript, readPlanning, readWindowCost, readWindowMinutes, withDescendants } from "./server/planning";
import { type ContextSettingValues, contextFillOf, contextSettings } from "./server/context";
import { createProgress, registerProgress } from "./server/progress";
import { registerFlowPickerApi } from "./server/flow-picker-api";
import { registerNextRun } from "./server/next-run";
import { createOwnSends } from "./server/own-sends";
import { createFlowSettings } from "./server/flow-settings";
import { writeRootSkill } from "./server/root-skill-writer";
import { registerFlowTools } from "./server/flow-tools";
import { registerFlowSettingsApi } from "./server/settings-api";
import { hostCatalogSources, hostRootSkillSources, hostSkillFileSources, readRootSkill, readSkillFile, readStageCatalog } from "./server/stage-catalog";
import { revealInFinderHere } from "./packages/reveal-in-finder/index";
import { createStore } from "./server/store";
import { createThreadFlows } from "./server/thread-flows";
import { registerVoiceApi } from "./server/voice";
import { flowOrNone, NO_FLOW, stageSettingsOf } from "./core/flows";
import { CHOOSE_FLOW_RULE } from "./core/stages";
import { CHOOSE_FLOW_TOOL, ROOT_SKILL } from "./lib/stage-constants";
import { LANGUAGE_OPTIONS, LANGUAGE_SETTING, LANGUAGE_SYSTEM, resolveLocale } from "./lib/i18n";
import { messages } from "./lib/messages";
import { isRunFinished } from "./core/run-summary";

/** Время в base36 спереди — идентификаторы сортируются по созданию. */
const newId = (): string => `${Date.now().toString(36)}${randomBytes(6).toString("hex")}`;
const now = (): string => new Date().toISOString();

export default async function plugin(bb: BbPluginApi): Promise<void> {
  // Язык читает фронт: System идёт за языком браузера, который знает только он.
  // Сервер берёт его только для подписи придержанного сообщения в очереди, System — по языку машины.
  // Пороги второй полосы читает сервер и кладёт в ответ баннера — фронт не
  // ходит в настройки вторым путём. Схема каждого порога сверяет ввод с
  // соседом, а сосед — последняя запись хранилища: до первого чтения её нет,
  // и хост сверяет умолчания с умолчаниями.
  let storedContext: ContextSettingValues & { [LANGUAGE_SETTING]?: unknown } = {};
  const settings = bb.settings.define({
    [LANGUAGE_SETTING]: { type: "select", label: "Language", description: "Language of the brief, the settings page and the answer sent to the thread. System follows the browser language.", options: [...LANGUAGE_OPTIONS], default: LANGUAGE_SYSTEM },
    ...contextSettings(() => storedContext),
  });
  storedContext = await settings.get();
  settings.onChange((next) => { storedContext = next; });
  const store = createStore(bb.storage.kv);
  // Корневой навык пишется из flow при каждом сохранении и при запуске: описания правятся на странице Flow, а навык читает агент.
  const flows = await createFlowSettings(bb.storage.kv, { onSave: (saved) => writeRootSkill(saved.flows) });
  await writeRootSkill(flows.current().flows).catch(() => undefined);
  const threads = await createThreadFlows(bb.storage.kv);
  bb.events.on("thread.created", threads.onThreadCreated);
  bb.events.on("thread.deleted", threads.onThreadDeleted);
  // Тред без flow: этапов нет, и Flow не вкладывает в ход ни правила, ни их списка.
  const flowOf = (threadId: string) => flowOrNone(flows.current(), threads.flowOf(threadId));
  const stagesOf = (threadId: string) => {
    const settings = flows.current();
    const flow = flowOrNone(settings, threads.flowOf(threadId));
    return flow === null ? { stages: [], minButtonWidth: settings.minButtonWidth } : stageSettingsOf(settings, flow);
  };
  const flowNameOf = (threadId: string) => flowOf(threadId)?.name;
  // Automations — отдельный плагин: события Flow и этапы-автоматизации идут к нему по HTTP, без него Flow работает как раньше.
  const automations = automationsBridge(bb);
  const emit = (trigger: Parameters<typeof automations.emit>[0], threadId: string, context?: { stageId?: string }) => void automations.emit(trigger, threadId, context);
  // Прогресс и исполнитель ссылаются друг на друга: правка прогресса продвигает автоматизации, исполнитель пишет прогресс.
  let advance: (threadId: string) => void = () => undefined;
  // Итог завершённого прогона замораживается на той же правке, что его завершила, — история не ждёт, пока тред откроют.
  let freezeFinished: (threadId: string) => Promise<void> = async () => undefined;
  // Ход агента идёт, пока тред в статусе active: значок этапа навыка без хода не мерцает.
  const thread = async (threadId: string) => {
    const row = await bb.sdk.threads.get({ threadId });
    return { environmentId: row.environmentId, active: row.status === "active", providerId: row.providerId, title: row.title ?? null };
  };
  const providers = () => bb.sdk.providers.list();
  // Тред, переданный до указателей прогонов, находит свой прогон по ответу на бриф, которым работу передали.
  // Свои отправки Flow — ответ на бриф и побудка: хук следующего прогона их не придерживает.
  const own = createOwnSends();
  const progress = createProgress(bb.storage.kv, {
    onChange: (threadId) => {
      advance(threadId);
      void freezeFinished(threadId).catch(() => undefined);
    },
    handedTo: async (briefId) => (await store.getAnswer(briefId))?.handoffThreadId });
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
    // Доигранный прогон Flow пускает работу дальше: реплика встаёт в очередь и не перебивает идущий ход. Текст собирает исполнитель — в нём простой по этапам.
    wake: async (threadId, text) => {
      own.mark(threadId, text);
      await bb.sdk.threads.send({ threadId, mode: "queue-if-active", input: [{ type: "text", text, mentions: [] }] });
    },
    kv: bb.storage.kv,
    plugins: bb.sdk.plugins,
    now,
    onError: (error) => bb.log.warn(`automations: a run failed to record its progress (${error instanceof Error ? error.message : String(error)})`),
  });
  advance = (threadId) => void runner.advance(threadId);
  registerAutomationRunner(bb, runner);
  // Прогон, прерванный перезапуском сервера, продолжается сразу после загрузки плагина; завершённый до этой версии и не
  // замороженный баннером — замораживается, пока его запись цела.
  void progress.threads().then(
    (threads) =>
      threads.forEach((threadId) => {
        void runner.resume(threadId);
        void freezeFinished(threadId).catch(() => undefined);
      }),
    () => undefined,
  );
  // Выбор агентом предлагается только треду, где «без flow» выбрал владелец; тред, где так решил агент, его больше не получает.
  const chooseFlow = (threadId: string) =>
    flows.current().agentChoosesFlow === true && threads.flowOf(threadId) === NO_FLOW ? CHOOSE_FLOW_RULE(ROOT_SKILL, CHOOSE_FLOW_TOOL, NO_FLOW) : null;
  registerAskTool(bb, store, { newId, now, stages: stagesOf, hasFlow: (threadId) => flowOf(threadId) !== null, chooseFlow, emit, planning: (threadId) => readPlanning(bb.sdk, threadId, Date.now(), readClaudeTranscript()), progress });
  const journalDirs = createJournalDirStore(bb.storage.kv);
  registerApi(bb, store, { now, emit, writeDecision: (args) => writeDecision(bb, journalDirs, args), progress, ownSend: own.mark });
  // Удалённый тред не ждёт владельца и не показывает прогресс: записи и его указатель снимаются, иначе значок висел бы
  // в левой панели. Архивированный тред и тред, отдавший работу, ключей не теряют — их ещё откроют.
  bb.events.on("thread.deleted", ({ thread }) => {
    void store.dropAwaiting(thread.id).catch(() => undefined);
    void progress.forget(thread.id).catch(() => undefined);
  });
  const runSessions = acrossThreads(bb.sdk, async (threadId) => withDescendants(bb.sdk, await progress.members(threadId)));
  ({ freezeFinished } = registerProgress(bb, progress, {
    now,
    stages: stagesOf,
    flowName: flowNameOf,
    // Окно этапа читает логи всех тредов прогона и их потомков: работу ведут и треды, которым её передали, и дочерние.
    windowCost: (threadId, from, to) => readWindowCost(runSessions, threadId, from, to, readClaudeTranscript()),
    windowMinutes: (threadId, windows) => readWindowMinutes(runSessions, threadId, windows, readClaudeTranscript()),
    thread,
    // Заполненность окна bb уже знает: она едет в ответе баннера вместе с прогрессом, без своего опроса.
    context: (threadId) => contextFillOf(bb.sdk, () => settings.get(), threadId),
  }));
  registerCommands(bb, { newId, now, readBrief: (id) => store.getBrief(id) });
  const catalog = () => readStageCatalog(hostCatalogSources(bb));
  registerFlowTools(bb, flows, { catalog, newId });
  registerChooseFlow(bb, { flows, threads, instructions: (threadId) => flowTurnInstructions(stagesOf(threadId).stages) });
  registerFlowSettingsApi(bb, flows, { catalog, rootSkill: () => readRootSkill(hostRootSkillSources(bb)),
    skillFile: (name) => readSkillFile(hostSkillFileSources(bb), name),
    reveal: revealInFinderHere,
  });
  registerFlowPickerApi(bb, flows, threads);
  // Следующий прогон в том же треде: сообщение владельца ждёт выбора flow, пока прогон треда завершён.
  registerNextRun(bb, {
    flows,
    threads,
    progress,
    finished: async (threadId) => {
      const found = await progress.run(threadId);
      return found !== null && isRunFinished(found.progress, stagesOf(found.carrier).stages);
    },
    heldReason: () => messages(resolveLocale(storedContext[LANGUAGE_SETTING], [Intl.DateTimeFormat().resolvedOptions().locale])).nextFlow.held,
    ownSend: own.has,
  });
  // Ушедшая своя отправка забывается — тем же текстом, что хук видит в `input.text`: текстовые блоки через перевод строки.
  bb.events.on("message.dispatched", ({ entry }) =>
    own.forget(entry.threadId, entry.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")),
  );
  registerJournalSettingsApi(bb, journalDirs);
  registerVoiceApi(bb);
}
