// Слой 2 — чисто. Прогон этапов-автоматизаций без агента: какой этап запускать
// следующим, как шаги ложатся в прогресс треда, как этап выглядит в полосе и
// в левой панели и что сказать о нём агенту. Эффекты — исполнение шагов и
// запись в kv — у server/automation-runner.ts.
import { isStepId, STEP_LABELS } from "@bb-plugins/automation-steps/catalog";
import { freeId, stageKindOf } from "../lib/stage-constants";
import { scriptOf } from "./automation-scripts";
import type { BuiltinAutomation, FlowProgress, FlowSettings, ProgressView, RunningIcon, StageTrack, WorkStage } from "../shared/contract";

/** Шаг в снимке прогона: id, подпись и — у пройденного — строка успеха, которую он вернул. */
export type RunStep = { id: string; label: string; detail?: string };

type StepView = NonNullable<ProgressView["stages"][number]["automation"]>["steps"][number];

/** Вид исполнителя по его id: `agent:…`, `workflow:…` или сам агент. */
export const executorKind = (id: string | undefined): "self" | "agent" | "workflow" => (id?.startsWith("agent:") ? "agent" : id?.startsWith("workflow:") ? "workflow" : "self");

/** Подпись шага встроенной автоматизации: шаг Flow — английская, скрипт — имя его файла, пропавший скрипт — id шага. */
const builtinStepLabel = (automation: BuiltinAutomation, id: string): string => (isStepId(id) ? STEP_LABELS[id].en : (scriptOf(automation, id)?.name ?? id));

/**
 * Шаги этапа снимком для прогона. Встроенная автоматизация — её шаги с английской подписью (фронт переводит по id), скрипт — с именем файла;
 * автоматизация Automations исполняется одним запуском — один шаг с её именем.
 */
export const stepsOf = (stage: WorkStage): RunStep[] => {
  const automation = stage.automation;
  if (automation === undefined) return [];
  return "source" in automation ? automation.steps.map((id) => ({ id, label: builtinStepLabel(automation, id) })) : [{ id: automation.id, label: automation.name }];
};

/** Шаги отката встроенной автоматизации с подписями; у остальных этапов отката нет. */
export const undoStepsOf = (stage: WorkStage): RunStep[] => {
  const automation = stage.automation;
  if (automation === undefined || !("source" in automation)) return [];
  return (automation.undo ?? []).map((id) => ({ id, label: builtinStepLabel(automation, id) }));
};

const patch = (progress: FlowProgress, id: string, change: (track: StageTrack) => StageTrack): FlowProgress => ({
  ...progress,
  stages: { ...progress.stages, [id]: change(progress.stages[id] ?? {}) },
});

const isOpen = (track: StageTrack | undefined): boolean => track?.finishedAt === undefined && track?.skipped !== true;


/** Этап Action: шаги те же, что у автоматизации, но каждый запускает владелец кнопкой. */
export const isActionStage = (stage: WorkStage): boolean => stageKindOf(stage) === "action";

/** Этап ведёт агент: автоматизацию исполняет Flow, Action — владелец кнопками, всё остальное — ход агента. */
export const isAgentStage = (stage: WorkStage): boolean => stage.automation === undefined && !isActionStage(stage);

/** Осталась ли в прогоне работа агента: незакрытый и не вычеркнутый этап, который ведёт агент. */
export const agentStagesAhead = (stages: readonly WorkStage[], progress: FlowProgress): boolean =>
  stages.some((stage) => isOpen(progress.stages[stage.id]) && isAgentStage(stage));

/** Этап в прогоне: не вычеркнут, а вычеркнутый — если агент его всё же закрыл. */
const inRun = (track: StageTrack | undefined): boolean => track?.skipped !== true || track.finishedAt !== undefined;

/** Этапы flow после этапа `id`, в порядке flow. */
const after = (stages: readonly WorkStage[], id: string): readonly WorkStage[] => stages.slice(stages.findIndex((stage) => stage.id === id) + 1);

