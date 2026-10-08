// Прогресс flow треда — чистые правки записи и её вид для баннера. Запись
// меняют три события: бриф агента, ответ владельца и отметка этапа агентом.
// Нужно серверу, а вид — и тестам баннера, поэтому из контракта только типы.
import { stageKindOf } from "../lib/stage-constants";
import type { DecisionAnswer, DecisionBrief, FlowProgress, Planned, ProgressView, WorkStage } from "../shared/contract";
import { automationView, executorKind, executorProvider, idleMinutes, isFailed, stageLiveIcon } from "./automation-run";
import { stagePlans } from "./budget";
import { demoVerdict } from "./outcome";
import { askedStageIds, isAutomationStage } from "./stages";
import { runCascade } from "./sub-stages";

export const EMPTY_PROGRESS: FlowProgress = { stages: {}, waiting: [] };

type Track = FlowProgress["stages"][string];
type Result = NonNullable<Track["results"]>[number];

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

/** Меняет ли ответ прогресс: бриф с этапами или итогом — да; уточнение запущенной работы — только своим прогнозом, новым планом прогона. */
export const answerMovesProgress = (brief: DecisionBrief, planned: Planned | undefined): boolean => touchesProgress(brief) || (brief.launched === true && planned !== undefined);

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
 * Ответ владельца: закрываются ждущие этапы отвечаемого брифа (Демонстрация с комментарием или переходом — нет) — не чужого, пришедшего позже;
 * этапы вне прогона снимаются, исполнитель и план запоминаются. Пройденный этап остаётся пройденным, а выбор для него
 * ждёт нового прохода: иначе доработка вернула бы этапу выбор прошлого прохода.
 */
