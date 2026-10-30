// Слой 1 — чисто. Итог этапа: пункты Definition of Done одним списком, название
// этапа из снимка настроек брифа и полнота ответа. Считается по брифу и
// ответу, поэтому одинаково в виджете, в реплике агенту и на сервере.
import { stageKindOf } from "../lib/stage-constants";
import type { DecisionAnswer, DecisionBrief, OutcomeResult, StageOutcome } from "../shared/contract";

/** Идентификатор строки итога в списке незакрытого: не `setup.*` — итог не первая часть. */
export const OUTCOME_ROW = "outcome";

/** Пункт итога: сделан или нет, и почему не сделан. */
export type OutcomeItem = { done: boolean; text: string; why?: string };

/** Сделанное идёт первым: владелец читает сверху вниз, и «что осталось» стоит там, где взгляд останавливается. */
export const outcomeItems = (outcome: StageOutcome): OutcomeItem[] => [
  ...outcome.done.map((text) => ({ done: true, text })),
  ...outcome.pending.map(({ text, why }) => ({ done: false, text, ...(why === undefined ? {} : { why }) })),
];

export const isOutcomeBrief = (brief: DecisionBrief): boolean => brief.outcome !== undefined;

/** Название этапа `id` — из снимка настроек брифа; этап, которого в снимке нет, зовётся как назван. */
export const stageNameOf = (brief: DecisionBrief, id: string): string => (brief.stages?.list ?? []).find((stage) => stage.id === id)?.name ?? id;

/**
 * Вид итога: Демонстрация показывает сделанное, Утверждение держит прогон до «Утвердить» без комментария. Вид — по этапу
 * итога в снимке настроек брифа; этапа в снимке нет — Демонстрация, как у итогов до Утверждения.
 */
export type OutcomeKind = "demo" | "approve";

export const outcomeKind = (brief: DecisionBrief): OutcomeKind => {
  const stage = (brief.stages?.list ?? []).find((s) => s.id === brief.outcome?.stage);
  return stage !== undefined && stageKindOf(stage) === "approve" ? "approve" : "demo";
};

/** Название этапа Демонстрации брифа. */
export const outcomeStageName = (brief: DecisionBrief): string => stageNameOf(brief, brief.outcome?.stage ?? "");

/** Демонстрация — отчёт: сама ответа не принимает, `answerBrief` отказывает; её вопросы отвечают с Утверждением группы. */
export const isReport = (brief: DecisionBrief): boolean => brief.outcome !== undefined && outcomeKind(brief) !== "approve";

/**
 * Исход ответа на итог: продолжить, комментарий или переход в другой flow; `null` — итог не отвечен. Отвечают на Утверждение
 * (Демонстрация — отчёт, исхода не имеет; исходы в записях ответов на неё остались от прежних виджетов). Комментарий —
 * написанный к нему или свой ответ в строке вопроса — Утверждение не принимает: оно остаётся открытым, агент дорабатывает. Переход его тоже не принимает:
 * тред уходит в выбранный flow, а комментарий едет туда вместе с ним.
 */
export type DemoVerdict = "continue" | "comment" | "switch";

export const demoVerdict = (answer: Pick<DecisionAnswer, "outcome"> & Partial<Pick<DecisionAnswer, "answers">>): DemoVerdict | null => {
  // Исход есть только у ответа на Демонстрацию: свой ответ обычного брифа — не комментарий к ней.
  if (answer.outcome === undefined) return null;
  if (answer.outcome.flow !== undefined) return "switch";
  const owned = ownWords(answer);
  if (answer.outcome.accepted && !owned) return "continue";
  return owned || (answer.outcome.note ?? "").trim().length > 0 ? "comment" : null;
};

/**
 * Владелец написал своё в строке вопроса: это слово агенту, на которое ответить может только он. Поэтому такой ответ
 * всегда будит агента, а Демонстрацию не принимает, даже отправленный старым виджетом как приёмка.
 */
export const ownWords = (answer: Partial<Pick<DecisionAnswer, "answers">>): boolean => (answer.answers ?? []).some(({ own }) => (own ?? "").trim().length > 0);

/** Демонстрация отвечена одним из двух исходов. */
export const outcomeAnswered = (answer: Parameters<typeof demoVerdict>[0]): boolean => demoVerdict(answer) !== null;

/**
 * Виджет группы Утверждения в том виде, в котором он отвечает: Демонстрация с вопросами — брифом без итога и без снимка этапов
 * (без него у брифа не появляются этапы, которых владелец не выбирал), так её вопросы читаются, записываются и уходят агенту,
 * как у любого виджета группы. Остальное — как есть.
 */
export const memberOf = (member: DecisionBrief): DecisionBrief => {
  if (!isReport(member) || member.questions.length === 0) return member;
  const { outcome: _outcome, stages: _stages, ...plain } = member;
  return plain;
};

/** Ответ на Демонстрацию, ушедший брифом без итога — ответом её вопросов с Утверждением: вердикта у него нет. */
export const answeredAsQuestions = (brief: Pick<DecisionBrief, "outcome">, answer: Pick<DecisionAnswer, "outcome">): boolean => brief.outcome !== undefined && answer.outcome === undefined;

/**
 * Демонстрация — отчёт, перехода у неё нет: работу в другой flow переводит кнопка утверждения, поэтому `nextFlow` допустим
 * только там. Вопросы — только когда впереди Утверждение (`questionsAllowed`): ответ копится до него; без него отвечать некуда,
 * и вопрос идёт отдельным уточнением.
 */
export const reportOnlyIssues = (outcome: Pick<StageOutcome, "nextFlow">, questionCount: number, questionsAllowed = false): string[] => [
  ...(questionCount === 0 || questionsAllowed ? [] : ["a demo is a report: questions go as a clarify, a flow switch as outcome.nextFlow on an approval"]),
  ...(outcome.nextFlow === undefined ? [] : ["outcome.nextFlow goes on an approval: the owner moves the work with its button"]),
];

/** Рекомендованный flow — один из flow владельца: перейти в несуществующий утверждение не может. */
export const nextFlowIssues = (outcome: Pick<StageOutcome, "nextFlow">, flowIds: readonly string[]): string[] =>
  outcome.nextFlow === undefined || flowIds.includes(outcome.nextFlow)
    ? []
    : [`outcome.nextFlow ${outcome.nextFlow} is not one of the owner's flows: ${flowIds.join(", ")}`];

/** Живой результат — то, что владелец видит работающим: страница по адресу http(s) или запуск командой. */
export const isLiveResult = (result: OutcomeResult): boolean => "command" in result || /^https?:\/\//.test(result.target);

/** Итог без живого результата принимается, только если агент отметил, что менялись одни документы. */
export const liveIssues = (outcome: Pick<StageOutcome, "results" | "documentsOnly">): string[] =>
  outcome.documentsOnly === true || outcome.results.some(isLiveResult)
    ? []
    : [
        "outcome.results has no live result: add a link to the running result — a page URL from `bb connect expose <port>` (or http://localhost:<port> without Connect) — or a launch result { label, command } that starts a desktop app; if only documents changed since the previous demo, set outcome.documentsOnly: true",
      ];
