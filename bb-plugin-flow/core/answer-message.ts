// Что значит ответ на бриф: закрыт ли вопрос, сколько расхождений с
// рекомендацией и какой репликой ответ уходит агенту. Нужно и бэкенду, и
// виджету, поэтому из контракта берутся только типы.
import type { Locale } from "../lib/i18n";
import { messages, type Messages } from "../lib/messages";
import type { CriteriaAnswer, DecisionAnswer, DecisionBrief, DecisionQuestion, QuestionAnswer } from "../shared/contract";
import { budgetLine, changeOf, criterionTitle, hasForecast, hasOwnBudget } from "./budget";
import { carriedFor } from "./carry";
import { optionCriteria, removedCriteria, type OptionCriterion } from "./option-criteria";
import { OUTCOME_ROW, demoVerdict, isOutcomeBrief, outcomeAnswered, outcomeStageName, stageNameOf, type DemoVerdict } from "./outcome";
import { requiredOf } from "./required";
import { REVIEW_ROWS, SETUP_ROW, checkerAllowed, rowsOf } from "./rows";
import { hiddenQuestions } from "./visibility";
import {
  SELF,
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

/** Этап строки прогона: исполнитель назван, только когда этап исполняет не сам агент — у автоматизации его нет. */
const runWords = (brief: DecisionBrief, answer: DecisionAnswer, item: StageItem, m: Messages["answer"], locale: Locale | undefined): string => {
  const executor = answeredStageChoice(brief, answer, item).executor;
  return executor === SELF ? item.stage.name : m.runStage(item.stage.name, executorLabel(item.stage, executor, locale));
};

/** Расхождение по несделанному этапу словами: снят, добавлен или другой исполнитель; этап вне прогона с обеих сторон молчит. */
const offWords = (brief: DecisionBrief, answer: DecisionAnswer, item: StageItem, m: Messages["answer"], locale: Locale | undefined): string[] => {
  const chosen = answeredStageChoice(brief, answer, item);
  const recommended = recommendedStageChoice(item);
  const name = item.stage.name;
  if (recommended.run && !chosen.run) return [m.dropped(name)];
  if (chosen.run && !recommended.run) return [m.added(name)];
  if (!chosen.run) return [];
  return [m.swapped(name, executorLabel(item.stage, chosen.executor, locale), executorLabel(item.stage, recommended.executor, locale))];
};

/**
 * Этапы агенту — строка прогона по порядку и строка расхождений с рекомендацией. Сделанные этапы агент прислал сам,
 * а правила — остановка на Демонстрации, «сам» без субагентов, один бриф на прогон — живут в инструкциях инструмента.
 */
const stagesLines = (brief: DecisionBrief, answer: DecisionAnswer, locale: Locale | undefined): string[] => {
  const items = stageItems(brief);
  if (items.length === 0) return [];
  const m = messages(locale).answer;
  const run = items.filter((item) => !finished(item) && answeredStageChoice(brief, answer, item).run);
  const off = items.filter((item) => stageDiffers(brief, answer, item)).flatMap((item) => offWords(brief, answer, item, m, locale));
  return [
    run.length === 0 ? m.noRun : m.run(run.map((item) => runWords(brief, answer, item, m, locale)).join(" → ")),
    ...(off.length === 0 ? [] : [m.offRecommendation(off.join("; "))]),
  ];
};

/** Комментарий владельца к Демонстрации — строкой под заголовком. */
const outcomeLines = (brief: DecisionBrief, answer: DecisionAnswer, locale: Locale | undefined): string[] =>
  !isOutcomeBrief(brief) || blank(answer.outcome?.note) ? [] : [messages(locale).answer.outcomeNote(answer.outcome?.note ?? "")];

/**
 * Дальше после Демонстрации: продолжить — следующий этап или конец работы; комментарий — ответить и прислать её снова;
 * переход — начать выбранный flow с первого этапа.
 */
const outcomeNextStep = (brief: DecisionBrief, answer: DecisionAnswer, m: Messages["answer"]): string => {
  const flow = answer.outcome?.flow;
  if (flow !== undefined) return m.outcomeSwitch(flow.name);
  if (demoVerdict(answer) !== "continue") return m.outcomeComment;
  const next = brief.outcome?.next;
  return next === undefined ? m.outcomeFinal : m.outcomeNext(stageNameOf(brief, next));
};

/** Заголовок реплики на Демонстрацию — по её исходу. */
const outcomeHeading = (brief: DecisionBrief, answer: DecisionAnswer, verdict: DemoVerdict, m: Messages["answer"]): string => {
  switch (verdict) {
    case "switch":
      return m.outcomeSwitchHeading(brief.title, answer.outcome?.flow?.name ?? "");
    case "comment":
    case "continue":
      return m.outcomeHeading(brief.title, verdict === "comment", outcomeStageName(brief));
  }
};

/**
 * Выбранное словами, расхождение с рекомендацией скобкой (пустая — расхождения нет) и свой текст владельца отдельно:
 * он встаёт цитатой под пунктом, а не в строку. `carried` — владелец оставил перенесённое.
 */
type Reading = { chosen: string; deviation: string; own: string | null; carried: boolean };

/** Вопрос с несколькими ответами: свой текст складывается с выбранными, а расхождение — разница наборов. */
export const isMulti = (question: DecisionQuestion): boolean => question.kind === "toggles" || question.kind === "pick";

/** «Yes» и «No» подтверждения агент пишет по-английски; владельцу и журналу — словом языка ответа. */
const optionWord = (question: DecisionQuestion, action: string, m: Messages["answer"]): string => {
  if (question.kind !== "confirm" && question.kind !== "yesno") return action;
  if (/^yes$/i.test(action)) return m.yes;
  return /^no$/i.test(action) ? m.no : action;
};

const actions = (question: DecisionQuestion, ids: readonly string[], m: Messages["answer"]): string =>
  question.options
    .filter((o) => ids.includes(o.id))
    .map((o) => optionWord(question, o.action, m))
    .join(", ");

/** Разница наборов словами: не взятое из рекомендованного и взятое сверх него; наборы совпали — пусто. */
const setDeviation = (question: DecisionQuestion, chosen: readonly string[], recommended: readonly string[], m: Messages["answer"]): string => {
  const missing = recommended.filter((id) => !chosen.includes(id));
  const extra = chosen.filter((id) => !recommended.includes(id));
  const parts = [...(missing.length === 0 ? [] : [m.notTaken(actions(question, missing, m))]), ...(extra.length === 0 ? [] : [m.beyond(actions(question, extra, m))])];
  return parts.length === 0 ? "" : m.setDiff(parts.join("; "));
};

/** Одиночный выбор расходится, когда взят не рекомендованный вариант или вместо варианта написано своё. */
const singleDeviation = (question: DecisionQuestion, entry: QuestionAnswer, own: string | null, recommended: readonly string[], m: Messages["answer"]): string => {
  const same = own === null && entry.optionIds.length === recommended.length && entry.optionIds.every((id) => recommended.includes(id));
  return same ? "" : m.recommended(actions(question, recommended, m));
};

const read = (question: DecisionQuestion, entry: QuestionAnswer, carried: readonly string[] | undefined, m: Messages["answer"]): Reading => {
  const recommendedIds = question.options.filter((o) => o.recommended).map((o) => o.id);
  const own = blank(entry.own) ? null : (entry.own ?? "");
  const deviation =
    recommendedIds.length === 0
      ? ""
      : isMulti(question)
        ? setDeviation(question, entry.optionIds, recommendedIds, m)
        : singleDeviation(question, entry, own, recommendedIds, m);
  return {
    chosen: entry.optionIds.length > 0 ? actions(question, entry.optionIds, m) : own === null ? m.nothing : m.own,
    deviation,
    own,
    carried:
      carried !== undefined &&
      (entry.picked ?? []).length === 0 &&
      carried.length === entry.optionIds.length &&
      carried.every((id) => entry.optionIds.includes(id)),
  };
};

/**
 * Свой текст цитатой с отступом под текст пункта «N. », чтобы многоабзацный остался внутри пункта списка;
 * пустая строка после цитаты не даёт следующему пункту приклеиться к ней ленивым продолжением.
 */
const ownQuote = (number: number, own: string): string => {
  const indent = " ".repeat(`${number}. `.length);
  return `${own.split("\n").map((line) => (line.trim() === "" ? `${indent}>` : `${indent}> ${line}`)).join("\n")}\n`;
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
  readings(brief, answer).filter(({ reading }) => reading !== null && reading.deviation !== "").length +
  stageItems(brief).filter((item) => stageDiffers(brief, answer, item)).length +
  (hasOwnBudget(answer) ? 1 : 0);

/** Реплика ответа агенту на языке интерфейса владельца; без языка — русская, как ответы до выбора языка. */
export const answerMessageText = (brief: DecisionBrief, answer: DecisionAnswer, locale?: Locale): string => {
  const m = messages(locale).answer;
  const verdict = isOutcomeBrief(brief) ? demoVerdict(answer) : null;
  const heading = verdict === null ? m.heading(brief.kind === "clarify", brief.title) : outcomeHeading(brief, answer, verdict, m);
  const body = readings(brief, answer, locale).map(({ question, reading }, i) => {
    const head = `${i + 1}. ${question.question} — `;
    if (reading === null) return `${head}${m.noAnswer}`;
    const line = `${head}${reading.chosen}${reading.carried ? m.carried : reading.deviation}${question.id === SETUP_ROW.artifacts ? revokedLine(brief, answer, m) : ""}`;
    return reading.own === null ? line : `${line}\n${ownQuote(i + 1, reading.own)}`;
  });
  const note = blank(answer.note) ? [] : [m.note(answer.note ?? "")];
  return [heading, ...body, ...outcomeLines(brief, answer, locale), ...stagesLines(brief, answer, locale), ...budgetLine(brief, answer, locale), ...criteriaLine(brief, answer, m), ...nextStepLine(brief, answer, m), ...note].join("\n");
};

/** Шаг агента после ответа: после Демонстрации — следующий, у брифа без этапов — только остановки на утверждение. */
const nextStepLine = (brief: DecisionBrief, answer: DecisionAnswer, m: Messages["answer"]): string[] => {
  if (brief.kind !== "brief") return [];
  if (isOutcomeBrief(brief)) return [outcomeNextStep(brief, answer, m)];
  if (stageItems(brief).length > 0) return [];
  const kept = entryFor(answer, SETUP_ROW.artifacts)?.optionIds ?? [];
  const approve = brief.required?.approve ?? [];
  const stops = (brief.setup?.artifacts ?? [])
    .filter((a) => (a.state === "missing" || a.state === "stale") && kept.includes(a.id) && approve.includes(a.id))
    .map((a) => a.name);
  return stops.length === 0 ? [] : [m.approvals(stops.join(", "))];
};

/** Утверждённые артефакты со снятой галочкой — агенту словами, а не только расхождением. */
const revokedLine = (brief: DecisionBrief, answer: DecisionAnswer, m: Messages["answer"]): string => {
  const kept = entryFor(answer, SETUP_ROW.artifacts)?.optionIds ?? [];
  if (brief.revocable !== true) return "";
  const revoked = (brief.setup?.artifacts ?? []).filter((a) => a.state === "approved" && !kept.includes(a.id)).map((a) => a.name);
  return revoked.length === 0 ? "" : m.revoked(revoked.join(", "));
};

/**
 * Строка о критерии: каждая правка названа номером пункта и текстом, чтобы агент не сверял номера
 * с брифом; пункты выбранных вариантов — текстом, снятые владельцем — отдельным перечнем, иначе
 * отказ читался бы как отсутствие пункта и агент предложил бы его заново.
 */
const criteriaLine = (brief: DecisionBrief, answer: DecisionAnswer, m: Messages["answer"]): string[] => {
  const fromOptions = optionCriteria(brief, answer);
  const listOf = (state: OptionCriterion["state"]) => fromOptions.filter((c) => c.state === state).map((c) => m.optionItem(c.text));
  const live = listOf("live");
  const dropped = listOf("struck");
  const optionPart = [
    ...(live.length === 0 ? [] : [m.optionItems(live.join(", "))]),
    ...(dropped.length === 0 ? [] : [m.droppedOptionItems(dropped.join(", "))]),
  ];
  const items = brief.setup?.criteria;
  if (items === undefined) return optionPart.length === 0 ? [] : [m.criteria(optionPart.join("; "))];
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