/** Ближайший этап прогона после этапа `id`; `null` — за ним этапов прогона нет. */
export const nextInRun = (stages: readonly WorkStage[], progress: FlowProgress, id: string): WorkStage | null =>
  after(stages, id).find((stage) => inRun(progress.stages[stage.id])) ?? null;

/** Первый незакрытый и не вычеркнутый этап после этапа `id` — следующая работа за ним; `null` — работы нет. */
export const openAfter = (stages: readonly WorkStage[], progress: FlowProgress, id: string): WorkStage | null =>
  after(stages, id).find((stage) => isOpen(progress.stages[stage.id])) ?? null;

/** Закрыт ли ближайший этап прогона перед этапом `id`; этапов прогона перед ним нет — закрыт. */
const closedBefore = (stages: readonly WorkStage[], progress: FlowProgress, id: string): boolean => {
  const before = stages.slice(0, stages.findIndex((stage) => stage.id === id)).filter((stage) => inRun(progress.stages[stage.id])).at(-1);
  return before === undefined || progress.stages[before.id]?.finishedAt !== undefined;
};

/** Упавшая автоматизация, которая держит новые старты до повтора или пропуска владельца; упавший шаг Action держит только свой этап. */
export const stoppedBy = (stages: readonly WorkStage[], progress: FlowProgress): WorkStage | null =>
  stages.find((stage) => stage.automation !== undefined && !isActionStage(stage) && isFailed(progress.stages[stage.id] ?? {})) ?? null;

/**
 * С какого шага пора исполнять этап со шагами. `from: null` — не начатый: ближайший этап прогона перед ним закрыт, и новые
 * старты не держит упавшая автоматизация. Число — начатый: автоматизация, прерванная без ошибки, или Action, ждущий нажатия;
 * начатый этап идёт по своему снимку шагов, и чужая упавшая автоматизация его не держит. `null` — не пора.
 */
const dueFrom = (stages: readonly WorkStage[], progress: FlowProgress, stage: WorkStage): { from: number | null } | null => {
  const track = progress.stages[stage.id];
  if (stage.automation === undefined || !isOpen(track)) return null;
  const run = track?.run;
  if (run === undefined) return closedBefore(stages, progress, stage.id) && stoppedBy(stages, progress) === null ? { from: null } : null;
  if (isActionStage(stage)) return run.at < run.steps.length ? { from: run.at } : null;
  return run.error === null ? { from: run.at } : null;
};

/** Наступил ли этап со шагами: его пора исполнять или, у Action, ждать нажатия. */
export const isDue = (stages: readonly WorkStage[], progress: FlowProgress, stage: WorkStage): boolean => dueFrom(stages, progress, stage) !== null;

type Due = { stage: WorkStage; from: number | null };

/** Первый в порядке flow наступивший этап со шагами, который проходит `keep`, и его шаг. */
const firstDue = (stages: readonly WorkStage[], progress: FlowProgress, keep: (due: Due) => boolean): Due | null => {
  for (const stage of stages) {
    const due = dueFrom(stages, progress, stage);
    if (due !== null && keep({ stage, from: due.from })) return { stage, from: due.from };
  }
  return null;
};

/**
 * Автоматизация, которую пора исполнять: наступает, когда закрыт ближайший этап прогона перед ней, — нетронутые этапы раньше
 * не держат. Ненаступившая — с начала (`from: null`), прерванная без ошибки — со своего шага: прерванным бывает прогон,
 * который шёл, когда сервер перезапустился. Упавшая автоматизация держит новые старты до повтора владельца.
 */
export const pendingAutomation = (stages: readonly WorkStage[], progress: FlowProgress): Due | null => firstDue(stages, progress, ({ stage }) => !isActionStage(stage));

/** Первая прерванная без ошибки автоматизация и её шаг — то, что продолжает загрузка плагина; не начатые она не начинает. */
export const interruptedAutomation = (stages: readonly WorkStage[], progress: FlowProgress): Due | null =>
  firstDue(stages, progress, ({ stage, from }) => !isActionStage(stage) && from !== null);

