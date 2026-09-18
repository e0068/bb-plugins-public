// Слой 1 — чисто. Итог этапа: пункты «Готово, когда» одним списком, название
// этапа из снимка настроек брифа и полнота ответа. Считается по брифу и
// ответу, поэтому одинаково в виджете, в реплике агенту и на сервере.
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

/** Название этапа — из снимка настроек брифа; этап, которого в снимке нет, зовётся своим id. */
export const outcomeStageName = (brief: DecisionBrief): string => {
  const id = brief.outcome?.stage ?? "";
  return (brief.stages?.list ?? []).find((stage) => stage.id === id)?.name ?? id;
};

/** Исход Демонстрации: продолжить, продолжить с комментарием или на доработку; `null` — итог не отвечен. */
export type DemoVerdict = "continue" | "comment" | "rework";

export const demoVerdict = (answer: Pick<DecisionAnswer, "outcome">): DemoVerdict | null => {
  const noted = (answer.outcome?.note ?? "").trim().length > 0;
  if (answer.outcome?.accepted === true) return noted ? "comment" : "continue";
  return noted ? "rework" : null;
};

/** Абзацы текста Демонстрации: разделены пустой строкой, пустые отброшены. */
export const paragraphs = (text: string): string[] =>
  text
    .split(/\n[ \t]*\n/)
    .map((part) => part.replace(/^\n+|\n+$/g, "").trim())
    .filter((part) => part.length > 0);

/** Демонстрация отвечена одним из трёх исходов. */
export const outcomeAnswered = (answer: Pick<DecisionAnswer, "outcome">): boolean => demoVerdict(answer) !== null;

/** Живой результат — то, что владелец видит работающим: страница по адресу http(s) или запуск командой. */
export const isLiveResult = (result: OutcomeResult): boolean => "command" in result || /^https?:\/\//.test(result.target);

/** Итог без живого результата принимается, только если агент отметил, что менялись одни документы. */
export const liveIssues = (outcome: Pick<StageOutcome, "results" | "documentsOnly">): string[] =>
  outcome.documentsOnly === true || outcome.results.some(isLiveResult)
    ? []
    : [
        "outcome.results has no live result: add a link to the running result — a page URL from `bb connect expose <port>` (or http://localhost:<port> without Connect) — or a launch result { label, command } that starts a desktop app; if only documents changed since the previous demo, set outcome.documentsOnly: true",
      ];
