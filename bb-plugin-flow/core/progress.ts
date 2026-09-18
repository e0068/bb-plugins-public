// Прогресс flow треда — чистые правки записи и её вид для баннера. Запись
// меняют три события: бриф агента, ответ владельца и отметка этапа агентом.
// Нужно серверу, а вид — и тестам баннера, поэтому из контракта только типы.
import { stageKindOf } from "../lib/stage-constants";
import type { DecisionAnswer, DecisionBrief, FlowProgress, Planned, ProgressView, WorkStage } from "../shared/contract";
import { automationView, executorKind, executorProvider, isFailed, stageLiveIcon } from "./automation-run";
import { demoVerdict } from "./outcome";
import { askedStageIds } from "./stages";

export const EMPTY_PROGRESS: FlowProgress = { stages: {}, waiting: [] };

type Track = FlowProgress["stages"][string];
type Result = { label: string; target: string };

const patch = (progress: FlowProgress, id: string, change: (track: Track) => Track): FlowProgress => ({
  ...progress,
  stages: { ...progress.stages, [id]: change(progress.stages[id] ?? {}) },
});

const start = (at: string) => (track: Track): Track => (track.startedAt === undefined || track.finishedAt !== undefined ? { ...track, startedAt: at, finishedAt: undefined } : track);

const finish = (at: string, results?: readonly Result[], cost?: number) => (track: Track): Track => ({
  ...track,
  finishedAt: at,
  ...(results === undefined ? {} : { results: [...results] }),
  ...(cost === undefined ? {} : { cost }),
});

/** Ждущие этапы брифа: Демонстрация итога или этапы, на которые бриф отвечает сам. */
const waitingOf = (brief: DecisionBrief): string[] => (brief.outcome !== undefined ? [brief.outcome.stage] : askedStageIds(brief));

/** Меняет ли бриф прогресс: вопросы посреди работы без этапов и без итога его не трогают. */
export const touchesProgress = (brief: DecisionBrief): boolean => brief.setup?.stages !== undefined || brief.outcome !== undefined;

/** Бриф агента: сделанные по отчёту получают конец и ссылки, ждущие — начало. */
export const onBrief = (progress: FlowProgress, brief: DecisionBrief, at: string): FlowProgress => {
  if (!touchesProgress(brief)) return progress;
  const done = (brief.setup?.stages ?? []).filter((r) => r.state !== "todo");
  const finished = done.reduce((p, r) => patch(p, r.id, (t) => (t.finishedAt === undefined ? finish(at, r.results)(t) : { ...t, ...(r.results === undefined ? {} : { results: [...r.results] }) })), progress);
  const waiting = waitingOf(brief);
  return { ...waiting.reduce((p, id) => patch(p, id, start(at)), finished), waiting };
};

/**
 * Ответ владельца: закрываются ждущие этапы отвечаемого брифа (Демонстрация на доработку — нет) — не чужого, пришедшего позже;
 * этапы вне прогона снимаются, исполнитель и план запоминаются.
 */
export const onAnswer = (progress: FlowProgress, brief: DecisionBrief, answer: DecisionAnswer, at: string, planned?: Planned): FlowProgress => {
  if (!touchesProgress(brief)) return progress;
  const own = waitingOf(brief).filter((id) => progress.waiting.includes(id));
  const rework = brief.outcome !== undefined && demoVerdict(answer) === "rework";
  const closed = rework ? progress : own.reduce((p, id) => patch(p, id, finish(at)), progress);
  const chosen = (answer.stages ?? []).reduce((p, s) => patch(p, s.id, (t) => (t.finishedAt !== undefined ? t : { ...t, skipped: !s.run, executor: s.executor })), closed);
  return { ...chosen, waiting: progress.waiting.filter((id) => !own.includes(id)), ...(planned === undefined ? {} : { planned: { ...planned } }) };
};

/** Отметка агента: начало этапа или конец со ссылками и стоимостью окна. */
export const onMark = (progress: FlowProgress, stage: string, state: "started" | "done", at: string, results?: readonly Result[], cost?: number): FlowProgress =>
  patch(progress, stage, state === "started" ? start(at) : finish(at, results, cost));

const minutesBetween = (track: Track): number | null =>
  track.startedAt === undefined || track.finishedAt === undefined ? null : Math.max(0, Math.round((Date.parse(track.finishedAt) - Date.parse(track.startedAt)) / 60_000));

const optionalProvider = (provider: string | null) => (provider === null ? {} : { provider });

/** Вид прогресса по этапам flow треда: этап без записи — впереди, этап записи вне flow — не показывается; счёт — по этапам прогона; живой — на этапе идёт работа, ждущий владельца не живой; провайдер — у исполнителя этапа навыка. */
export const progressView = (progress: FlowProgress, stages: readonly WorkStage[], agentActive = false, threadProvider: string | null = null): ProgressView => {
  const view = stages.map((stage) => {
    const track = progress.stages[stage.id] ?? {};
    const state = track.finishedAt !== undefined ? "done" : isFailed(track) ? "fail" : progress.waiting.includes(stage.id) || track.startedAt !== undefined ? "now" : track.skipped === true ? "skip" : "todo";
    return {
      id: stage.id,
      kind: stageKindOf(stage),
      name: stage.name,
      executor: executorKind(track.executor),
      state,
      live: stageLiveIcon(progress, stage, agentActive) !== null,
      ...optionalProvider(executorProvider(stage, track, threadProvider)),
      results: track.results ?? [],
      minutes: state === "done" ? minutesBetween(track) : null,
      cost: track.cost ?? null,
      ...(stage.automation === undefined ? {} : { automation: automationView(stage, track) }),
    } as const;
  });
  const current = view.find((s) => s.state === "now" || s.state === "fail") ?? view.find((s) => s.state === "todo");
  // Вычеркнутые этапы не нумеруются: номер — место текущего этапа среди этапов прогона, без текущего — их число.
  const counted = view.filter((s) => s.state !== "skip");
  const step = current === undefined ? counted.length : counted.indexOf(current) + 1;
  return { stages: view, done: view.filter((s) => s.state === "done").length, step, total: counted.length, current: current?.id ?? null, planned: progress.planned ?? null };
};