/**
 * Этапы Action, которые ждут нажатия владельца, — по тому же правилу, что автоматизация, — в порядке flow, с номером шага,
 * до которого дошёл прогон. Открытых Action может быть несколько: каждый наступает от своего этапа перед ним.
 */
export const dueActions = (stages: readonly WorkStage[], progress: FlowProgress): Array<{ stage: WorkStage; at: number }> =>
  stages.flatMap((stage) => {
    const due = isActionStage(stage) ? dueFrom(stages, progress, stage) : null;
    return due === null ? [] : [{ stage, at: due.from ?? 0 }];
  });

/** Первый ждущий нажатия этап Action; шаги закончились — этап закрыт и ждать нечего. */
export const pendingAction = (stages: readonly WorkStage[], progress: FlowProgress): { stage: WorkStage; at: number } | null => dueActions(stages, progress)[0] ?? null;

/** Шаг этапа Action `id`, который ждёт нажатия; `null` — этап не Action или нажатия не ждёт. Открытых Action может быть несколько. */
export const actionAt = (stages: readonly WorkStage[], progress: FlowProgress, id: string): number | null => {
  const stage = stages.find((s) => s.id === id);
  const due = stage === undefined || !isActionStage(stage) ? null : dueFrom(stages, progress, stage);
  return due === null ? null : (due.from ?? 0);
};

/** Прогон без признака «шаг идёт» и без назначенного автоповтора: оба живут, только пока шаг идёт или ждёт повтора. */
const idle = ({ busy: _busy, retryAt: _retryAt, ...run }: NonNullable<StageTrack["run"]>): NonNullable<StageTrack["run"]> => run;

/** Автоповтор упавшего шага: через сколько секунд и сколько раз подряд; 0 секунд — не повторять, 0 попыток — без ограничения. */
export type RetryPolicy = { seconds: number; attempts: number };

export const DEFAULT_RETRY: RetryPolicy = { seconds: 0, attempts: 3 };

/** Автоповтор из настроек Flow; поля нет — значение по умолчанию. */
export const retryPolicyOf = (settings: Pick<FlowSettings, "retryInSeconds" | "retryAttempts">): RetryPolicy => ({
  seconds: settings.retryInSeconds ?? DEFAULT_RETRY.seconds,
  attempts: settings.retryAttempts ?? DEFAULT_RETRY.attempts,
});

/** Через сколько мс повторить упавший шаг сам; `null` — автоповтор выключен или попытки этого шага кончились, шаг ждёт владельца. */
export const retryDelay = (policy: RetryPolicy, track: StageTrack | undefined): number | null => {
  if (policy.seconds <= 0 || track?.run?.skipQueued === true) return null;
  const used = track?.run?.autoRetries ?? 0;
  return policy.attempts === 0 || used < policy.attempts ? policy.seconds * 1000 : null;
};

/** Мс до назначенного автоповтора упавшего шага, не меньше нуля; `null` — повтор не назначен. */
export const retryDueIn = (track: StageTrack | undefined, now: string): number | null => {
  const at = track?.run?.retryAt;
  return at === undefined || !isFailed(track ?? {}) ? null : Math.max(0, Date.parse(at) - Date.parse(now));
};

/** Шаг Action взят в работу: до ответа он идёт, и второе нажатие его не запустит. */
export const onStepStarted = (progress: FlowProgress, stageId: string): FlowProgress =>
  patch(progress, stageId, (track) => (track.run === undefined ? track : { ...track, run: { ...track.run, error: null, busy: true } }));

/** Старт прогона этапа; этап без шагов закрывается сразу. Простой прежнего прогона в новый не переезжает. */
export const onRunStart = (progress: FlowProgress, stageId: string, steps: readonly RunStep[], at: string): FlowProgress =>
  patch(progress, stageId, ({ idleMs: _ms, idleSince: _since, ...track }) => ({
    ...track,
    startedAt: at,
    finishedAt: steps.length === 0 ? at : undefined,
    run: { steps: steps.map((s) => ({ ...s })), at: 0, error: null },
  }));

