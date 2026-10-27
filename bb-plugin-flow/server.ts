// Бэкенд Flow: инструменты агента `ask_decision`, `share_command`, `propose_rule` и `flow_stage`, исполнитель автоматизаций, коллекция
// flow и flow тредов, настройка языка и RPC виджетов поверх kv плагина.
import { randomBytes } from "node:crypto";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { selectedThreadSetting } from "@bb-plugins/rail-collapse/setting";

import { branchOffDefaultBranch, createSteps, type RunFigures, type Steps } from "@bb-plugins/automation-steps/index";
import { failureInstructionOf, retryPolicyOf, wakesAgentAfterLastRetry } from "./core/automation-run";
import { OWN_PLUGIN_ID } from "./core/plugin-id";
import { flowsInPanelSetting } from "./lib/flows-in-panel-setting";
import { ANSWERED_CHANNEL, registerApi } from "./server/api";
import { returnAwaitingBrief } from "./server/brief-return";
import { ASK_TOOL_NAME, registerAskTool } from "./server/ask-tool";
import { CHOICE_TIMEOUT_MS, createAutoChoice } from "./server/auto-choice";
import { runScript, scriptStep } from "./server/script-step";
import { readTaskFile, writeTaskFile } from "./server/task-file";
import { createAgentRelay } from "./server/agent-relay";
import { nextWork } from "./core/mark-report";
import { createBoundary, threadModelsOf } from "./server/boundary";
import { createStageModels } from "./server/stage-models";
import { createAutomationRunner, externalStep, registerAutomationRunner } from "./server/automation-runner";
import { createNoticePublisher } from "./server/automation-notices";
import { automationsBridge } from "./server/automations";
import { centerBridge, registerNoticeActions } from "./server/center";
import { registerBriefImages } from "./server/brief-image";
import { automationEntry, silentTurnEntry, turnEndEntry } from "./core/center-notice";
import { createSilentTurns, defaultKimiHome, readTextFromDisk, registerSilentTurns } from "./server/silent-turn";
import { waitsForAnswer } from "./core/awaiting";
import { COMMAND_TOOL_NAME, registerCommands } from "./server/command";
import { RULE_TOOL_NAME, registerRules } from "./server/rules";
import { registerSpendBackfill } from "./server/spend-backfill";
import { createJournalDirStore } from "./server/dir-settings";
import { registerJournalSettingsApi } from "./server/journal-settings-api";
import { createJournalIndex } from "./server/journal-index";
import { writeDecision } from "./server/journal-writer";
import { acrossThreads, readClaudeTranscript, readPlanning, readWindowCost, readWindowMinutes, withDescendants } from "./server/planning";
import { type ContextSettingValues, compactPreselectSetting, compactPreselectedOf, contextFillOf, contextSettings } from "./server/context";
import { createProgress, FLOW_STAGE_TOOL, registerProgress, stageStateOf } from "./server/progress";
import { registerRetryTool } from "./server/retry-tool";
import { RETRY_AUTOMATION_TOOL } from "./lib/stage-constants";
import { registerFlowPickerApi } from "./server/flow-picker-api";
import { registerMentionsApi } from "./server/mentions";
import { registerOwnerTurn } from "./server/owner-turn";
import { startThread } from "./server/thread-start";
import { createRelocation } from "./server/relocate";
import { CHECKLIST_TOOL } from "./core/checklist";
import type { DecisionBrief } from "./shared/contract";
import { registerChecklistTool } from "./server/checklist-tool";
import { tellApplied } from "./server/flow-applied";
import { registerFlowChoice } from "./server/flow-choice";
import { createOwnSends } from "./server/own-sends";
import { placeFigureStepsOnce } from "./server/figure-steps-once";
import { createFlowSettings } from "./server/flow-settings";
import { READ_FLOWS_TOOL_NAME, registerFlowTools, SAVE_FLOW_TOOL_NAME } from "./server/flow-tools";
import { readProviderModels, registerWorkflowFiles } from "./server/workflow-files";
import { registerWorkflowTools, WORKFLOW_READ_TOOL_NAME, WORKFLOW_WRITE_TOOL_NAME } from "./server/workflow-tools";
import { createLegacyHeal } from "./server/legacy-heal";
import { registerFlowSettingsApi, STAGE_SETTINGS_CHANNEL } from "./server/settings-api";
import { registerWidgetFiles } from "./server/widget-files";
import { registerThreadListPrefsApi } from "./server/thread-list-prefs-api";
import { createFlowSync, defaultSyncDir, FLOW_SYNC_CHANNEL, registerFlowSyncApi, SYNC_POLL_MS } from "./server/flow-sync";
import { createSkillDelivery } from "./server/skill-delivery";
import {
  hostCatalogSources,
  hostSkillFileSources,
  readAccountSkills,
  readClaudePlugins,
  readExecutorFile,
  readSkillFile,
  readStageCatalog,
  readWorkflowAgents,
  readWorkflowScripts,
  writeScriptFile,
} from "./server/stage-catalog";
import { createSkillLists } from "./server/skill-lists";
import { createSkillScope } from "./server/skill-scope";
import { agentFor, defaultExecutionOf, executionFor, startMessageOf } from "./core/flow-agent";
import { registerSessionConfig } from "./server/session-config";
import { revealInFinderHere } from "@bb-plugins/reveal-in-finder/index";
import { createStore } from "./server/store";
import { createProviderThreads, paceLeadSetting } from "./server/provider-threads";
import { paceLeadOf } from "./core/provider-threads";
import { createThreadFlows } from "./server/thread-flows";
import { removeStaleRootSkill } from "./server/stale-root-skill";
import { bringPluginsHome } from "./server/plugin-homecoming";
import type { HomecomingTrigger } from "./core/plugin-homecoming";
import { registerVoiceApi } from "./server/voice";
import { flowOrNone, NO_FLOW, stageSettingsOf } from "./core/flows";
import { LANGUAGE_OPTIONS, LANGUAGE_SETTING, LANGUAGE_SYSTEM } from "./lib/i18n";
import { isRunFinished } from "./core/run-summary";
import { liveFlowId } from "./core/run-history";
import { runJournal } from "./core/run-journal";
import { DEFAULT_JOURNAL_DIR } from "./lib/journal-dir";
import { isSideChat } from "./core/side-chat";

