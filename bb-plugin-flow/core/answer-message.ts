// Что значит ответ на бриф: закрыт ли вопрос, сколько расхождений с
// рекомендацией и какой репликой ответ уходит агенту. Нужно и бэкенду, и
// виджету, поэтому из контракта берутся только типы.
import type { Locale } from "../lib/i18n";
import { messages, type Messages } from "../lib/messages";
import { stageKindOf } from "../lib/stage-constants";
import type { CriteriaAnswer, DecisionAnswer, DecisionBrief, DecisionQuestion, QuestionAnswer } from "../shared/contract";
import { budgetLine, changeOf, criterionTitle, hasForecast, hasOwnBudget } from "./budget";
import { carriedFor } from "./carry";
import { optionCriteria, removedCriteria } from "./option-criteria";
import { OUTCOME_ROW, demoVerdict, isOutcomeBrief, outcomeAnswered, outcomeStageName } from "./outcome";
import { requiredOf } from "./required";
import { REVIEW_ROWS, SETUP_ROW, checkerAllowed, rowsOf } from "./rows";
import { hiddenQuestions } from "./visibility";
import {
  answeredStageChoice,
  executorLabel,
  knownExecutor,
  recommendedStageChoice,
  stageAnswerOf,
  stageItems,
  stagePhase,
  stageRowId,
  type StageChoice,
  type StageItem,
} from "./stages";

const blank = (value: string | undefined): boolean => (value ?? "").trim().length === 0;

const takesOwn = (question: DecisionQuestion): boolean =>
  question.kind === "choice" ? question.allowOwn : question.kind !== "toggles";

export const isQuestionAnswered = (question: DecisionQuestion, entry: QuestionAnswer | undefined): boolean => {
  if (entry === undefined) return false;
  const known = new Set(question.options.map((o) => o.id));
  if (!entry.optionIds.every((id) => known.has(id))) return false;
  if (question.kind === "toggles") return blank(entry.own);
  // В `pick` касание и есть решение, свой текст складывается с включёнными.
  if (question.kind === "pick") return true;
  if (!blank(entry.own)) return takesOwn(question) && entry.optionIds.length === 0;
  return entry.optionIds.length === 1;
};

const entryFor = (answer: DecisionAnswer, questionId: string): QuestionAnswer | undefined =>
  answer.answers.find((a) => a.questionId === questionId);

const NO_EDITS: CriteriaAnswer = { removed: [], edited: [], added: [] };

/** Ложатся ли правки критерия на пункты брифа: номера в пределах списка, не повторяются, снятый не переписан. */
const criteriaFit = (brief: DecisionBrief, criteria: CriteriaAnswer | undefined): boolean => {
  if (criteria === undefined) return true;
  const count = brief.setup?.criteria?.length;
  if (count === undefined) return false;
  const touched = [...criteria.removed, ...criteria.edited.map((e) => e.index)];
  return touched.every((i) => i < count) && new Set(touched).size === touched.length;
};

/** Шаг ревью или тестирования внутри workflow возможен, только когда работу исполняет workflow. */
const reviewFits = (brief: DecisionBrief, answer: DecisionAnswer, rowId: string): boolean => {
  const executorIds = brief.setup?.executor === undefined ? undefined : (entryFor(answer, SETUP_ROW.executor)?.optionIds ?? []);
  return (entryFor(answer, rowId)?.optionIds ?? []).every((id) => checkerAllowed(executorIds, id));
};

/** Все ли обязательные по настройкам документы отмечены владельцем. */
export const requiredFit = (brief: DecisionBrief, answer: DecisionAnswer): boolean => {
  const kept = entryFor(answer, SETUP_ROW.artifacts)?.optionIds ?? [];
  return requiredOf(brief).every((a) => kept.includes(a.id));
};