export const onAnswer = (progress: FlowProgress, brief: DecisionBrief, answer: DecisionAnswer, at: string, planned?: Planned): FlowProgress => {
  if (!answerMovesProgress(brief, planned)) return progress;
  // Уточнение посреди работы этапов не трогает, но его прогноз — новый итог прогона: полоса показывает его.
  if (!touchesProgress(brief)) return planned === undefined ? progress : { ...progress, planned: { ...planned } };
  const own = waitingOf(brief).filter((id) => progress.waiting.includes(id));
  // Комментарий Демонстрацию не закрывает; переход тоже, хотя до прогона он не доходит: прогон после него снят.
  const verdict = demoVerdict(answer);
  const commented = brief.outcome !== undefined && (verdict === "comment" || verdict === "switch");
  const closed = commented ? progress : own.reduce((p, id) => patch(p, id, finish(at)), progress);
  const chosen = (answer.stages ?? []).reduce((p, s) => {
    const choice = { skipped: !s.run, executor: s.executor };
    return patch(p, s.id, (t) => (t.finishedAt === undefined ? { ...t, ...choice } : own.includes(s.id) ? t : { ...t, nextPass: choice }));
  }, closed);
  const plans = { ...progress.plans, ...stagePlans(brief, answer) };
  return {
    ...chosen,
    waiting: progress.waiting.filter((id) => !own.includes(id)),
    ...(planned === undefined ? {} : { planned: { ...planned } }),
    ...(Object.keys(plans).length === 0 ? {} : { plans }),
  };
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

/** Минуты прохода закрытого этапа — те же, что в его строке баннера: у этапа с шагами работа шагов, у этапа навыка активные, а без них стенные. */
const passMinutes = (track: Track): number | null => (track.run !== undefined ? workMinutes(track) : (track.activeMinutes ?? minutesBetween(track)));

/**
 * Начало и конец прошлых проходов вместе с нынешним: незакрытый нынешний кончается моментом сброса `at` — этап шёл до
 * него. Проход без отметки о старте времени не оставляет, записи до поля — тоже.
 */
const passesSoFar = (track: Track, at: string): Pick<Track, "passes"> => {
  const passes = [...(track.passes ?? []), ...(track.startedAt === undefined ? [] : [{ from: track.startedAt, to: track.finishedAt ?? at }])];
  return passes.length === 0 ? {} : { passes };
};

/** Прошлые проходы этапа вместе с нынешним, если он закрыт: незакрытый проход ещё ничего не стоит. */
const spentSoFar = (track: Track): Track["earlier"] =>
  track.finishedAt === undefined
    ? track.earlier
    : {
        cost: (track.earlier?.cost ?? 0) + (track.cost ?? 0),
        minutes: (track.earlier?.minutes ?? 0) + (passMinutes(track) ?? 0),
        wall: (track.earlier?.wall ?? 0) + (minutesBetween(track) ?? 0),
        from: track.earlier?.from ?? track.startedAt ?? track.finishedAt,
      };

/** След этапа, который проходится заново с момента `at`: остаются исполнитель, вычеркнутость — выбранные ответом для нового прохода, если он был, — траты и время прошлых проходов. */
const cleared = (at: string) => (track: Track): Track => {
  const earlier = spentSoFar(track);
  const { executor, skipped } = track.nextPass ?? track;
  return {
    ...(executor === undefined ? {} : { executor }),
    ...(skipped === undefined ? {} : { skipped }),
    ...(earlier === undefined ? {} : { earlier }),
    ...passesSoFar(track, at),
  };
};

/** След этапа, который снова в прогоне, что бы ни выбрал ответ: вычеркнутость снимается. */
const rerun = (at: string) => (track: Track): Track => {
  const { skipped: _skipped, ...kept } = cleared(at)(track);
  return kept;
};

/** Этап тронут прогоном — начат, закрыт или шёл шагами; доработка сбрасывает именно такие этапы после начатого заново. */
export const touched = (track: Track | undefined): boolean => track !== undefined && (track.startedAt !== undefined || track.finishedAt !== undefined || track.run !== undefined);

/**
 * Этап впереди прогона: стоит во flow после последнего этапа, до которого прогон дошёл, — начатого, закрытого, ждущего владельца,
 * со шагами. Убранный брифом этап позади идущего не впереди: агент его уже миновал, и возвращать его некуда.
 */
export const isAhead = (progress: FlowProgress, stages: readonly WorkStage[], id: string): boolean => {
  const index = stages.findIndex((stage) => stage.id === id);
  const reached = stages.map((stage, at) => (touched(progress.stages[stage.id]) || progress.waiting.includes(stage.id) ? at : -1));
  return index >= 0 && index > Math.max(-1, ...reached);
};

/**
 * Чекбокс владельца: этап впереди убирается или возвращается вместе со связкой (`runCascade`), а возвращённые
 * запоминаются — агенту о них скажет ответ flow_stage. Этап связки, до которого прогон дошёл, не меняется.
 */
export const toggleStageInRun = (progress: FlowProgress, stages: readonly WorkStage[], id: string, run: boolean): FlowProgress =>
  runCascade(stages, id, run)
    .filter((each) => isAhead(progress, stages, each))
    .reduce((current, each) => {
      const others = (current.returned ?? []).filter((returned) => returned !== each);
      return { ...setStageInRun(current, each, run), returned: run ? [...others, each] : others };
    }, progress);

/** Владелец убирает этап из прогона или возвращает его; этап, до которого прогон дошёл — начатый, закрытый, ждущий владельца, со шагами, — не меняется. */
export const setStageInRun = (progress: FlowProgress, id: string, run: boolean): FlowProgress => {
  const reached = touched(progress.stages[id]) || progress.waiting.includes(id);
  return reached ? progress : patch(progress, id, (current) => ({ ...current, skipped: !run }));
};

/**
 * Доработка: закрытый этап `id` начинают снова — он открывается со своими ссылками и возвращается в прогон, а все тронутые этапы после него теряют
 * готовность и ждут своего прохода, иначе автоматизация за ними не наступила бы и правки доработки остались бы
 * незакоммиченными. Тронутая автоматизация возвращается в прогон, даже если ответ после её прохода её не брал: она уже
 * вынесла работу наружу — коммит, PR, мёрж, — и без нового прохода правки доработки туда не дойдут. Этап навыка, снятый
 * ответом, остаётся снятым: это выбор владельца на новый проход. Траты сброшенных проходов копятся в `earlier`.
 * Старт незакрытого этапа ничего не меняет: нетронутые этапы раньше закрытых — обычный прогон, а не доработка.
 */
export const reopen = (progress: FlowProgress, stages: readonly WorkStage[], id: string, at: string): FlowProgress => {
  const index = stages.findIndex((stage) => stage.id === id);
  if (index < 0 || progress.stages[id]?.finishedAt === undefined) return progress;
  const later = stages.slice(index + 1).map((stage) => stage.id).filter((after) => touched(progress.stages[after]));
  // Сам этап агент снова делает — он в прогоне, даже если владелец его не брал: иначе автоматизация за ним наступила бы на «started».
  const own = patch(progress, id, (track) => ({ ...rerun(at)(track), ...(track.results === undefined ? {} : { results: track.results }) }));
  const automations = new Set(stages.filter(isAutomationStage).map((stage) => stage.id));
  const reset = later.reduce((p, after) => patch(p, after, automations.has(after) ? rerun(at) : cleared(at)), own);
  return { ...reset, waiting: reset.waiting.filter((waiting) => !later.includes(waiting)) };
};

const optionalProvider = (provider: string | null) => (provider === null ? {} : { provider });

const plus = (value: number | null, earlier: number | undefined): number | null => (earlier === undefined ? value : (value ?? 0) + earlier);

/** Вид прогресса по этапам flow треда: этап без записи — впереди, этап записи вне flow — не показывается; счёт и номера — по этапам прогона; живой — на этапе идёт работа, ждущий владельца не живой; провайдер — у исполнителя этапа навыка. */
export const progressView = (progress: FlowProgress, stages: readonly WorkStage[], agentActive = false, threadProvider: string | null = null): ProgressView => {
  const rows = stages.map((stage) => {
    const track = progress.stages[stage.id] ?? {};
    const plan = progress.plans?.[stage.id];
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
      // Прошлые проходы, сброшенные доработкой, — в тех же минутах и долларах.
      minutes: state === "done" ? plus(passMinutes(track), track.earlier?.minutes) : null,
      wallMinutes: state === "done" ? plus(minutesBetween(track), track.earlier?.wall) : null,
      idleMinutes: state === "done" && track.run !== undefined ? idleMinutes(track) : null,
      cost: plus(track.cost ?? null, track.earlier?.cost),
      // План — этапу, который ещё впереди или идёт: у пройденного уже есть факт, у вычеркнутого тратить нечего.
      ...(plan === undefined || (state !== "todo" && state !== "now") ? {} : { plan }),
      ...(stage.automation === undefined ? {} : { automation: automationView(stage, track) }),
      ...(stage.parent === undefined ? {} : { parent: stage.parent }),
      ...(stage.icon === undefined ? {} : { icon: stage.icon }),
    } as const;
  });
  // Вычеркнутые этапы и под-этапы не нумеруются: номер этапа — его место среди этапов прогона верхнего уровня, он же числитель
  // счётчика и «сделано»; на под-этапе числитель — место его владельца (снятого — последнего номера до него); без текущего этапа — их число.
  const counted = rows.filter((s, at) => s.state !== "skip" && stages[at]!.parent === undefined);
  const view = rows.map((row) => ({ ...row, number: counted.includes(row) ? counted.indexOf(row) + 1 : null }));
  const current = view.find((s) => s.state === "now" || s.state === "fail") ?? view.find((s) => s.state === "todo");
  const ownerAt = view.findIndex((s) => s.id === (stages.find((stage) => stage.id === current?.id)?.parent ?? current?.id));
  const step = ownerAt < 0 ? counted.length : Math.max(1, view.slice(0, ownerAt + 1).filter((s) => s.number !== null).length);
  return { stages: view, done: counted.filter((s) => s.state === "done").length, step, total: counted.length, current: current?.id ?? null, planned: progress.planned ?? null };
};