/** Время в base36 спереди — идентификаторы сортируются по созданию. */
const newId = (): string => `${Date.now().toString(36)}${randomBytes(6).toString("hex")}`;
const now = (): string => new Date().toISOString();

/**
 * Файл, который плагин везёт с собой: рядом с исходником, а из собранного `dist/server.js` — уровнем выше.
 * Второй путь пробуется только когда первого нет: любая другая ошибка (EPERM и т. п.) — настоящая причина,
 * её нельзя прятать за ENOENT от запасного пути.
 */
const ownFile = (path: string): Promise<string> =>
  readFile(new URL(`./${path}`, import.meta.url), "utf8").catch((err: NodeJS.ErrnoException) => {
    if (err.code !== "ENOENT") throw err;
    return readFile(new URL(`../${path}`, import.meta.url), "utf8");
  });

/** Сколько начало хода ждёт сверки настроек Claude Code дерева треда. */
const TURN_START_SYNC_MS = 2_000;

export default async function plugin(bb: BbPluginApi): Promise<void> {
  // Язык читает фронт: System идёт за языком браузера, который знает только он.
  // Пороги второй полосы читает сервер и кладёт в ответ баннера — фронт не
  // ходит в настройки вторым путём. Схема каждого порога сверяет ввод с
  // соседом, а сосед — последняя запись хранилища: до первого чтения её нет,
  // и хост сверяет умолчания с умолчаниями.
  let storedContext: ContextSettingValues & { [LANGUAGE_SETTING]?: unknown; providerPaceLead?: unknown } = {};
  const settings = bb.settings.define({
    [LANGUAGE_SETTING]: { type: "select", label: "Language", description: "Language of the widgets, the settings page and the answer sent to the thread. System follows the browser language.", options: [...LANGUAGE_OPTIONS], default: LANGUAGE_SYSTEM },
    ...contextSettings(() => storedContext),
    ...compactPreselectSetting,
    ...paceLeadSetting,
    ...flowsInPanelSetting,
    ...selectedThreadSetting("the flow"),
  });
  storedContext = await settings.get();
  settings.onChange((next) => { storedContext = next; });
  const store = createStore(bb.storage.kv);
  const flows = await createFlowSettings(bb.storage.kv);
  // Шаги плана и факта встают во flow при первом запуске из main; сбой — попытка на следующем запуске.
  const ownSource = async () => (await bb.sdk.plugins.list()).plugins.find((p) => p.id === OWN_PLUGIN_ID)?.source;
  void placeFigureStepsOnce(bb.storage.kv, flows, ownSource).catch(() => undefined);
  // Уборка за прежней версией: без неё старый корневой навык перекрывает навык flow плагина. Сбой не мешает запуску — файл уберёт следующий.
  await removeStaleRootSkill(homedir()).catch(() => undefined);
  const threads = await createThreadFlows(bb.storage.kv);
  bb.events.on("thread.created", threads.onThreadCreated);
  bb.events.on("thread.deleted", threads.onThreadDeleted);
  // Плагин, поставленный из дерева треда, после архива остался бы без папки: Flow возвращает его в основную копию —
  // при архиве и при своём запуске, если архив прошёл без него.
  const homecoming = { plugins: bb.sdk.plugins, projects: bb.sdk.projects, warn: (m: string) => bb.log.warn(m) };
  // Сверки идут по очереди: переустановка самого Flow в одной оборвала бы другую на середине.
  let homeQueue: Promise<unknown> = Promise.resolve();
  const bringHome = (trigger: HomecomingTrigger) => {
    homeQueue = homeQueue.then(() => bringPluginsHome(homecoming, trigger, OWN_PLUGIN_ID)).catch((error) => bb.log.warn(`plugin homecoming: ${String(error)}`));
  };
  bb.events.on("thread.archived", ({ thread }) => bringHome({ kind: "archived", threadId: thread.id }));
  bringHome({ kind: "startup" });
  // Тред без flow: этапов нет, и Flow не вкладывает в ход ни правила, ни их списка.
  const flowOf = (threadId: string) => flowOrNone(flows.current(), threads.flowOf(threadId));
  const stagesOf = (threadId: string) => {
    const settings = flows.current();
    const flow = flowOrNone(settings, threads.flowOf(threadId));
    return flow === null ? { stages: [], minButtonWidth: settings.minButtonWidth } : stageSettingsOf(settings, flow);
  };
  const flowNameOf = (threadId: string) => flowOf(threadId)?.name;
  // Тред с flow, заведённый в чекауте проекта, уезжает в своё дерево от origin/main до первого хода — если первый этап flow это шаг дерева.
  const relocation = createRelocation({
    sdk: bb.sdk,
    stagesOf: (threadId) => stagesOf(threadId).stages,
    recheck: () => bb.experimental_hooks.recheck("message.dispatch").catch((error: unknown) => bb.log.warn(`relocation: the hook was not rechecked (${String(error)})`)),
    started: (threadId) => progress.annotate(threadId, (p) => p),
    warn: (message) => bb.log.warn(message),
  });
  // Automations — отдельный плагин: события Flow и этапы-автоматизации идут к нему по HTTP, без него Flow работает как раньше.
  const automations = automationsBridge(bb);
  const emit = (trigger: Parameters<typeof automations.emit>[0], threadId: string, context?: { stageId?: string }) => void automations.emit(trigger, threadId, context);
  // Центр уведомлений — тоже отдельный плагин: конец хода в треде с flow и итог автоматизации идут к нему по HTTP, без него ничего не меняется.
  const center = centerBridge(bb);
  // Немой ход: Kimi на отказ провайдера закрывает ход в bb как успешный и без слов — причину Flow берёт из журнала сессии Kimi (./server/silent-turn.ts).
  const silentTurns = createSilentTurns({ readText: readTextFromDisk, kimiHome: defaultKimiHome(), now: Date.now });
  registerSilentTurns(bb, silentTurns);
  const workDirOf = async (environmentId: string | null): Promise<string | null> =>
    environmentId === null ? null : ((await bb.sdk.environments.get({ environmentId }).catch(() => null))?.path ?? null);
  bb.events.on("thread.idle", async ({ thread }) => {
    if (flowOf(thread.id) === null) return;
    const silent = await silentTurns.check(thread.id, { providerId: thread.providerId, workDir: await workDirOf(thread.environmentId) });
    if (silent !== null) return void (await center.push(silentTurnEntry({ threadId: thread.id, threadTitle: thread.title ?? null, silent })));
    const waiting = (await store.listAwaiting()).find((entry) => entry.threadId === thread.id && waitsForAnswer(entry.kind));
    const brief = waiting === undefined ? null : await store.getBrief(waiting.briefId);
    await center.push(turnEndEntry({ threadId: thread.id, threadTitle: thread.title ?? null, brief: brief === null ? null : { id: brief.id, title: brief.title } }));
  });
  // Прогресс и исполнитель ссылаются друг на друга: правка прогресса продвигает автоматизации, исполнитель пишет прогресс.
  let advance: (threadId: string) => void = () => undefined;
  // Итог завершённого прогона замораживается на той же правке, что его завершила, — история не ждёт, пока тред откроют.
  let freezeFinished: (threadId: string) => Promise<void> = async () => undefined;
  // План и факт прогона для шагов «План → задача» и «Факт → задача» знает прогресс, а он поднимается позже исполнителя.
  let runFigures: (threadId: string) => Promise<RunFigures | null> = async () => null;
  // Ход агента идёт, пока тред в статусе active: значок этапа навыка без хода не мерцает.
  const thread = async (threadId: string) => {
    const row = await bb.sdk.threads.get({ threadId });
    return { environmentId: row.environmentId, active: row.status === "active", providerId: row.providerId, title: row.title ?? null, projectId: row.projectId };
  };
  const providers = () => bb.sdk.providers.list();
  // Тред, переданный до указателей прогонов, находит свой прогон по ответу на бриф, которым работу передали.
  // Свои отправки Flow — ответ на бриф и побудка: ход владельца по ним выбор flow не применяет.
  const own = createOwnSends();
  // Список навыков проекта — один на весь Flow: каждый шаг треда читает его по всем проектам (./server/skill-lists.ts).
  const skillLists = createSkillLists(bb, Date.now);
  const skillFileSources = hostSkillFileSources(bb, skillLists);
  // Навыки и агенты, которые Claude Code грузит агенту треда, — по открытым этапам его flow (./server/skill-scope.ts).
  const catalogSources = hostCatalogSources(bb, skillLists);
  const worktreeOf = async (threadId: string) => {
    const { environmentId } = await bb.sdk.threads.get({ threadId });
    const environment = environmentId === null ? null : await bb.sdk.environments.get({ environmentId });
    return environment?.isWorktree === true && environment.path ? environment.path : null;
  };
  // Агент треда по его flow: модель и effort ставятся живому треду того же провайдера, стартовое сообщение — сессии.
  const agentOf = (threadId: string) => agentFor(flows.current(), threads.flowOf(threadId));
  const applyAgent = async (threadId: string): Promise<void> => {
    const execution = executionFor(agentOf(threadId), (await bb.sdk.threads.get({ threadId })).providerId);
    if (execution !== null) await bb.sdk.threads.update({ threadId, ...execution });
  };
  const scope = createSkillScope({
    kv: bb.storage.kv,
    worktree: worktreeOf,
    // Окружения ещё нет — первое сообщение нового треда: дерево появится к старту сессии.
    pending: async (threadId) => (await bb.sdk.threads.get({ threadId })).environmentId === null,
    flow: flowOf,
    stages: (threadId) => stagesOf(threadId).stages,
    progress: (threadId) => progress.get(threadId),
    catalog: () => readStageCatalog(catalogSources),
    plugins: () => readClaudePlugins(catalogSources),
    accountSkills: () => readAccountSkills(catalogSources),
    workflowScripts: () => readWorkflowScripts(catalogSources),
    warn: (message) => bb.log.warn(message),
  });
  const delivery = createSkillDelivery({
    stages: (threadId) => stagesOf(threadId).stages,
    source: async (name) => (await readSkillFile(skillFileSources, name))?.path ?? null,
    warn: (message) => bb.log.warn(message),
  });
  const syncSkills = async (threadId: string) => {
    const [, hasSkills] = await Promise.all([scope.sync(threadId), delivery.sync(threadId)]);
    if (!hasSkills) return;
    try {
      const row = await bb.sdk.threads.get({ threadId });
      if (row.providerId !== "claude-code") delivery.deliver(threadId, await worktreeOf(threadId));
    } catch (error) {
      bb.log.warn(`skill delivery: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  bb.events.on("thread.active", ({ thread }) => void syncSkills(thread.id).catch((error) => bb.log.warn(String(error))));
  bb.events.on("thread.deleted", ({ thread }) => void delivery.forget(thread.id));
  // Первая сессия треда стартует уже с ограничением: решение сверки ложится в дерево прямо перед стартом Claude Code.
  registerSessionConfig(bb, {
    tools: [ASK_TOOL_NAME, FLOW_STAGE_TOOL, CHECKLIST_TOOL, RETRY_AUTOMATION_TOOL, READ_FLOWS_TOOL_NAME, SAVE_FLOW_TOOL_NAME, COMMAND_TOOL_NAME, RULE_TOOL_NAME, WORKFLOW_READ_TOOL_NAME, WORKFLOW_WRITE_TOOL_NAME],
    prestart: (threadId, root) => void scope.prestart(threadId, root),
    startMessage: (threadId) => startMessageOf(agentOf(threadId)),
    deliver: delivery.deliver,
    warn: (message) => bb.log.warn(message),
  });
  const progress = createProgress(bb.storage.kv, {
    onChange: (threadId) => {
      advance(threadId);
      void syncSkills(threadId).catch((error) => bb.log.warn(String(error)));
      void freezeFinished(threadId).catch(() => undefined);
    },
    handedTo: async (briefId) => (await store.getAnswer(briefId))?.handoffThreadId });
  // Реплика Flow в тред встаёт в очередь и не перебивает идущий ход; выбор flow по ней не применяется.
  const send = async (threadId: string, text: string) => {
    own.mark(threadId, text);
    await bb.sdk.threads.send({ threadId, mode: "queue-if-active", input: [{ type: "text", text, mentions: [] }] });
  };
  // Граница этапов: тред сжимается и получает модель следующего этапа до реплики, что его будит (./server/boundary.ts).
  const boundary = createBoundary({ threads: bb.sdk.threads, send, stageState: (threadId, stageId) => stageStateOf(progress, threadId, stageId), warn: (message) => bb.log.warn(message) });
  // Сжатие, модель и порядок «сначала тред, потом реплика» — на каждый план в одном месте; планы по замеру контекста и по модели треда.
  const stageModels = createStageModels({
    context: (threadId) => contextFillOf(bb.sdk, () => settings.get(), threadId),
    current: async (threadId) => {
      const found = await threadModelsOf(bb.sdk, threadId);
      return found === null ? null : { model: found.current.model, reasoningLevel: found.current.reasoningLevel };
    },
  });
  // Назначенную границу исполняет только будящая реплика Flow после автоматизации; посторонняя отправка (`tell` шага) её не трогает.
  const wake = async (threadId: string, text: string) => {
    if (boundary.scheduled(threadId)) await boundary.service(threadId);
    await send(threadId, text);
  };
  /** PR рабочего дерева — номер, ссылка и состояние; нет PR или bb его не знает — `null`. */
  const pullRequestOf = async (environmentId: string) => {
    const answer = await bb.sdk.environments.pullRequest({ environmentId });
    return answer.outcome === "available" ? { number: answer.pullRequest.number, url: answer.pullRequest.url, state: answer.pullRequest.state } : null;
  };
  const runner = createAutomationRunner({
    progress,
    store,
    stages: stagesOf,
    // Своей настройки токена у Flow нет: шаги берут токен у `gh auth token` на машине bb.
    steps: withRelocatedTree(
      createSteps({ sdk: bb.sdk, kv: bb.storage.kv, settings: { get: async () => ({ githubToken: undefined }) }, plugins: bb.sdk.plugins, ownPluginId: OWN_PLUGIN_ID, tell: send, runFigures: (threadId) => runFigures(threadId), branchOff: branchOffDefaultBranch(bb.sdk) }),
      relocation.isRelocated,
    ),
    external: externalStep(automations.run),
    script: scriptStep(bb.sdk),
    thread,
    // Остановка простаивающего агента только выгружает его процесс: ход не прерывается, лента и история целы.
    releaseAgent: (threadId) =>
      bb.sdk.threads.stop({ threadId }).then(
        () => undefined,
        (error: unknown) => bb.log.warn(`automations: the agent was not released before archiving (${error instanceof Error ? error.message : String(error)})`),
      ),
    flowThreads: () => threads.withFlow(),
    providers,
    // Доигранный прогон Flow пускает работу дальше. Текст собирает исполнитель. Агент, чей
    // вызов flow_stage ждёт автоматизацию, получает реплику ответом инструмента, и в тред она не идёт.
    wake: (threadId, text) => relay.deliver(threadId, text),
    kv: bb.storage.kv,
    plugins: bb.sdk.plugins,
    now,
    retry: () => retryPolicyOf(flows.current()),
    wakeOnFailure: () => wakesAgentAfterLastRetry(flows.current()),
    failureInstruction: () => failureInstructionOf(flows.current()),
    // Итог этапа-автоматизации — записью центру, тост показывает он: название треда, flow и PR дописывает публикатор.
    notify: createNoticePublisher({
      progress,
      thread: async (threadId) => {
        const row = await bb.sdk.threads.get({ threadId });
        return { title: row.title ?? null, environmentId: row.environmentId };
      },
      pullRequest: async (environmentId) => {
        const pr = await pullRequestOf(environmentId);
        return pr === null ? null : { number: pr.number, url: pr.url };
      },
      flow: flowOf,
      publish: (notice) => void center.push(automationEntry(notice)),
      newId,
    }),
    onError: (error) => bb.log.warn(`automations: a run failed to record its progress (${error instanceof Error ? error.message : String(error)})`),
  });
  advance = (threadId) => void runner.advance(threadId);
  // Ход агента идёт, пока тред active: кончился — ответ вызова уже никто не прочтёт, и реплика идёт в тред.
  const relay = createAgentRelay({ busy: runner.busy, alive: async (threadId) => (await thread(threadId)).active, send: wake, onError: (error) => bb.log.warn(`flow_stage: a Flow message failed to reach the thread (${error instanceof Error ? error.message : String(error)})`) });
  // Реплики, застрявшие в ожиданиях выгружаемого Flow, уходят в тред, а ждущие вызовы отвечают.
  bb.onDispose(() => relay.dispose());
  registerAutomationRunner(bb, runner);
  registerNoticeActions(bb, runner);
  registerBriefImages(bb);
  // Выключенный или перезагружаемый Flow не должен повторять шаги старым процессом: новый поставит повторы заново из записей.
  bb.onDispose(() => runner.dispose());
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
  registerChecklistTool(bb, store);
  // Решение агента записывает модуль ответов, а он подключается ниже: ссылка заполняется, когда он встанет.
  let recordDecided: ((brief: DecisionBrief) => Promise<void>) | undefined;
  // Этап с исполнителем «Тред <провайдер>» ведёт дочерний тред другого провайдера; лимиты провайдеров — в ходе треда.
  const providerThreads = createProviderThreads(bb, {
    stages: (threadId) => stagesOf(threadId).stages,
    expectDelegate: threads.expectDelegate,
    criteria: (threadId) => store.getThreadCriteria(threadId),
    skillPath: async (name) => (await readSkillFile(skillFileSources, name))?.path ?? null,
    now: Date.now,
    lead: () => paceLeadOf(storedContext.providerPaceLead),
  });
  registerAskTool(bb, store, { context: (threadId) => contextFillOf(bb.sdk, () => settings.get(), threadId), decided: (brief) => recordDecided?.(brief) ?? Promise.resolve(), newId, now, stages: stagesOf, flowIds: () => flows.current().flows.map((flow) => flow.id), flowName: flowNameOf, hasFlow: (threadId) => flowOf(threadId) !== null, emit, planning: (threadId) => readPlanning(bb.sdk, threadId, Date.now(), readClaudeTranscript()), progress, limits: providerThreads.line, threadModels: (threadId) => threadModelsOf(bb.sdk, threadId) });
  const journalDirs = createJournalDirStore(bb.storage.kv);
  // Каждый ответ на бриф запоминается за тредом вместе с путём файла журнала: по нему итог прогона ссылается на журнал.
  const journalIndex = createJournalIndex(bb.storage.kv, store);
  const writeAndIndex = async (args: Parameters<typeof writeDecision>[2]) => {
    const written = await writeDecision(bb, journalDirs, args);
    const { id: briefId, title, threadId } = args.brief;
    await journalIndex.record(threadId, { briefId, title, answeredAt: args.decidedAt, path: written.kind === "written" ? written.path : null });
    return written;
  };
  /** Каталог журнала проекта треда — для имён файлов, записанных до того, как путь стали запоминать. */
  const journalDirOf = async (threadId: string): Promise<string> => {
    const { projectId } = await bb.sdk.threads.get({ threadId });
    const configured = await journalDirs.get(projectId);
    return configured.kind === "configured" ? configured.path : DEFAULT_JOURNAL_DIR;
  };
  const carryFlow = async (fromThreadId: string, toThreadId: string) => {
    const flowId = threads.flowOf(fromThreadId);
    if (flowId !== undefined) await threads.assign(toThreadId, flowId);
  };
  /** Передачи, которым Демонстрация выбрала другой flow: исходный тред → выбранный flow; забирает первое сообщение нового треда. */
  const handoffFlows = new Map<string, string>();
  const takeHandoffFlow = (sourceThreadId: string) => {
    const flowId = handoffFlows.get(sourceThreadId);
    handoffFlows.delete(sourceThreadId);
    return flowId;
  };
  recordDecided = registerApi(bb, store, {
    now,
    // Встроенные этапы закрывает ответ владельца: утверждённая модель следующего этапа ставится здесь, граница flow_stage на них не срабатывает.
    stageModel: async (threadId, after) => {
      const next = nextWork(stagesOf(threadId).stages, after);
      return next === null ? null : ((await stageModels.plan(threadId, next.stage, false, after))?.model ?? null);
    },
    stages: (threadId) => stagesOf(threadId).stages,
    warn: (message) => bb.log.warn(message),
    emit,
    writeDecision: writeAndIndex,
    progress,
    ownSend: own.mark,
    carryFlow,
    flowIds: () => flows.current().flows.map((flow) => flow.id),
    compactPreselected: (threadId) => compactPreselectedOf(bb.sdk, () => settings.get(), threadId),
    // Смена flow треда живёт в ./server/flow-choice.ts; ответы приходят после запуска плагина, когда `choice` уже есть.
    switchFlow: (threadId, flowId) => choice.switchTo(threadId, flowId),
    openPullRequest: async (threadId) => {
      const { environmentId } = await bb.sdk.threads.get({ threadId });
      const pr = environmentId === null || environmentId === undefined ? null : await pullRequestOf(environmentId);
      return pr === null || pr.state !== "open" ? null : { number: pr.number, url: pr.url };
    },
    releaseFlow: (threadId) => choice.release(threadId),
    handoffFlow: (sourceThreadId, flowId) => void (flowId === null ? handoffFlows.delete(sourceThreadId) : handoffFlows.set(sourceThreadId, flowId)),
    widgetFlows: () =>
      flows.current().flows.map((flow) => ({ id: flow.id, name: flow.name, ...(flow.icon === undefined ? {} : { icon: flow.icon }), ...(flow.agent?.execution === undefined ? {} : { execution: flow.agent.execution }) })),
    threadFlowId: (threadId) => flowOf(threadId)?.id ?? null,
  }).recordDecided;
  // Удалённый тред не ждёт владельца и не показывает прогресс: записи и его указатель снимаются, иначе значок висел бы
  // в левой панели. Архивированный тред и тред, отдавший работу, ключей не теряют — их ещё откроют.
  bb.events.on("thread.deleted", ({ thread }) => {
    void store.dropAwaiting(thread.id).catch(() => undefined);
    void progress.forget(thread.id).catch(() => undefined);
  });
  const runSessions = acrossThreads(bb.sdk, async (threadId) => withDescendants(bb.sdk, await progress.members(threadId)));
  const registered = registerProgress(bb, progress, {
    now,
    stages: stagesOf,
    checklist: async (threadId) => (await store.getChecklist(threadId))?.items ?? [],
    flowName: flowNameOf,
    // Окно этапа читает логи всех тредов прогона и их потомков: работу ведут и треды, которым её передали, и дочерние.
    windowCost: (threadId, from, to) => readWindowCost(runSessions, threadId, from, to, readClaudeTranscript()),
    windowMinutes: (threadId, windows) => readWindowMinutes(runSessions, threadId, windows, readClaudeTranscript()),
    thread,
    // Личный проект bb без флага в список не попадает, и тред вне проекта остался бы без подписи.
    projects: () => bb.sdk.projects.list({ includePersonal: true }),
    // Заполненность окна bb уже знает: она едет в ответе баннера вместе с прогрессом, без своего опроса.
    context: (threadId) => contextFillOf(bb.sdk, () => settings.get(), threadId),
    // Доработка откатывает закрытые автоматизации за начатым заново этапом тем же исполнителем шагов.
    undo: (threadId, stages) => runner.undo(threadId, stages),
    relay,
    boundary,
    stageModels,
    warn: (message) => bb.log.warn(message),
    // Правка прогресса уже поставила сверку треда в очередь: ответ ждёт её, а не запускает вторую.
    settled: (threadId) => scope.settled(threadId),
    readTaskFile: (threadId, target) => readTaskFile(bb.sdk, threadId, target),
    criteria: (threadId) => store.getThreadCriteria(threadId),
    answers: (threadId) => store.getThreadAnswers(threadId),
    delegate: providerThreads.delegate,
    writeTaskFile: (threadId, target, text) => writeTaskFile(bb.sdk, threadId, target, text),
    flow: (threadId) => {
      const flow = flowOf(threadId);
      return flow === null ? undefined : { id: flow.id, name: flow.name };
    },
    liveFlowId: (id, name) => liveFlowId(flows.current().flows, id, name),
    // Каталог проекта нужен только ответам без запомненного пути: у остальных путь уже есть.
    journal: async (threadId, window) => {
      const entries = await journalIndex.entries(threadId);
      const dir = entries.some(({ path }) => path === undefined) ? await journalDirOf(threadId) : DEFAULT_JOURNAL_DIR;
      return runJournal(entries, window, dir);
    },
  });
  ({ freezeFinished, runFigures } = registered);
  registerSpendBackfill(bb, registered.pastRuns);
  registerCommands(bb, { newId, now, readBrief: (id) => store.getBrief(id) });
  registerRules(bb, { newId, now, home: homedir(), ownSend: own.mark });
  // Каждое чтение каталога, пока разовая чистка не прошла, сверяет с ним этапы прежнего flow по умолчанию; первое — сразу при запуске.
  // Поэтому read_flows, save_flow и страница читают каталог раньше коллекции: так они видят её уже вылеченной.
  const heal = createLegacyHeal(bb.storage.kv, flows);
  const catalog = async () => {
    const read = await readStageCatalog(catalogSources);
    await heal.run(read).catch((error) => bb.log.warn(`flows: legacy stages were not cleaned (${error instanceof Error ? error.message : String(error)})`));
    return read;
  };
  void catalog();
  registerFlowTools(bb, flows, { catalog, newId });
  registerRetryTool(bb, { stages: stagesOf, progress, runner, relay });
  // Workflow Claude Code: инструменты агента собирают их в формате конструктора, открыватель .js показывает конструктор.
  const writeText = async (path: string, text: string, exclusive = false) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text, { encoding: "utf8", flag: exclusive ? "wx" : "w" });
  };
  registerWorkflowTools(bb, { dir: join(homedir(), ".claude", "workflows"), readFile: (path) => readFile(path, "utf8"), writeFile: writeText });
  registerWorkflowFiles(bb, {
    dir: join(homedir(), ".claude", "workflows"),
    listDir: (dir) => readdir(dir),
    readFile: (path) => readFile(path, "utf8"),
    writeFile: writeText,
    agents: () => readWorkflowAgents(catalogSources),
    providers: () => readProviderModels(bb),
  });
  registerFlowSettingsApi(bb, flows, { catalog, ready: async () => {
    if (!heal.done()) await catalog();
  },
    skillFile: (name) => readSkillFile(skillFileSources, name),
    executorFile: (id) => readExecutorFile({ ...catalogSources, primaryHostId: skillFileSources.primaryHostId }, id),
    scriptFile: (script) => writeScriptFile(script, skillFileSources.primaryHostId),
    reveal: revealInFinderHere,
    // Модель по умолчанию — первого доступного провайдера машины bb: из неё стартует выбор модели flow.
    defaultExecution: async () => {
      const first = (await bb.sdk.providers.models()).providers.find((provider) => provider.available);
      return first === undefined ? null : defaultExecutionOf(await bb.sdk.providers.models({ providerId: first.id }), first.id);
    },
  });
  // Файлы состава виджета для просмотрщика bb: корень плагина — по его навыку, наличие файла — по диску.
  registerWidgetFiles(bb, { ...skillFileSources, exists: (path) => access(path).then(() => true, () => false), readFile: (path) => readFile(path, "utf8") });
  registerThreadListPrefsApi(bb);
  registerFlowPickerApi(bb, flows, threads);
  registerMentionsApi(bb, { catalog });
  // Папка синхронизации flow: каждое сохранение уходит в неё, а приехавшее из неё Syncthing'ом сверяется опросом.
  const sync = await createFlowSync({
    kv: bb.storage.kv,
    defaultDir: defaultSyncDir(process.env),
    flows,
    home: homedir(),
    now: () => new Date(),
    published: (change) => bb.realtime.publish(change === "flows" ? STAGE_SETTINGS_CHANNEL : FLOW_SYNC_CHANNEL, {}),
  });
  registerFlowSyncApi(bb, sync);
  void sync.tick();
  const poll = setInterval(() => void sync.tick(), SYNC_POLL_MS);
  poll.unref();
  bb.onDispose(() => clearInterval(poll));
  // Flow треда над композером: выбор до отправки и «Отменить flow».
  /** Прогон треда завершён — по этапам треда, который его ведёт. */
  const runFinished = async (threadId: string) => {
    const found = await progress.run(threadId);
    return found !== null && isRunFinished(found.progress, stagesOf(found.carrier).stages);
  };
  // Происхождение треда не меняется: ответ хоста запоминается, а сбой — нет, чтобы тред не остался навсегда «не Side chat».
  const sideChats = new Map<string, Promise<boolean>>();
  bb.events.on("thread.deleted", ({ thread: row }) => void sideChats.delete(row.id));
  const sideChat = (threadId: string): Promise<boolean> => {
    const known = sideChats.get(threadId) ?? Promise.resolve({ threadId }).then((input) => bb.sdk.threads.get(input)).then(isSideChat);
    sideChats.set(threadId, known);
    known.catch(() => sideChats.delete(threadId));
    return known;
  };
  // «Применить» посреди хода: этапы нового flow — агенту в тот же ход строкой `steer`.
  const applied = tellApplied({
    active: async (threadId) => (await bb.sdk.threads.get({ threadId })).status === "active",
    steer: (threadId, input) => bb.sdk.threads.send({ threadId, mode: "steer", input }),
    mark: own.mark,
    flowOf: (flowId) => {
      const flow = flowOrNone(flows.current(), flowId);
      return flow === null ? null : { name: flow.name, stages: stageSettingsOf(flows.current(), flow).stages };
    },
    isNoFlow: (flowId) => flowId === NO_FLOW,
  });
  const choice = registerFlowChoice(bb, { flows, threads, progress, store, cancelRun: (threadId) => runner.cancel(threadId), finished: runFinished, sideChat, applied });
  // Ход владельца применяет flow, выбранный в контейнере состояния Flow; после завершённого прогона — начинает следующий.
  // Первое сообщение нового треда даёт ему flow и прогон: тред передачи — flow исходного, остальные с flow — пустой прогон.
  // Тред с «Автоматически»: сообщение, которое начинает ход, ждёт в очереди, пока скрипт выбирает flow; у треда в `pending`
  // окружения ещё нет, поэтому скрипт идёт во временной папке ОС. Выбранный flow — с пустым прогоном и своей моделью до хода
  // агента; стартовое сообщение flow получает только новая сессия — у живой инструкции сессии уже собраны.
  const autoChoice = createAutoChoice({
    settings: () => flows.current(),
    threads,
    started: async (threadId) => {
      await progress.annotate(threadId, (p) => p);
      await applyAgent(threadId).catch((error) => bb.log.warn(`flow agent: model not set for ${threadId} (${error instanceof Error ? error.message : String(error)})`));
    },
    skill: () => ownFile("skills/flow-choose/SKILL.md"),
    script: async (input, env) =>
      runScript({ name: "choose-flow.sh", content: await ownFile("scripts/choose-flow.sh") }, { cwd: tmpdir(), threadId: "", environmentId: "" }, { timeoutMs: CHOICE_TIMEOUT_MS, input, env }),
    release: () => void bb.experimental_hooks.recheck("message.dispatch").catch(() => undefined),
    warn: (message) => bb.log.warn(message),
  });
  registerOwnerTurn(bb, {
    autoChoice,
    ownSend: own.has,
    ownerTurn: choice.ownerTurn,
    ownerMessage: (threadId) => returnAwaitingBrief({ store, publish: (id) => bb.realtime.publish(ANSWERED_CHANNEL, { id }) }, threadId),
    relocation,
    firstMessage: startThread({ threads, progress, hasFlow: (threadId) => flowOf(threadId) !== null, handoffFlow: takeHandoffFlow, applyAgent }),
    // Хук ждёт решения не дольше 10 с и запирает тред на просрочке: сверка, которая затянулась, доходит в фоне.
    // Side chat, получивший flow до этой версии, его теряет вместе с прогоном.
    sideChat: async (threadId) => {
      if (threads.flowOf(threadId) === NO_FLOW) return;
      await threads.assign(threadId, NO_FLOW);
      await choice.release(threadId);
    },
    turnStart: (threadId) => Promise.race([syncSkills(threadId), new Promise<void>((resolve) => setTimeout(resolve, TURN_START_SYNC_MS).unref())]),
  });
  // Ушедшая своя отправка забывается — тем же текстом, что хук видит в `input.text`: текстовые блоки через перевод строки.
  bb.events.on("message.dispatched", ({ entry }) =>
    own.forget(entry.threadId, entry.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")),
  );
  registerJournalSettingsApi(bb, journalDirs);
  registerVoiceApi(bb);
}

/** Шаг дерева в треде, который Flow сам завёл переносом: окружения у него ещё нет, но дерево уже своё. */
const withRelocatedTree = (steps: Steps, isRelocated: (threadId: string) => boolean): Steps => ({
  ...steps,
  "git.tree-from-origin": async (threadId) =>
    isRelocated(threadId) ? { ok: true, detail: "moved out of the project checkout — its own worktree from origin/main" } : steps["git.tree-from-origin"](threadId),
});
