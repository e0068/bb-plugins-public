// Слой 2 — чисто. Прогон этапов-автоматизаций без агента: какой этап запускать
// следующим, как шаги ложатся в прогресс треда, как этап выглядит в полосе и
// в левой панели и что сказать о нём агенту. Эффекты — исполнение шагов и
// запись в kv — у server/automation-runner.ts.
import { isStepId, STEP_LABELS } from "../packages/automation-steps/catalog";
import { freeId } from "../lib/stage-constants";
import { scriptOf } from "./automation-scripts";
import type { BuiltinAutomation, FlowProgress, ProgressView, RunningIcon, StageTrack, WorkStage } from "../shared/contract";

export type RunStep = { id: string; label: string };

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


/**
 * Автоматизация, которую пора исполнять: ненаступившая — с начала (`from: null`), прерванная без ошибки — со своего шага.
 * Прерванной бывает прогон, который шёл, когда сервер перезапустился; упавшая ждёт повтора владельца.
 */
export const pendingAutomation = (stages: readonly WorkStage[], progress: FlowProgress): { stage: WorkStage; from: number | null } | null => {
  const first = stages.find((stage) => isOpen(progress.stages[stage.id]));
  if (first?.automation === undefined) return null;
  const run = progress.stages[first.id]?.run;
  return run === undefined ? { stage: first, from: null } : run.error === null ? { stage: first, from: run.at } : null;
};

/** Первый незакрытый этап прогона, если это автоматизация, которую ещё не запускали; иначе `null`. */
export const nextAutomation = (stages: readonly WorkStage[], progress: FlowProgress): WorkStage | null => {
  const pending = pendingAutomation(stages, progress);
  return pending?.from === null ? pending.stage : null;
};

/** Старт прогона этапа; этап без шагов закрывается сразу. */
export const onRunStart = (progress: FlowProgress, stageId: string, steps: readonly RunStep[], at: string): FlowProgress =>
  patch(progress, stageId, (track) => ({
    ...track,
    startedAt: at,
    finishedAt: steps.length === 0 ? at : undefined,
    run: { steps: steps.map((s) => ({ ...s })), at: 0, error: null },
  }));

/** Шаг выполнен: прогон идёт к следующему, последний закрывает этап. */
export const onStepDone = (progress: FlowProgress, stageId: string, at: string): FlowProgress =>
  patch(progress, stageId, (track) => {
    if (track.run === undefined) return track;
    const next = track.run.at + 1;
    return { ...track, run: { ...track.run, at: next, error: null }, ...(next >= track.run.steps.length ? { finishedAt: at } : {}) };
  });

export const onStepFailed = (progress: FlowProgress, stageId: string, error: string): FlowProgress =>
  patch(progress, stageId, (track) => (track.run === undefined ? track : { ...track, run: { ...track.run, error } }));

/** Повтор: упавший шаг снова текущий и без ошибки. */
export const onRunRetry = (progress: FlowProgress, stageId: string): FlowProgress =>
  patch(progress, stageId, (track) => (track.run === undefined ? track : { ...track, run: { ...track.run, error: null } }));

/** Этап с упавшим шагом: не закрыт, а у прогона есть ошибка. */
export const isFailed = (track: StageTrack): boolean => track.finishedAt === undefined && typeof track.run?.error === "string";

/** Этапы с упавшим шагом — тред ждёт владельца. */
export const failedAutomations = (progress: FlowProgress): string[] =>
  Object.entries(progress.stages)
    .filter(([, track]) => isFailed(track))
    .map(([id]) => id);

const stepState = (track: StageTrack, index: number): StepView["state"] => {
  const run = track.run;
  if (track.finishedAt !== undefined) return "done";
  if (run === undefined || index > run.at) return "todo";
  if (index < run.at) return "done";
  return run.error === null ? "now" : "fail";
};

/** Шаги этапа-автоматизации с состояниями для полосы; ошибка — только у упавшего. */
export const automationView = (stage: WorkStage, track: StageTrack): { steps: StepView[] } => ({
  steps: (track.run?.steps ?? stepsOf(stage)).map((step, index) => {
    const state = stepState(track, index);
    return { id: step.id, label: step.label, state, error: state === "fail" ? (track.run?.error ?? null) : null };
  }),
});

/** Значок идущего этапа в левой панели; не идёт, упал или закончен — `null`. */
export const runningIcon = (stage: WorkStage, track: StageTrack): RunningIcon | null => {
  if (track.startedAt === undefined || track.finishedAt !== undefined || isFailed(track)) return null;
  return stage.automation !== undefined ? "automation" : executorKind(track.executor);
};

/** Значок этапа, на котором сейчас идёт работа: автоматизация идёт сама, этап навыка — только ходом агента. */
export const liveIcon = (stage: WorkStage, track: StageTrack, agentActive: boolean): RunningIcon | null => {
  const icon = runningIcon(stage, track);
  return icon === "automation" || agentActive ? icon : null;
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
