// Бэкенд Flow: инструменты агента `ask_decision`, `share_command` и `flow_stage`, исполнитель автоматизаций, коллекция
// flow и flow тредов, настройка языка и RPC виджетов поверх kv плагина.
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { railCollapseSetting, selectedThreadSetting } from "@bb-plugins/rail-collapse/setting";

import { createSteps } from "@bb-plugins/automation-steps/index";
import { failureInstructionOf, retryPolicyOf, wakesAgentAfterLastRetry } from "./core/automation-run";
import { OWN_PLUGIN_ID } from "./core/plugin-id";
import { ANSWERED_CHANNEL, registerApi } from "./server/api";
import { returnAwaitingBrief } from "./server/brief-return";
import { ASK_TOOL_NAME, flowTurnInstructions, registerAskTool } from "./server/ask-tool";
import { registerChooseFlow } from "./server/choose-flow";
import { scriptStep } from "./server/script-step";
import { readTaskFile, writeTaskFile } from "./server/task-file";
import { createAgentRelay } from "./server/agent-relay";
import { createAutomationRunner, externalStep, registerAutomationRunner } from "./server/automation-runner";
import { createNoticePublisher } from "./server/automation-notices";
import { automationsBridge } from "./server/automations";
import { centerBridge, registerNoticeActions } from "./server/center";
import { automationEntry, turnEndEntry } from "./core/center-notice";
import { waitsForAnswer } from "./core/awaiting";
import { COMMAND_TOOL_NAME, registerCommands } from "./server/command";
import { createJournalDirStore } from "./server/dir-settings";
import { registerJournalSettingsApi } from "./server/journal-settings-api";
import { createJournalIndex } from "./server/journal-index";
import { writeDecision } from "./server/journal-writer";
import { acrossThreads, readClaudeTranscript, readPlanning, readWindowCost, readWindowMinutes, withDescendants } from "./server/planning";
import { type ContextSettingValues, compactPreselectSetting, compactPreselectedOf, contextFillOf, contextSettings } from "./server/context";
import { createProgress, FLOW_STAGE_TOOL, registerProgress } from "./server/progress";
import { registerFlowPickerApi } from "./server/flow-picker-api";
import { registerMentionsApi } from "./server/mentions";
import { registerOwnerTurn } from "./server/owner-turn";
import { startThread } from "./server/thread-start";
import { registerFlowChoice } from "./server/flow-choice";
import { createOwnSends } from "./server/own-sends";
import { createFlowSettings } from "./server/flow-settings";
import { READ_FLOWS_TOOL_NAME, registerFlowTools, SAVE_FLOW_TOOL_NAME } from "./server/flow-tools";
import { createLegacyHeal } from "./server/legacy-heal";
import { registerFlowSettingsApi, STAGE_SETTINGS_CHANNEL } from "./server/settings-api";
import { createFlowSync, defaultSyncDir, FLOW_SYNC_CHANNEL, registerFlowSyncApi, SYNC_POLL_MS } from "./server/flow-sync";
import { hostCatalogSources, hostSkillFileSources, readAccountSkills, readClaudePlugins, readExecutorFile, readSkillFile, readStageCatalog, readWorkflowScripts, writeScriptFile } from "./server/stage-catalog";
import { createSkillScope } from "./server/skill-scope";
import { createFreshSession, type MessageBlocks } from "./server/fresh-session";
import { registerSessionConfig } from "./server/session-config";
import { clearsContextAfterAutoChoice, limitsBeforeChoice, restartsAfterChoice } from "./core/skill-scope";
import { revealInFinderHere } from "@bb-plugins/reveal-in-finder/index";
import { createStore } from "./server/store";
import { createThreadFlows } from "./server/thread-flows";
import { removeStaleRootSkill } from "./server/stale-root-skill";
import { registerVoiceApi } from "./server/voice";
import { AGENT_NO_FLOW, AUTO_FLOW, flowOrNone, NO_FLOW, stageSettingsOf } from "./core/flows";
import { CHOOSE_FLOW_AGAIN_RULE, CHOOSE_FLOW_RULE } from "./core/stages";
import { CHOOSE_FLOW_TOOL } from "./lib/stage-constants";
import { LANGUAGE_OPTIONS, LANGUAGE_SETTING, LANGUAGE_SYSTEM } from "./lib/i18n";
import { isRunFinished } from "./core/run-summary";
import { liveFlowId } from "./core/run-history";
import { runJournal } from "./core/run-journal";
import { DEFAULT_JOURNAL_DIR } from "./lib/journal-dir";

