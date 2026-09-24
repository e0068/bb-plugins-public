// Слой 2 — чисто. Прогон этапов-автоматизаций без агента: какой этап запускать
// следующим, как шаги ложатся в прогресс треда, как этап выглядит в полосе и
// в левой панели и что сказать о нём агенту. Эффекты — исполнение шагов и
// запись в kv — у server/automation-runner.ts.
import { isStepId, STEP_LABELS } from "../packages/automation-steps/catalog";
import { freeId, stageKindOf } from "../lib/stage-constants";
import { scriptOf } from "./automation-scripts";
import type { BuiltinAutomation, FlowProgress, ProgressView, RunningIcon, StageTrack, WorkStage } from "../shared/contract";

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

/**
 * Автоматизация, которую пора исполнять: ненаступившая — с начала (`from: null`), прерванная без ошибки — со своего шага.
 * Прерванной бывает прогон, который шёл, когда сервер перезапустился; упавшая ждёт повтора владельца.
 * Этап Action цепочку останавливает: его шаги идут только по нажатию владельца.
 */
export const pendingAutomation = (stages: readonly WorkStage[], progress: FlowProgress): { stage: WorkStage; from: number | null } | null => {
  const first = stages.find((stage) => isOpen(progress.stages[stage.id]));
  if (first === undefined || first.automation === undefined || isActionStage(first)) return null;
  const run = progress.stages[first.id]?.run;
  return run === undefined ? { stage: first, from: null } : run.error === null ? { stage: first, from: run.at } : null;
};

/**
 * Этап Action, который ждёт нажатия владельца: первый незакрытый этап прогона, если это Action,
 * и номер шага, до которого дошёл прогон. Шаги закончились — этап закрыт и ждать нечего.
 */
export const pendingAction = (stages: readonly WorkStage[], progress: FlowProgress): { stage: WorkStage; at: number } | null => {
  const first = stages.find((stage) => isOpen(progress.stages[stage.id]));
  if (first === undefined || !isActionStage(first)) return null;
  // Начатый этап идёт по своему снимку: шаг, убранный из этапа по ходу прогона, прогон бы запер.
  const run = progress.stages[first.id]?.run;
  if (run === undefined) return { stage: first, at: 0 };
  return run.at >= run.steps.length ? null : { stage: first, at: run.at };
};

/** Прогон без признака «шаг идёт»: признак живёт только пока шаг Action исполняется. */
const idle = ({ busy: _busy, ...run }: NonNullable<StageTrack["run"]>): NonNullable<StageTrack["run"]> => run;

/** Шаг Action взят в работу: до ответа он идёт, и второе нажатие его не запустит. */
export const onStepStarted = (progress: FlowProgress, stageId: string): FlowProgress =>
  patch(progress, stageId, (track) => (track.run === undefined ? track : { ...track, run: { ...track.run, error: null, busy: true } }));

/** Первый незакрытый этап прогона, если это автоматизация, которую ещё не запускали; иначе `null`. */
export const nextAutomation = (stages: readonly WorkStage[], progress: FlowProgress): WorkStage | null => {
  const pending = pendingAutomation(stages, progress);
  return pending?.from === null ? pending.stage : null;
};

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
    return { ...track, run: { ...idle(track.run), steps, at: next, error: null }, ...(next >= track.run.steps.length ? { finishedAt: at } : {}) };
  });

/**
 * Шаг упал: прогон встаёт с ошибкой, и та же ошибка ложится в историю
 * падений. Историю не стирают ни повтор, ни пропуск — иначе первое же нажатие
 * «Повторить» уносит единственный след того, что шаг вообще падал, и через
 * неделю чинить нечего.
 */
export const onStepFailed = (progress: FlowProgress, stageId: string, error: string, at: string): FlowProgress =>
  patch(progress, stageId, (track) => {
    if (track.run === undefined) return track;
    const step = track.run.steps[track.run.at]?.id ?? String(track.run.at);
    return { ...track, run: { ...idle(track.run), error, failures: [...(track.run.failures ?? []), { step, at, error }] } };
  });

/** Повтор: упавший шаг снова текущий и без ошибки. */
export const onRunRetry = (progress: FlowProgress, stageId: string): FlowProgress =>
  patch(progress, stageId, (track) => (track.run === undefined ? track : { ...track, run: { ...idle(track.run), error: null } }));

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

/** Реплика агенту после прогона Flow: продолжение работы и простой по этапам, который агент относит в отчёт. */
export const wakeText = (kind: "automation" | "action", idle: ReadonlyArray<{ name: string; minutes: number }>): string => {
  const note = idleNote(idle);
  return note === "" ? CARRY_ON[kind] : `${CARRY_ON[kind]}\n\n${note}`;
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
    return { id: step.id, label: step.label, state, error: state === "fail" ? (track.run?.error ?? null) : null, detail: step.detail ?? null };
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

/** Строка этапа-автоматизации в инструкциях агенту: её ведёт Flow, агент заканчивает ход. */
export const automationInstruction = (stage: WorkStage, index: number): string =>
  `${index + 1}. ${stage.id} "${stage.name}" — automation: Flow runs this stage by itself as soon as the stage before it is marked done; do not run it and do not mark it — after marking the stage before it, end your turn; a done stage needs no results`;

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