export const openQuestions = (brief: DecisionBrief, answer: DecisionAnswer): string[] => {
  const rows = rowsOf(brief);
  const inBrief = new Set(rows.map((q) => q.id));
  const hidden = hiddenQuestions(brief, answer);
  const unanswered = rows
    .filter((q) => q.kind !== "yesno" && !hidden.has(q.id) && (!isQuestionAnswered(q, entryFor(answer, q.id)) || (REVIEW_ROWS.includes(q.id) && !reviewFits(brief, answer, q.id)) || (q.id === SETUP_ROW.artifacts && !requiredFit(brief, answer))))
    .map((q) => q.id);
  const strangers = answer.answers.map((a) => a.questionId).filter((id) => !inBrief.has(id));
  return [
    ...unanswered,
    ...strangers,
    ...openStages(brief, answer),
    ...openOutcome(brief, answer),
    ...(criteriaFit(brief, answer.criteria) ? [] : [SETUP_ROW.criteria]),
  ];
};

/** Итог этапа открыт, пока владелец не нажал «Продолжить» и не написал свой ответ; ответ на итог в брифе без итога — чужой. */
const openOutcome = (brief: DecisionBrief, answer: DecisionAnswer): string[] => {
  const answered = outcomeAnswered(answer);
  if (isOutcomeBrief(brief)) return answered ? [] : [OUTCOME_ROW];
  return answer.outcome === undefined ? [] : [OUTCOME_ROW];
};

/** Исполнитель не из этапа — открыт; выбор по чужому этапу — чужой. */
const openStages = (brief: DecisionBrief, answer: DecisionAnswer): string[] => {
  const items = stageItems(brief);
  const open = items
    .filter((item) => {
      const entry = stageAnswerOf(answer, item.stage.id);
      return entry !== undefined && !knownExecutor(item.stage, entry.executor);
    })
    .map((item) => stageRowId(item.stage.id));
  const strangers = (answer.stages ?? []).map((s) => s.id).filter((id) => !items.some((item) => item.stage.id === id));
  return [...open, ...strangers];
};

const sameChoice = (a: StageChoice, b: StageChoice): boolean => a.run === b.run && a.executor === b.executor;

/** Сделан ли этап; этап старого брифа, ждавший приёмки, тоже сделан. */
const finished = (item: StageItem): boolean => stagePhase(item) !== "todo";

/** Расходится ли выбор по несделанному этапу с рекомендацией: прогон или исполнитель. */
const stageDiffers = (brief: DecisionBrief, answer: DecisionAnswer, item: StageItem): boolean =>
  !finished(item) && !sameChoice(answeredStageChoice(brief, answer, item), recommendedStageChoice(item));

const choiceWords = (item: StageItem, choice: StageChoice, locale: Locale | undefined): string => {
  const m = messages(locale).answer;
  return choice.run ? m.inRun(executorLabel(item.stage, choice.executor, locale)) : m.notInRun;
};

/** Этап словами: сделан со ссылками или в прогон с исполнителем; расхождение с рекомендацией — в скобках. */
const stageWords = (brief: DecisionBrief, answer: DecisionAnswer, item: StageItem, locale: Locale | undefined): string => {
  const m = messages(locale).answer;
  const links = (item.report?.results ?? []).map((r) => r.label).join(", ");
  if (finished(item)) return m.stageDone(item.stage.name, links);
  const choice = answeredStageChoice(brief, answer, item);
  const recommended = recommendedStageChoice(item);
  return `${item.stage.name} — ${choiceWords(item, choice, locale)}${sameChoice(choice, recommended) ? "" : m.recommendedChoice(choiceWords(item, recommended, locale))}`;
};

/** Демонстрация агенту: исход, ссылки результатов и комментарий владельца. */
const outcomeLines = (brief: DecisionBrief, answer: DecisionAnswer, locale: Locale | undefined): string[] => {
  const outcome = brief.outcome;
  if (outcome === undefined) return [];
  const m = messages(locale).answer;
  const note = blank(answer.outcome?.note) ? "" : m.stageNote(answer.outcome?.note ?? "");
  const links = outcome.results.map((r) => r.label).join(", ");
  return [m.stagesHeader, `- ${m.demoVerdict(outcomeStageName(brief), demoVerdict(answer) ?? "rework", links)}${note}`];
};