/** Время в base36 спереди — идентификаторы сортируются по созданию. */
const newId = (): string => `${Date.now().toString(36)}${randomBytes(6).toString("hex")}`;
const now = (): string => new Date().toISOString();

/** Сколько начало хода ждёт сверки настроек Claude Code дерева треда. */
const TURN_START_SYNC_MS = 2_000;

export default async function plugin(bb: BbPluginApi): Promise<void> {
  // Язык читает фронт: System идёт за языком браузера, который знает только он.
  // Пороги второй полосы читает сервер и кладёт в ответ баннера — фронт не
  // ходит в настройки вторым путём. Схема каждого порога сверяет ввод с
  // соседом, а сосед — последняя запись хранилища: до первого чтения её нет,
  // и хост сверяет умолчания с умолчаниями.
  let storedContext: ContextSettingValues & { [LANGUAGE_SETTING]?: unknown } = {};
  const settings = bb.settings.define({
    [LANGUAGE_SETTING]: { type: "select", label: "Language", description: "Language of the brief, the settings page and the answer sent to the thread. System follows the browser language.", options: [...LANGUAGE_OPTIONS], default: LANGUAGE_SYSTEM },
    ...contextSettings(() => storedContext),
    ...compactPreselectSetting,
    ...railCollapseSetting,
    ...selectedThreadSetting("the flow"),
  });
  storedContext = await settings.get();
  settings.onChange((next) => { storedContext = next; });
  const store = createStore(bb.storage.kv);
  const flows = await createFlowSettings(bb.storage.kv);
  // Уборка за прежней версией: без неё старый корневой навык перекрывает навык flow плагина. Сбой не мешает запуску — файл уберёт следующий.
  await removeStaleRootSkill(homedir()).catch(() => undefined);
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
  // Центр уведомлений — тоже отдельный плагин: конец хода в треде с flow и итог автоматизации идут к нему по HTTP, без него ничего не меняется.
  const center = centerBridge(bb);
  bb.events.on("thread.idle", async ({ thread }) => {
    if (flowOf(thread.id) === null) return;
    const waiting = (await store.listAwaiting()).find((entry) => entry.threadId === thread.id && waitsForAnswer(entry.kind));
    const brief = waiting === undefined ? null : await store.getBrief(waiting.briefId);
    await center.push(turnEndEntry({ threadId: thread.id, threadTitle: thread.title ?? null, brief: brief === null ? null : { id: brief.id, title: brief.title } }));
  });
  // Прогресс и исполнитель ссылаются друг на друга: правка прогресса продвигает автоматизации, исполнитель пишет прогресс.
  let advance: (threadId: string) => void = () => undefined;
  // Итог завершённого прогона замораживается на той же правке, что его завершила, — история не ждёт, пока тред откроют.
  let freezeFinished: (threadId: string) => Promise<void> = async () => undefined;
  // Ход агента идёт, пока тред в статусе active: значок этапа навыка без хода не мерцает.
  const thread = async (threadId: string) => {
    const row = await bb.sdk.threads.get({ threadId });
    return { environmentId: row.environmentId, active: row.status === "active", providerId: row.providerId, title: row.title ?? null, projectId: row.projectId };
  };
  const providers = () => bb.sdk.providers.list();
  // Тред, переданный до указателей прогонов, находит свой прогон по ответу на бриф, которым работу передали.
  // Свои отправки Flow — ответ на бриф и побудка: ход владельца по ним выбор flow не применяет.
  const own = createOwnSends();
  // Навыки и агенты, которые Claude Code грузит агенту треда, — по открытым этапам его flow (./server/skill-scope.ts).
  const catalogSources = hostCatalogSources(bb);
  const worktreeOf = async (threadId: string) => {
    const { environmentId } = await bb.sdk.threads.get({ threadId });
    const environment = environmentId === null ? null : await bb.sdk.environments.get({ environmentId });
    return environment?.isWorktree === true && environment.path ? environment.path : null;
  };
  const scope = createSkillScope({
    kv: bb.storage.kv,
    worktree: worktreeOf,
    // Окружения ещё нет — первое сообщение нового треда: дерево появится к старту сессии.
    pending: async (threadId) => (await bb.sdk.threads.get({ threadId })).environmentId === null,
    flow: flowOf,
    // До выбора flow агентом прячется то, что прячет хоть один flow: первая сессия видит только навыки плагинов bb.
    // Тумблер очистки после выбора выключен — не прячется ничего: новой сессии, которая вернула бы навыки, не будет.
    choosing: (threadId) => (threads.flowOf(threadId) === AUTO_FLOW ? limitsBeforeChoice(flows.current()) : null),
    stages: (threadId) => stagesOf(threadId).stages,
    progress: (threadId) => progress.get(threadId),
    catalog: () => readStageCatalog(catalogSources),
    plugins: () => readClaudePlugins(catalogSources),
    accountSkills: () => readAccountSkills(catalogSources),
    workflowScripts: () => readWorkflowScripts(catalogSources),
    warn: (message) => bb.log.warn(message),
  });
  bb.events.on("thread.active", ({ thread }) => void scope.sync(thread.id));
  // Первая сессия треда стартует уже с ограничением: решение сверки ложится в дерево прямо перед стартом Claude Code.
  registerSessionConfig(bb, {
    tools: [ASK_TOOL_NAME, FLOW_STAGE_TOOL, READ_FLOWS_TOOL_NAME, SAVE_FLOW_TOOL_NAME, COMMAND_TOOL_NAME, CHOOSE_FLOW_TOOL],
    prestart: (threadId, root) => void scope.prestart(threadId, root),
    warn: (message) => bb.log.warn(message),
  });
  const progress = createProgress(bb.storage.kv, {
    onChange: (threadId) => {
      advance(threadId);
      void scope.sync(threadId);
      void freezeFinished(threadId).catch(() => undefined);
    },
    handedTo: async (briefId) => (await store.getAnswer(briefId))?.handoffThreadId });
  // Реплика Flow в тред встаёт в очередь и не перебивает идущий ход; выбор flow по ней не применяется.
  const send = async (threadId: string, text: string) => {
    own.mark(threadId, text);
    await bb.sdk.threads.send({ threadId, mode: "queue-if-active", input: [{ type: "text", text, mentions: [] }] });
  };
  // Тред с «Автоматически» после выбора начинает работу заново в новой сессии — по тумблеру очистки или когда сессия стартовала урезанной (./server/fresh-session.ts).
  const textOf = (blocks: MessageBlocks) => blocks.flatMap((block) => (block.type === "text" && typeof block.text === "string" ? [block.text] : [])).join("\n");
  const fresh = createFreshSession({
    kv: bb.storage.kv,
    agentChooses: (threadId) => threads.flowOf(threadId) === AUTO_FLOW || threads.flowOf(threadId) === AGENT_NO_FLOW,
    // По тумблеру очистки — после выбора flow; всегда — когда сессия стартовала с ограничением до выбора.
    needed: async (threadId) =>
      restartsAfterChoice({ clears: clearsContextAfterAutoChoice(flows.current()), chosen: flowOf(threadId) !== null, limitedBeforeChoice: await scope.limitedBeforeChoice(threadId) }) &&
      (await thread(threadId)).providerId === "claude-code" &&
      (await worktreeOf(threadId)) !== null,
    sync: (threadId) => scope.sync(threadId),
    clear: (threadId) => bb.sdk.threads.clearContext({ threadId }),
    send: async (threadId, blocks) => {
      // Видна ли пометка агенту в тексте, который увидит хук, — неизвестно: своей отмечаются оба варианта.
      own.mark(threadId, textOf(blocks));
      own.mark(threadId, textOf(blocks.slice(1)));
      await bb.sdk.threads.send({ threadId, mode: "queue-if-active", input: blocks as Parameters<typeof bb.sdk.threads.send>[0]["input"] });
    },
    note: (threadId) => {
      const name = flowNameOf(threadId);
      return name === undefined
        ? `You already left this thread without a flow for the message below — do not call ${CHOOSE_FLOW_TOOL} for it. Below is the thread's first message: Flow sent it again in a fresh session so that all skills are loaded. Work on it as usual.`
        : `Flow «${name}» is already chosen for this thread — do not call ${CHOOSE_FLOW_TOOL}. Below is the thread's first message: Flow sent it again in a fresh session started after the choice, with the skills of the flow. Work on it by the flow.`;
    },
    warn: (message) => bb.log.warn(message),
  });
  bb.events.on("thread.idle", ({ thread: row }) => void fresh.idle(row.id));
  bb.events.on("thread.deleted", ({ thread: row }) => void fresh.forget(row.id));
  const runner = createAutomationRunner({
    progress,
    store,
    stages: stagesOf,
    // Своей настройки токена у Flow нет: шаги берут токен у `gh auth token` на машине bb.
    steps: createSteps({ sdk: bb.sdk, kv: bb.storage.kv, settings: { get: async () => ({ githubToken: undefined }) }, plugins: bb.sdk.plugins, ownPluginId: OWN_PLUGIN_ID, tell: send }),
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
        const answer = await bb.sdk.environments.pullRequest({ environmentId });
        return answer.outcome === "available" ? { number: answer.pullRequest.number, url: answer.pullRequest.url } : null;
      },
      flow: flowOf,
      publish: (notice) => void center.push(automationEntry(notice)),
      newId,
    }),
    onError: (error) => bb.log.warn(`automations: a run failed to record its progress (${error instanceof Error ? error.message : String(error)})`),
  });
  advance = (threadId) => void runner.advance(threadId);
  // Ход агента идёт, пока тред active: кончился — ответ вызова уже никто не прочтёт, и реплика идёт в тред.
  const relay = createAgentRelay({ busy: runner.busy, alive: async (threadId) => (await thread(threadId)).active, send, onError: (error) => bb.log.warn(`flow_stage: a Flow message failed to reach the thread (${error instanceof Error ? error.message : String(error)})`) });
  // Реплики, застрявшие в ожиданиях выгружаемого Flow, уходят в тред, а ждущие вызовы отвечают.
  bb.onDispose(() => relay.dispose());
  registerAutomationRunner(bb, runner);
  registerNoticeActions(bb, runner);
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
  // Выбор агентом — треду с «Автоматически» до выбора и после собственного отказа агента: «Без flow» и flow с описаниями каждый ход.
  const chooseFlow = (threadId: string) => {
    const flowId = threads.flowOf(threadId);
    if (flowId === AUTO_FLOW) return CHOOSE_FLOW_RULE(flows.current(), CHOOSE_FLOW_TOOL, NO_FLOW);
    return flowId === AGENT_NO_FLOW ? CHOOSE_FLOW_AGAIN_RULE(flows.current(), CHOOSE_FLOW_TOOL) : null;
  };
  registerAskTool(bb, store, { newId, now, stages: stagesOf, flowIds: () => flows.current().flows.map((flow) => flow.id), flowName: flowNameOf, hasFlow: (threadId) => flowOf(threadId) !== null, chooseFlow, emit, planning: (threadId) => readPlanning(bb.sdk, threadId, Date.now(), readClaudeTranscript()), progress });
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
  registerApi(bb, store, {
    now,
    emit,
    writeDecision: writeAndIndex,
    progress,
    ownSend: own.mark,
    carryFlow,
    flowIds: () => flows.current().flows.map((flow) => flow.id),
    compactPreselected: (threadId) => compactPreselectedOf(bb.sdk, () => settings.get(), threadId),
    // Смена flow треда живёт в ./server/flow-choice.ts; ответы приходят после запуска плагина, когда `choice` уже есть.
    switchFlow: (threadId, flowId) => choice.switchTo(threadId, flowId),
    releaseFlow: (threadId) => choice.release(threadId),
    handoffFlow: (sourceThreadId, flowId) => void (flowId === null ? handoffFlows.delete(sourceThreadId) : handoffFlows.set(sourceThreadId, flowId)),
  });
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
    // Личный проект bb без флага в список не попадает, и тред вне проекта остался бы без подписи.
    projects: () => bb.sdk.projects.list({ includePersonal: true }),
    // Заполненность окна bb уже знает: она едет в ответе баннера вместе с прогрессом, без своего опроса.
    context: (threadId) => contextFillOf(bb.sdk, () => settings.get(), threadId),
    // Доработка откатывает закрытые автоматизации за начатым заново этапом тем же исполнителем шагов.
    undo: (threadId, stages) => runner.undo(threadId, stages),
    relay,
    // Правка прогресса уже поставила сверку треда в очередь: ответ ждёт её, а не запускает вторую.
    settled: (threadId) => scope.settled(threadId),
    readTaskFile: (threadId, target) => readTaskFile(bb.sdk, threadId, target),
    criteria: (threadId) => store.getThreadCriteria(threadId),
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
  }));
  registerCommands(bb, { newId, now, readBrief: (id) => store.getBrief(id) });
  // Каждое чтение каталога, пока разовая чистка не прошла, сверяет с ним этапы прежнего flow по умолчанию; первое — сразу при запуске.
  // Поэтому read_flows, save_flow и страница читают каталог раньше коллекции: так они видят её уже вылеченной.
  const heal = createLegacyHeal(bb.storage.kv, flows);
  const catalog = async () => {
    const read = await readStageCatalog(hostCatalogSources(bb));
    await heal.run(read).catch((error) => bb.log.warn(`flows: legacy stages were not cleaned (${error instanceof Error ? error.message : String(error)})`));
    return read;
  };
  void catalog();
  registerFlowTools(bb, flows, { catalog, newId });
  // Пустой прогон выбранного flow — сразу: контейнер состояния Flow показывает этапы, не дожидаясь первого брифа.
  registerChooseFlow(bb, {
    flows,
    threads,
    instructions: (threadId) => flowTurnInstructions(stagesOf(threadId).stages),
    // Тред с «Автоматически» получил flow: лишнее прячется сразу, до начала работы.
    started: async (threadId) => {
      await progress.annotate(threadId, (p) => p);
      await scope.sync(threadId);
    },
    fresh: (threadId) => fresh.request(threadId),
    refused: (threadId) => scope.sync(threadId),
  });
  registerFlowSettingsApi(bb, flows, { catalog, ready: async () => {
    if (!heal.done()) await catalog();
  },
    skillFile: (name) => readSkillFile(hostSkillFileSources(bb), name),
    executorFile: (id) => readExecutorFile({ ...hostCatalogSources(bb), primaryHostId: hostSkillFileSources(bb).primaryHostId }, id),
    scriptFile: (script) => writeScriptFile(script, hostSkillFileSources(bb).primaryHostId),
    reveal: revealInFinderHere,
  });
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
  const choice = registerFlowChoice(bb, { flows, threads, progress, store, cancelRun: (threadId) => runner.cancel(threadId), finished: runFinished });
  // Ход владельца применяет flow, выбранный в контейнере состояния Flow; после завершённого прогона — начинает следующий.
  // Первое сообщение нового треда даёт ему flow и прогон: тред передачи — flow исходного, остальные с flow — пустой прогон.
  registerOwnerTurn(bb, {
    ownSend: own.has,
    ownerTurn: choice.ownerTurn,
    ownerMessage: (threadId) => returnAwaitingBrief({ store, publish: (id) => bb.realtime.publish(ANSWERED_CHANNEL, { id }) }, threadId),
    firstMessage: startThread({ threads, progress, hasFlow: (threadId) => flowOf(threadId) !== null, handoffFlow: takeHandoffFlow }),
    firstInput: (threadId, blocks) => fresh.remember(threadId, blocks),
    // Хук ждёт решения не дольше 10 с и запирает тред на просрочке: сверка, которая затянулась, доходит в фоне.
    turnStart: (threadId) => Promise.race([scope.sync(threadId), new Promise<void>((resolve) => setTimeout(resolve, TURN_START_SYNC_MS).unref())]),
  });
  // Ушедшая своя отправка забывается — тем же текстом, что хук видит в `input.text`: текстовые блоки через перевод строки.
  bb.events.on("message.dispatched", ({ entry }) =>
    own.forget(entry.threadId, entry.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")),
  );
  registerJournalSettingsApi(bb, journalDirs);
  registerVoiceApi(bb);
}
