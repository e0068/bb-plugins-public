// Слой 1 — чисто. Вопросы, Definition of Done и Выбор этапов прогон не держат: агент шлёт их и работает дальше по рекомендованному,
// а ответы владельца копятся черновиком до ближайшего Утверждения впереди. Нет его — агент решает сам, виджет только показывает решённое.
// Демонстрация впереди Утверждения получает поле комментария, который уходит с ним же.
import { stageKindOf } from "../lib/stage-constants";
import type { DecisionAnswer, DecisionBrief, FlowProgress, WorkStage } from "../shared/contract";
import { initialStageChoice, isAskedStage, stageItems } from "./stages";

export type Settle = NonNullable<DecisionBrief["settle"]>;

/** Есть ли во flow после места `from` Утверждение, которое ещё пройдёт: не сделанное и не снятое из прогона. */
const approvalAhead = (stages: readonly WorkStage[], progress: FlowProgress | null, from: number): boolean =>
  stages.slice(from + 1).some((s) => stageKindOf(s) === "approve" && progress?.stages[s.id]?.skipped !== true && progress?.stages[s.id]?.finishedAt === undefined);

/** Что метке нужно от брифа: вид, этап итога и отчёт об этапах. */
type Asked = {
  kind: DecisionBrief["kind"];
  outcome?: { stage: string } | undefined;
  questions?: readonly unknown[] | undefined;
  setup?: { stages?: ReadonlyArray<{ id: string; state: string }> | undefined; criteria?: readonly unknown[] | undefined } | undefined;
};

/**
 * Этапы, на которые бриф без отчёта об этапах отвечает своим содержимым, — во flow без «Выбора этапов» он приходит без `setup.stages`:
 * вопросы — этап Вопросов, пункты — этап Definition of Done; берётся первый не пройденный этап своего вида.
 */
const contentStages = (brief: Asked, stages: readonly WorkStage[], progress: FlowProgress | null): string[] => {
  const open = (kind: string) => stages.find((s) => stageKindOf(s) === kind && progress?.stages[s.id]?.finishedAt === undefined && progress?.stages[s.id]?.skipped !== true);
  const kinds = [...((brief.questions?.length ?? 0) > 0 ? ["questions"] : []), ...(brief.setup?.criteria === undefined ? [] : ["criteria"])];
  return kinds.flatMap((kind) => open(kind)?.id ?? []);
};

/**
 * Метка брифа треда с flow: `approval` — ответ копится до Утверждения впереди, `agent` — Утверждения впереди нет;
 * `undefined` — бриф держит ход по-старому или не копит ничего: уточнение, Утверждение, тред без flow, Демонстрация без
 * Утверждения впереди и развилка посреди запущенной работы, которая не отвечает ни на Вопросы, ни на Definition of Done, ни на Выбор этапов.
 */
export const settleOf = (brief: Asked, stages: readonly WorkStage[], progress: FlowProgress | null, approval: boolean, launched = false): Settle | undefined => {
  if (brief.kind !== "brief" || stages.length === 0 || approval) return undefined;
  const reported = (brief.setup?.stages ?? []).filter((r) => r.state === "todo" && stages.some((s) => s.id === r.id && isAskedStage(s))).map((r) => r.id);
  // До запуска бриф без отчёта об этапах отвечает на этапы своим содержимым; развилка посреди работы — не этап: она держит ход, как раньше.
  const at = brief.outcome !== undefined ? [brief.outcome.stage] : reported.length > 0 ? reported : launched ? [] : contentStages(brief, stages, progress);
  if (at.length === 0) return undefined;
  const from = Math.max(-1, ...at.map((id) => stages.findIndex((s) => s.id === id)));
  const ahead = approvalAhead(stages, progress, from);
  if (brief.outcome !== undefined) return ahead ? "approval" : undefined;
  return ahead ? "approval" : "agent";
};

/**
 * Уточнение группы, которое Утверждение уносит с собой: владелец на него не ответил и агент его не решил. Иначе над Утверждением
 * стоят две кнопки, и ответ на уточнение читается как утверждение, хотя Утверждение под ним ждёт дальше.
 */
export const joinsApproval = (brief: Pick<DecisionBrief, "kind" | "settle">, answered: boolean, resolved: boolean): boolean =>
  brief.kind === "clarify" && brief.settle === undefined && !answered && !resolved;

/** Бриф с вопросами, пунктами или этапами, который прогон не держит: ответ копится до Утверждения или агент решил сам. */
export const holdsNothing = (brief: Pick<DecisionBrief, "settle" | "outcome">): boolean => brief.settle !== undefined && brief.outcome === undefined;

/**
 * Решение агента без Утверждения впереди — ответ, как если бы владелец принял все рекомендации: рекомендованные варианты,
 * пункты без правок, рекомендованный прогон. По нему ложатся пункты, ответы для баннера, журнал и события, как у ответа кнопкой.
 */
export const recommendedAnswer = (brief: DecisionBrief): DecisionAnswer => {
  const items = stageItems(brief);
  return {
    briefId: brief.id,
    answers: brief.questions.flatMap((q) => {
      const picked = q.options.filter((o) => o.recommended).map((o) => o.id);
      return picked.length === 0 ? [] : [{ questionId: q.id, optionIds: picked }];
    }),
    ...(items.length === 0 ? {} : { stages: items.map((item) => ({ id: item.stage.id, ...initialStageChoice(brief, item) })) }),
    ...(brief.setup?.criteria === undefined ? {} : { criteria: { removed: [], edited: [], added: [] } }),
  };
};