/** Строка успеха шага рядом с самим шагом: снимок прогона — единственное место, где шаг переживает перезапуск сервера. */
const withDetail = (steps: NonNullable<StageTrack["run"]>["steps"], index: number, detail: string | null): NonNullable<StageTrack["run"]>["steps"] =>
  detail === null ? steps : steps.map((step, i) => (i === index ? { ...step, detail } : step));

/** Шаг выполнен: прогон идёт к следующему, последний закрывает этап; строка успеха остаётся у самого шага. */
export const onStepDone = (progress: FlowProgress, stageId: string, at: string, detail: string | null = null): FlowProgress =>
  patch(progress, stageId, (track) => {
    if (track.run === undefined) return track;
    const next = track.run.at + 1;
    const steps = withDetail(track.run.steps, track.run.at, detail);
    // Попытки автоповтора считаются на шаг: следующий шаг начинает со своих.
    const { autoRetries: _used, skipQueued: _skip, ...run } = idle(track.run);
    return { ...track, run: { ...run, steps, at: next, error: null }, ...(next >= track.run.steps.length ? { finishedAt: at } : {}) };
  });

/**
 * Шаг упал: прогон встаёт с ошибкой, и та же ошибка ложится в историю
 * падений. Историю не стирают ни повтор, ни пропуск — иначе первое же нажатие
 * «Повторить» уносит единственный след того, что шаг вообще падал, и через
 * неделю чинить нечего. `retryAt` — когда Flow повторит шаг сам; нет — шаг ждёт владельца.
 */
export const onStepFailed = (progress: FlowProgress, stageId: string, error: string, at: string, retryAt?: string): FlowProgress =>
  patch(progress, stageId, (track) => {
    if (track.run === undefined) return track;
    const step = track.run.steps[track.run.at]?.id ?? String(track.run.at);
    return { ...track, run: { ...idle(track.run), error, failures: [...(track.run.failures ?? []), { step, at, error }], ...(retryAt === undefined ? {} : { retryAt }) } };
  });

/**
 * Повтор: упавший шаг снова текущий и без ошибки. Автоповтор тратит попытку шага;
 * повтор владельца счёт обнуляет — владелец вмешался, и шаг снова получает все попытки.
 */
export const onRunRetry = (progress: FlowProgress, stageId: string, auto = false): FlowProgress =>
  patch(progress, stageId, (track) => {
    if (track.run === undefined) return track;
    const { autoRetries: used, ...run } = idle(track.run);
    return { ...track, run: { ...run, error: null, ...(auto ? { autoRetries: (used ?? 0) + 1 } : {}) } };
  });

/**
 * «Пропустить», нажатый, пока Flow ведёт тред попыткой автоповтора: пропуск запоминается, а назначенный повтор снимается.
 * Попытка упадёт — шаг закроется пропуском, пройдёт — пропускать будет нечего. Этап без прогона или закрытый не меняется.
 */
export const onSkipQueued = (progress: FlowProgress, stageId: string): FlowProgress => {
  const track = progress.stages[stageId];
  if (track?.run === undefined || track.finishedAt !== undefined) return progress;
  const { retryAt: _at, ...run } = track.run;
  return patch(progress, stageId, () => ({ ...track, run: { ...run, skipQueued: true } }));
};

/**
 * Можно ли запомнить пропуск у этапа: шаг упал или идёт попытка автоповтора упавшего шага — `autoRetries` ставит только
 * автоповтор, а `onStepDone` снимает. Шаг, который ещё не падал, пропуском с устаревшего тоста не закрывается.
 */
export const skipQueueable = (track: StageTrack): boolean => isFailed(track) || (track.finishedAt === undefined && (track.run?.autoRetries ?? 0) > 0);

/** Этапы, где запомненный пропуск пора применить: попытка, во время которой его нажали, упала. */
export const queuedSkips = (progress: FlowProgress): string[] =>
  Object.entries(progress.stages)
    .filter(([, track]) => isFailed(track) && track.run?.skipQueued === true)
    .map(([id]) => id);

/** Назначенный автоповтор снят — настройку выключили, пока шаг ждал: шаг ждёт владельца. */
export const onRetryDropped = (progress: FlowProgress, stageId: string): FlowProgress =>
  patch(progress, stageId, (track) => {
    if (track.run?.retryAt === undefined) return track;
    const { retryAt: _at, ...run } = track.run;
    return { ...track, run };
  });

