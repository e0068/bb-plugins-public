// Слой 1 — чисто. Прогон целиком: закончен ли он и что о нём говорить в
// итоге. Запись прогресса знает каждый этап по отдельности; «прогон завершён,
// шёл с такого-то по такое-то и стоил столько» — ответ этого модуля, и от него
// зависят скрытие баннера, блок итога в ленте и форма выбора следующего flow.
import { isFailed, executorKind } from "./automation-run";
import type { FlowProgress, WorkStage } from "../shared/contract";

type Track = FlowProgress["stages"][string];

/** Исполнитель этапов прогона: кем он был и сколько на нём сделано. */
export interface RunExecutor {
  readonly id: string;
  readonly kind: "self" | "agent" | "workflow";
  readonly name: string;
  readonly model?: string;
  readonly stages: number;
  readonly cost: number;
}

/** Итог прогона: его окно, потраченное время и деньги, состав этапов и исполнители. */
export interface RunSummary {
  readonly startedAt: string;
  readonly finishedAt: string;
  /** Минуты работы: активные минуты этапов, а у этапа без них — его стенные часы. */
  readonly minutes: number;
  /** Всё время прогона от начала первого этапа до конца последнего. */
  readonly wallMinutes: number;
  /** Время, когда прогон никем не занимался: стенные часы за вычетом работы. */
  readonly idleMinutes: number;
  readonly cost: number;
  readonly stages: number;
  readonly skipped: number;
  readonly executors: RunExecutor[];
}

const SELF: RunExecutor["id"] = "self";

const tracked = (progress: FlowProgress, stages: readonly WorkStage[]): Array<{ stage: WorkStage; track: Track }> =>
  stages.map((stage) => ({ stage, track: progress.stages[stage.id] ?? {} }));

/** Этап в прогоне: не вычеркнут владельцем. */
const inRun = (track: Track): boolean => track.skipped !== true;

const minutesOf = (ms: number): number => Math.max(0, Math.round(ms / 60_000));

/** Минуты работы этапа: посчитанные активные, а пока их нет — от начала до конца. */
const workMinutes = (track: Track): number => {
  if (track.activeMinutes !== undefined) return track.activeMinutes;
  if (track.startedAt === undefined || track.finishedAt === undefined) return 0;
  return minutesOf(Date.parse(track.finishedAt) - Date.parse(track.startedAt));
};

/**
 * Прогон завершён, когда работа в нём была и вся закрыта: ни ждущих владельца
 * этапов, ни упавших, ни незакрытых — и хотя бы один этап начинался. Тред, где
 * не начинался ни один этап, не завершён, а ещё не начат: иначе форма выбора
 * следующего flow встречала бы владельца в пустом треде.
 */
export const isRunFinished = (progress: FlowProgress, stages: readonly WorkStage[]): boolean => {
  if (progress.waiting.length > 0) return false;
  const rows = tracked(progress, stages).filter((row) => inRun(row.track));
  if (!rows.some((row) => row.track.startedAt !== undefined)) return false;
  return rows.every((row) => row.track.finishedAt !== undefined && !isFailed(row.track));
};

/** Исполнитель этапа словами: id из записи, а имя и модель — из самого этапа. */
const executorOf = (stage: WorkStage, track: Track): Pick<RunExecutor, "id" | "kind" | "name" | "model"> => {
  const id = track.executor ?? SELF;
  const executor = stage.executors.find((e) => e.id === id);
  return {
    id,
    kind: executorKind(id),
    name: executor?.name ?? SELF,
    ...(executor?.model === undefined ? {} : { model: executor.model }),
  };
};

const sumExecutors = (rows: ReadonlyArray<{ stage: WorkStage; track: Track }>): RunExecutor[] =>
  rows.reduce<RunExecutor[]>((acc, row) => {
    const who = executorOf(row.stage, row.track);
    const seen = acc.find((e) => e.id === who.id);
    const cost = row.track.cost ?? 0;
    if (seen === undefined) return [...acc, { ...who, stages: 1, cost }];
    return acc.map((e) => (e.id === who.id ? { ...e, stages: e.stages + 1, cost: e.cost + cost } : e));
  }, []);

/**
 * Итог прогона по его закрытым этапам; записи без единого закрытого этапа
 * итога не дают — показывать в блоке было бы нечего.
 */
export const runSummary = (progress: FlowProgress, stages: readonly WorkStage[]): RunSummary | null => {
  const rows = tracked(progress, stages).filter((row) => inRun(row.track) && row.track.startedAt !== undefined && row.track.finishedAt !== undefined);
  if (rows.length === 0) return null;
  const startedAt = rows.reduce((first, row) => (Date.parse(row.track.startedAt!) < Date.parse(first) ? row.track.startedAt! : first), rows[0]!.track.startedAt!);
  const finishedAt = rows.reduce((last, row) => (Date.parse(row.track.finishedAt!) > Date.parse(last) ? row.track.finishedAt! : last), rows[0]!.track.finishedAt!);
  const minutes = rows.reduce((sum, row) => sum + workMinutes(row.track), 0);
  const wallMinutes = minutesOf(Date.parse(finishedAt) - Date.parse(startedAt));
  return {
    startedAt,
    finishedAt,
    minutes,
    wallMinutes,
    idleMinutes: Math.max(0, wallMinutes - minutes),
    cost: rows.reduce((sum, row) => sum + (row.track.cost ?? 0), 0),
    stages: rows.length,
    skipped: tracked(progress, stages).filter((row) => row.track.skipped === true).length,
    executors: sumExecutors(rows),
  };
};
