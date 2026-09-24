// Прогресс flow треда — чистые правки записи и её вид для баннера. Запись
// меняют три события: бриф агента, ответ владельца и отметка этапа агентом.
// Нужно серверу, а вид — и тестам баннера, поэтому из контракта только типы.
import { stageKindOf } from "../lib/stage-constants";
import type { DecisionAnswer, DecisionBrief, FlowProgress, Planned, ProgressView, WorkStage } from "../shared/contract";
import { automationView, executorKind, executorProvider, idleMinutes, isFailed, stageLiveIcon } from "./automation-run";
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

const finish = (at: string, results?: readonly Result[], cost?: number, activeMinutes?: number) => (track: Track): Track => ({
  ...track,
  finishedAt: at,
  ...(results === undefined ? {} : { results: [...results] }),
  ...(cost === undefined ? {} : { cost }),
  ...(activeMinutes === undefined ? {} : { activeMinutes }),
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
  // Бриф запоминается записью: под его карточкой в ленте встанет итог, когда прогон закроется.
  return { ...waiting.reduce((p, id) => patch(p, id, start(at)), finished), waiting, lastBriefId: brief.id };
};

/**
 * Ответ владельца: закрываются ждущие этапы отвечаемого брифа (Демонстрация с комментарием — нет) — не чужого, пришедшего позже;
 * этапы вне прогона снимаются, исполнитель и план запоминаются.
 */
export const onAnswer = (progress: FlowProgress, brief: DecisionBrief, answer: DecisionAnswer, at: string, planned?: Planned): FlowProgress => {
  if (!touchesProgress(brief)) return progress;
  const own = waitingOf(brief).filter((id) => progress.waiting.includes(id));
  const commented = brief.outcome !== undefined && demoVerdict(answer) === "comment";
  const closed = commented ? progress : own.reduce((p, id) => patch(p, id, finish(at)), progress);
  const chosen = (answer.stages ?? []).reduce((p, s) => patch(p, s.id, (t) => (t.finishedAt !== undefined ? t : { ...t, skipped: !s.run, executor: s.executor })), closed);
  return { ...chosen, waiting: progress.waiting.filter((id) => !own.includes(id)), ...(planned === undefined ? {} : { planned: { ...planned } }) };
};

/**
 * Прогон, уходящий вместе с работой в новый тред: этапы, взятые в прогон ответом о передаче,
 * начинаются заново. След предшественника на них — чужая работа: тред, который только начинает,
 * не может иметь сделанными этапы, до которых ещё не дошёл, а автоматизация с закрытым прогоном
 * в нём уже не запустится. Что вне прогона — не трогается: сделанное до передачи остаётся историей.
 */
export const forHandoff = (progress: FlowProgress, stages: ReadonlyArray<{ id: string; run: boolean; executor?: string }>): FlowProgress => {
  const rerun = stages.filter((stage) => stage.run);
  if (rerun.length === 0) return progress;
  const fresh = rerun.reduce((p, stage) => ({ ...p, stages: { ...p.stages, [stage.id]: stage.executor === undefined ? {} : { executor: stage.executor } } }), progress);
  return { ...fresh, waiting: progress.waiting.filter((id) => !rerun.some((stage) => stage.id === id)) };
};

/** Тред, который ведёт прогон: записанный носитель, а у записи без него — тред, под чьим id она лежит. */
export const carrierOf = (progress: FlowProgress, runId: string): string => progress.thread ?? runId;

/** Прогон переходит к другому треду: меняется только носитель. */
export const carriedBy = (progress: FlowProgress, threadId: string): FlowProgress => ({ ...progress, thread: threadId });

/** Отметка агента: начало этапа или конец со ссылками, стоимостью и активными минутами окна. */
export const onMark = (progress: FlowProgress, stage: string, state: "started" | "done", at: string, results?: readonly Result[], cost?: number, activeMinutes?: number): FlowProgress =>
  patch(progress, stage, state === "started" ? start(at) : finish(at, results, cost, activeMinutes));

/** Окна закрытых этапов, которые считаются по логам сессий. Этап с шагами не в счёт — его минуты считает сам Flow, а не лог сессии. */
const loggedWindows = (progress: FlowProgress): Array<{ id: string; track: Track; from: number; to: number }> =>
  Object.entries(progress.stages).flatMap(([id, track]) =>
    track.skipped === true || track.run !== undefined || track.startedAt === undefined || track.finishedAt === undefined
      ? []
      : [{ id, track, from: Date.parse(track.startedAt), to: Date.parse(track.finishedAt) }],
  );

/** Окна этапов, которым активные минуты ещё не считались: закрытые этапы прогона без числа. */
export const pendingActive = (progress: FlowProgress): Array<{ id: string; from: number; to: number }> =>
  loggedWindows(progress).flatMap(({ id, track, from, to }) => (track.activeMinutes === undefined ? [{ id, from, to }] : []));

/** Добор: посчитанные минуты ложатся в этапы, остальное в них не трогается. */
export const withActive = (progress: FlowProgress, entries: ReadonlyArray<{ id: string; minutes: number }>): FlowProgress =>
  entries.reduce((p, entry) => patch(p, entry.id, (track) => ({ ...track, activeMinutes: entry.minutes })), progress);

/**
 * Окна пересчёта записи, считанной до счёта по всем тредам: каждый закрытый этап заново.
 * Доллары — только тем, у кого они были: этап без цены закрывал бриф, а не агент, и цены у него нет.
 */
export const recountWindows = (progress: FlowProgress): Array<{ id: string; from: number; to: number; priced: boolean }> =>
  loggedWindows(progress).map(({ id, track, from, to }) => ({ id, from, to, priced: track.cost !== undefined }));

const atLeast = (before: number | undefined, after: number): number => Math.max(before ?? after, after);

/**
 * Пересчёт ложится в этапы и помечает запись: второй раз её не пересчитывают. Логов теперь читается больше, поэтому
 * число ниже прежнего значит, что часть лога с тех пор удалили, — прежнее остаётся. Доллары, которых лог не дал, тоже.
 */
export const recounted = (progress: FlowProgress, entries: ReadonlyArray<{ id: string; minutes: number; cost?: number }>): FlowProgress => ({
  ...entries.reduce(
    (p, entry) =>
      patch(p, entry.id, (track) => ({ ...track, activeMinutes: atLeast(track.activeMinutes, entry.minutes), ...(entry.cost === undefined ? {} : { cost: atLeast(track.cost, entry.cost) }) })),
    progress,
  ),
  countedAcrossRun: true,
});

/** Миллисекунды от начала этапа до его конца; этап не закрыт — `null`. */
const spanMs = (track: Track): number | null =>
  track.startedAt === undefined || track.finishedAt === undefined ? null : Date.parse(track.finishedAt) - Date.parse(track.startedAt);

const asMinutes = (ms: number | null): number | null => (ms === null ? null : Math.max(0, Math.round(ms / 60_000)));

const minutesBetween = (track: Track): number | null => asMinutes(spanMs(track));

/** Минуты работы этапа с шагами: всё его время без простоя в ожидании владельца. */
const workMinutes = (track: Track): number | null => {
  const ms = spanMs(track);
  return ms === null ? null : asMinutes(ms - (track.idleMs ?? 0));
};

const optionalProvider = (provider: string | null) => (provider === null ? {} : { provider });

/** Вид прогресса по этапам flow треда: этап без записи — впереди, этап записи вне flow — не показывается; счёт и номера — по этапам прогона; живой — на этапе идёт работа, ждущий владельца не живой; провайдер — у исполнителя этапа навыка. */
export const progressView = (progress: FlowProgress, stages: readonly WorkStage[], agentActive = false, threadProvider: string | null = null): ProgressView => {
  const rows = stages.map((stage) => {
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
      // Минуты этапа с шагами — работа его шагов; у этапа навыка — активные, а пока их не считали — прежние стенные часы, чтобы строка не осталась пустой.
      minutes: state === "done" ? (track.run !== undefined ? workMinutes(track) : (track.activeMinutes ?? minutesBetween(track))) : null,
      wallMinutes: state === "done" ? minutesBetween(track) : null,
      idleMinutes: state === "done" && track.run !== undefined ? idleMinutes(track) : null,
      cost: track.cost ?? null,
      ...(stage.automation === undefined ? {} : { automation: automationView(stage, track) }),
    } as const;
  });
  // Вычеркнутые этапы не нумеруются: номер этапа — его место среди этапов прогона, он же числитель счётчика; без текущего этапа числитель — их число.
  const counted = rows.filter((s) => s.state !== "skip");
  const view = rows.map((row) => ({ ...row, number: row.state === "skip" ? null : counted.indexOf(row) + 1 }));
  const current = view.find((s) => s.state === "now" || s.state === "fail") ?? view.find((s) => s.state === "todo");
  const step = current?.number ?? counted.length;
  return { stages: view, done: view.filter((s) => s.state === "done").length, step, total: counted.length, current: current?.id ?? null, planned: progress.planned ?? null };
};