/** Этап встал и ждёт владельца: упавший шаг — до повтора или пропуска, этап Action — до нажатия. Открытый интервал вторым открытием не сдвигается. */
export const onIdleOpen = (progress: FlowProgress, stageId: string, at: string): FlowProgress =>
  patch(progress, stageId, (track) => (track.idleSince === undefined ? { ...track, idleSince: at } : track));

/** Этап пошёл снова: открытый интервал ложится в накопленный простой. Открытого нет — запись не трогается вовсе. */
export const onIdleClose = (progress: FlowProgress, stageId: string, at: string): FlowProgress => {
  const since = progress.stages[stageId]?.idleSince;
  if (since === undefined) return progress;
  return patch(progress, stageId, ({ idleSince: _since, ...track }) => ({ ...track, idleMs: (track.idleMs ?? 0) + Math.max(0, Date.parse(at) - Date.parse(since)) }));
};

/** Целые минуты простоя этапа. Открытый интервал в число не идёт: он закрывается раньше, чем закрывается этап. */
export const idleMinutes = (track: StageTrack): number => Math.round((track.idleMs ?? 0) / 60_000);

/** Этапы flow, которые простояли хотя бы минуту, в порядке flow: имя и минуты. Этап записи вне flow не в счёт. */
export const idleStages = (progress: FlowProgress, stages: readonly WorkStage[]): Array<{ name: string; minutes: number }> =>
  stages.flatMap((stage) => {
    const minutes = idleMinutes(progress.stages[stage.id] ?? {});
    return minutes > 0 ? [{ name: stage.name, minutes }] : [];
  });

/** Первая строка реплики агенту: чем кончился прогон Flow. Язык реплики — английский, её читает агент. */
const CARRY_ON: Record<"automation" | "action", string> = {
  automation: "Flow: the automation stage is done — carry on with the next stage of the flow.",
  action: "Flow: the action stage is done — carry on with the next stage of the flow.",
};

/** Строка простоя для агента: какие этапы сколько простояли и куда это отнести. Простоя не было — пустая строка. */
export const idleNote = (idle: ReadonlyArray<{ name: string; minutes: number }>): string =>
  idle.length === 0 ? "" : `Idle waiting for the owner:\n${idle.map((s) => `- ${s.name} — ${s.minutes} m`).join("\n")}\nName it in the flow report and in the task report.`;

/** Реплика агенту после прогона Flow: продолжение работы с этапа `next` и простой по этапам, который агент относит в отчёт. */
export const wakeText = (kind: "automation" | "action", idle: ReadonlyArray<{ name: string; minutes: number }>, next?: WorkStage): string => {
  const head = next === undefined ? CARRY_ON[kind] : `${CARRY_ON[kind]}\nNext stage: ${next.id} "${next.name}".`;
  const note = idleNote(idle);
  return note === "" ? head : `${head}\n\n${note}`;
};

/** Этап с упавшим шагом: не закрыт, а у прогона есть ошибка. */
export const isFailed = (track: StageTrack): boolean => track.finishedAt === undefined && typeof track.run?.error === "string";

/** Этапы с упавшим шагом — тред ждёт владельца. */
export const failedAutomations = (progress: FlowProgress): string[] =>
  Object.entries(progress.stages)
    .filter(([, track]) => isFailed(track))
    .map(([id]) => id);

const stepState = (track: StageTrack, index: number, waits: boolean): StepView["state"] => {
  const run = track.run;
  if (track.finishedAt !== undefined) return "done";
  // До снимка шагов этап не начат: кнопки нет, иначе нажатие пришло бы раньше, чем Flow встал в ожидание владельца.
  if (run === undefined || index > run.at) return "todo";
  if (index < run.at) return "done";
  if (run.error !== null) return "fail";
  return waits && run.busy !== true ? "wait" : "now";
};