const stagesLines = (brief: DecisionBrief, answer: DecisionAnswer, locale: Locale | undefined): string[] => {
  const items = stageItems(brief);
  return items.length === 0 ? [] : [messages(locale).answer.stagesHeader, ...items.map((item) => `- ${stageWords(brief, answer, item, locale)}`)];
};

/** Дальше после Демонстрации: продолжить — следующий этап или конец работы, с комментарием — учесть его; на доработку — переделать и показать снова, не идя дальше. */
const outcomeNextStep = (brief: DecisionBrief, answer: DecisionAnswer, m: Messages["answer"]): string => {
  const verdict = demoVerdict(answer);
  if (verdict !== "continue" && verdict !== "comment") return m.outcomeRedo(outcomeStageName(brief));
  const next = brief.outcome?.next;
  const step = next === undefined ? m.outcomeFinal : m.outcomeNext(next);
  return verdict === "comment" ? m.withComment(step) : step;
};

/** Дальше по этапам: прогон по порядку и остановки на Демонстрациях из прогона. */
const stagesNextStep = (brief: DecisionBrief, answer: DecisionAnswer, m: Messages["answer"]): string => {
  const run = stageItems(brief).filter((item) => !finished(item) && answeredStageChoice(brief, answer, item).run);
  const stops = run.filter((item) => stageKindOf(item.stage) === "demo").map((item) => item.stage.name);
  const plan = run.length === 0 ? m.noRun : m.run(run.map((item) => item.stage.name).join(", "));
  const halt = stops.length === 0 ? m.noStops : m.stops(stops.join(", "));
  return m.next(plan, halt);
};

/** Выбранное словами и рекомендованное словами; `null` у рекомендации — агент её не ставил. `carried` — владелец оставил перенесённое. */
type Reading = { chosen: string; recommended: string | null; differs: boolean; carried: boolean };

const actions = (question: DecisionQuestion, ids: readonly string[]): string =>
  question.options
    .filter((o) => ids.includes(o.id))
    .map((o) => o.action)
    .join(", ");

const read = (question: DecisionQuestion, entry: QuestionAnswer, carried: readonly string[] | undefined, m: Messages["answer"]): Reading => {
  const recommendedIds = question.options.filter((o) => o.recommended).map((o) => o.id);
  const own = blank(entry.own) ? null : (entry.own ?? "");
  const parts = [...(entry.optionIds.length === 0 ? [] : [actions(question, entry.optionIds)]), ...(own === null ? [] : [m.own(own)])];
  const sameSet =
    own === null &&
    entry.optionIds.length === recommendedIds.length &&
    entry.optionIds.every((id) => recommendedIds.includes(id));
  return {
    chosen: parts.length === 0 ? m.nothing : parts.join(", "),
    recommended: recommendedIds.length === 0 ? null : actions(question, recommendedIds),
    differs: recommendedIds.length > 0 && !sameSet,
    carried:
      carried !== undefined &&
      (entry.picked ?? []).length === 0 &&
      carried.length === entry.optionIds.length &&
      carried.every((id) => entry.optionIds.includes(id)),
  };
};

const readings = (brief: DecisionBrief, answer: DecisionAnswer, locale?: Locale) => {
  const carried = carriedFor(brief);
  const hidden = hiddenQuestions(brief, answer);
  const m = messages(locale).answer;
  return rowsOf(brief, locale).filter((question) => !hidden.has(question.id)).map((question) => {
    const entry = entryFor(answer, question.id);
    return { question, reading: entry === undefined ? null : read(question, entry, carried[question.id], m) };
  });
};

/** Знаменатель расхождений: строки брифа и кнопка бюджета, если у брифа есть прогноз — своя цена тоже расхождение. */
export const deviationTotal = (brief: DecisionBrief): number => rowsOf(brief).length + stageItems(brief).length + (hasForecast(brief) ? 1 : 0);

export const deviations = (brief: DecisionBrief, answer: DecisionAnswer): number =>
  readings(brief, answer).filter(({ reading }) => reading?.differs === true).length +
  stageItems(brief).filter((item) => stageDiffers(brief, answer, item)).length +
  (hasOwnBudget(answer) ? 1 : 0);