/** Шаги этапа-автоматизации или этапа Action с состояниями для полосы; ошибка — только у упавшего, `wait` — шаг Action ждёт нажатия. */
export const automationView = (stage: WorkStage, track: StageTrack): { steps: StepView[] } => ({
  steps: (track.run?.steps ?? stepsOf(stage)).map((step, index) => {
    const state = stepState(track, index, isActionStage(stage));
    const failed = state === "fail";
    // У упавшего шага кнопки остаются и с отметкой: пропуск, который не применился, владелец нажмёт снова.
    const skipQueued = state === "now" && track.run?.skipQueued === true;
    return { id: step.id, label: step.label, state, error: failed ? (track.run?.error ?? null) : null, detail: step.detail ?? null, retryAt: failed ? (track.run?.retryAt ?? null) : null, skipQueued };
  }),
});

/**
 * Значок идущего этапа в левой панели; не идёт, упал или закончен — `null`.
 * Этап Action живой только пока исполняется нажатый шаг: ждущий нажатия ждёт владельца, а не работает.
 */
export const runningIcon = (stage: WorkStage, track: StageTrack): RunningIcon | null => {
  if (track.startedAt === undefined || track.finishedAt !== undefined || isFailed(track)) return null;
  if (isActionStage(stage)) return track.run?.busy === true ? "action" : null;
  return stage.automation !== undefined ? "automation" : executorKind(track.executor);
};

/** Значок этапа, на котором сейчас идёт работа: автоматизация идёт сама, этап навыка — только ходом агента. */
export const liveIcon = (stage: WorkStage, track: StageTrack, agentActive: boolean): RunningIcon | null => {
  const icon = runningIcon(stage, track);
  return icon === "automation" || icon === "action" || agentActive ? icon : null;
};

/** Провайдер исполнителя этапа навыка: сам агент — провайдер треда, субагент — свой; у workflow, автоматизации и встроенного этапа — нет. */
export const executorProvider = (stage: WorkStage, track: StageTrack, threadProvider: string | null): string | null => {
  if (stage.kind !== "skill" || stage.automation !== undefined) return null;
  const kind = executorKind(track.executor);
  return kind === "self" ? threadProvider : kind === "agent" ? (stage.executors.find((e) => e.id === track.executor)?.provider ?? null) : null;
};

/** Значок живого этапа треда: этап, ждущий владельца, не живой — работа за ним. */
export const stageLiveIcon = (progress: FlowProgress, stage: WorkStage, agentActive: boolean): RunningIcon | null =>
  progress.waiting.includes(stage.id) ? null : liveIcon(stage, progress.stages[stage.id] ?? {}, agentActive);

/** Строка этапа Action в инструкциях агенту: его шаги запускает владелец кнопками, агент заканчивает ход. */
export const actionInstruction = (stage: WorkStage, index: number): string =>
  `${index + 1}. ${stage.id} "${stage.name}" — action: the owner runs this stage step by step with a button above the composer; do not run it and do not mark it — after marking the stage before it, end your turn; a done stage needs no results`;

/** Строка этапа-автоматизации в инструкциях агенту: её ведёт Flow, агент заканчивает ход и о старте говорит только по ответу flow_stage. */
export const automationInstruction = (stage: WorkStage, index: number): string =>
  `${index + 1}. ${stage.id} "${stage.name}" — automation: Flow runs this stage by itself once the nearest stage of the run before it is marked done; the flow_stage answer says whether it started — tell the owner only what that answer says; do not run it and do not mark it — after marking the stage before it, end your turn; a done stage needs no results`;

/** Свободный id встроенной автоматизации среди `taken`; префикс не пересекается с `automation-<id>` этапов Automations. */
const freeAutomationId = (taken: readonly string[]): string => freeId("flow-automation", taken);

/** Новая встроенная автоматизация без шагов: шаги добавляет владелец. Имя — английское, как у встроенных этапов. */
export const builtinAutomationStage = (taken: readonly string[]): WorkStage => ({
  id: freeAutomationId(taken),
  kind: "skill",
  skill: "",
  name: "Automation",
  executors: [],
  automation: { source: "flow", steps: [] },
});