/** Реплика ответа агенту на языке интерфейса владельца; без языка — русская, как ответы до выбора языка. */
export const answerMessageText = (brief: DecisionBrief, answer: DecisionAnswer, locale?: Locale): string => {
  const m = messages(locale).answer;
  const heading = m.heading(brief.kind === "clarify", brief.title);
  const body = readings(brief, answer, locale).map(({ question, reading }, i) => {
    const head = `${i + 1}. ${question.question} — `;
    if (reading === null) return `${head}${m.noAnswer}`;
    const deviation = reading.carried ? m.carried : reading.differs ? m.differs(reading.recommended ?? "", reading.chosen) : "";
    return `${head}${reading.chosen}${deviation}${question.id === SETUP_ROW.artifacts ? revokedLine(brief, answer, m) : ""}`;
  });
  const note = blank(answer.note) ? [] : [m.note(answer.note ?? "")];
  return [heading, ...body, ...outcomeLines(brief, answer, locale), ...stagesLines(brief, answer, locale), ...budgetLine(brief, answer, locale), ...criteriaLine(brief, answer, m), ...nextStepLine(brief, answer, m), ...note].join("\n");
};

/** Ответ на бриф — согласие на всю работу: агент идёт до конца и останавливается только на утверждениях, обязательных по настройкам. */
const nextStepLine = (brief: DecisionBrief, answer: DecisionAnswer, m: Messages["answer"]): string[] => {
  if (brief.kind !== "brief") return [];
  if (isOutcomeBrief(brief)) return [outcomeNextStep(brief, answer, m)];
  if (stageItems(brief).length > 0) return [stagesNextStep(brief, answer, m)];
  const kept = entryFor(answer, SETUP_ROW.artifacts)?.optionIds ?? [];
  const approve = brief.required?.approve ?? [];
  const stops = (brief.setup?.artifacts ?? [])
    .filter((a) => (a.state === "missing" || a.state === "stale") && kept.includes(a.id) && approve.includes(a.id))
    .map((a) => a.name);
  const approvals = stops.length === 0 ? m.noApprovals : m.approvals(stops.join(", "));
  return [m.legacyNext(approvals)];
};

/** Утверждённые артефакты со снятой галочкой — агенту словами, а не только расхождением. */
const revokedLine = (brief: DecisionBrief, answer: DecisionAnswer, m: Messages["answer"]): string => {
  const kept = entryFor(answer, SETUP_ROW.artifacts)?.optionIds ?? [];
  if (brief.revocable !== true) return "";
  const revoked = (brief.setup?.artifacts ?? []).filter((a) => a.state === "approved" && !kept.includes(a.id)).map((a) => a.name);
  return revoked.length === 0 ? "" : m.revoked(revoked.join(", "));
};

/** Строка о критерии: каждая правка названа номером пункта и текстом, чтобы агент не сверял номера с брифом; пункты выбранных вариантов — текстом. */
const criteriaLine = (brief: DecisionBrief, answer: DecisionAnswer, m: Messages["answer"]): string[] => {
  const fromOptions = optionCriteria(brief, answer).map((c) => c.text);
  const optionPart = fromOptions.length === 0 ? [] : [m.optionItems(fromOptions.map(m.optionItem).join(", "))];
  const items = brief.setup?.criteria;
  if (items === undefined) return optionPart.length === 0 ? [] : [m.criteria(optionPart.join(""))];
  const criteria = answer.criteria ?? NO_EDITS;
  const changes = [
    ...removedCriteria(brief, answer).map((i) => m.removedItem(i + 1, items[i] === undefined ? "" : criterionTitle(items[i]))),
    ...criteria.edited.map((e) => {
      const change = items[e.index] === undefined ? undefined : changeOf(items[e.index]!);
      return change !== undefined ? m.rewroteChange(e.index + 1, change.text, e.text) : m.rewrote(e.index + 1, e.text);
    }),
    ...criteria.added.map((text) => m.addedItem(text)),
  ];
  return [m.criteria([changes.length === 0 ? m.noEdits(items.length) : changes.join("; "), ...optionPart].join("; "))];
};
