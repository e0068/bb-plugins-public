// Черновик ответа на бриф — чистые функции без React. Запись в `entries`
// появляется при первом касании вопроса: у переключателей «ничего не включать»
// отличимо от «не дошёл» только так. Правки критерия лежат отдельно: пункты —
// не вопрос, нетронутый критерий значит «все пункты оставлены».
import { isQuestionAnswered, openQuestions } from "../core/answer-message";
import { requiredOf } from "../core/required";
import { REVIEW_NONE, REVIEW_ROWS, SETUP_ROW, checkerAllowed, rowsOf } from "../core/rows";
import { criterionEditable } from "../core/budget";
import { carriedFor } from "../core/carry";
import { initialStageChoice, stageItems, type StageChoice, type StageItem } from "../core/stages";
import { withPlace } from "../core/places";
import { hiddenQuestions } from "../core/visibility";
import type { Criterion, DecisionAnswer, DecisionBrief, DecisionQuestion, DispatchPlace, DispatchRoute, StageAnswer } from "../shared/contract";

/** `picked` — варианты, которых владелец коснулся сам, а не поставила рекомендация: виджет рисует их контрастными. */
type Entry = { optionIds: readonly string[]; own: string; picked?: readonly string[] };

/** Номера пунктов брифа считаются с нуля; `added` — пункты владельца, пустые в ответ не уходят. */
export type CriteriaDraft = { removed: readonly number[]; edited: Readonly<Record<number, string>>; added: readonly string[] };

/**
 * Выбор по этапу: заданы только поля, которых владелец коснулся, остальное — выбор по умолчанию.
 */
export type StageDraft = { run?: boolean; executor?: string };

/** `budget` — своя цена владельца; пустые цель и потолок значат «прогноз». `place` — где исполнять работу. */
export type Draft = {
  entries: Readonly<Record<string, Entry>>;
  note: string;
  criteria: CriteriaDraft;
  budget: { target: string; max: string };
  stages: Readonly<Record<string, StageDraft>>;
  place?: DispatchPlace;
  /** Дерево и ветка нового треда — выбор владельца поверх последнего в проекте. */
  route?: DispatchRoute;
  /** Сперва компактировать тред — только при «в этом треде»; каждый бриф открывается без неё. */
  compact?: boolean;
  /** Комментарий к Демонстрации; пустой — «Продолжить», написанный — «Отправить». */
  outcomeNote?: string;
};

export const emptyCriteria = (): CriteriaDraft => ({ removed: [], edited: {}, added: [] });

export const emptyBudget = (): Draft["budget"] => ({ target: "", max: "" });

export const emptyDraft = (): Draft => ({ entries: {}, note: "", criteria: emptyCriteria(), budget: emptyBudget(), stages: {} });

// ——— этапы ———

const withStage = (draft: Draft, stageId: string, patch: StageDraft): Draft => ({
  ...draft,
  stages: { ...draft.stages, [stageId]: { ...draft.stages[stageId], ...patch } },
});

/** Выбор по этапу в черновике: касания владельца поверх выбора по умолчанию. */
export const stageChoiceIn = (brief: DecisionBrief, draft: Draft, item: StageItem): StageChoice => {
  const initial = initialStageChoice(brief, item);
  const own = draft.stages[item.stage.id] ?? {};
  return { run: own.run ?? initial.run, executor: own.executor ?? initial.executor };
};

export const toggleStageRun = (brief: DecisionBrief, draft: Draft, item: StageItem): Draft => withStage(draft, item.stage.id, { run: !stageChoiceIn(brief, draft, item).run });

export const pickStageExecutor = (draft: Draft, item: StageItem, executor: string): Draft => withStage(draft, item.stage.id, { executor });

/** Место исполнения — выбор владельца поверх последнего выбора в проекте; решать вопросы для этого не нужно. */
export const setPlace = (draft: Draft, place: DispatchPlace): Draft => ({ ...draft, place });

export const placeIn = (draft: Draft, fallback: DispatchPlace): DispatchPlace => draft.place ?? fallback;

export const setRoute = (draft: Draft, route: DispatchRoute): Draft => ({ ...draft, route });

export const routeIn = (draft: Draft, fallback: DispatchRoute): DispatchRoute => draft.route ?? fallback;

export const setCompact = (draft: Draft, compact: boolean): Draft => ({ ...draft, compact });

/**
 * Место и маршрут на отправку: маршрут едет только с новым тредом — в этом треде
 * дерева и ветки не выбирают, а компактация — только с этим тредом. Место живёт в
 * черновике, а маршрут может прийти из памяти проекта, поэтому пара сводится
 * `withPlace`: уезжает ровно то, что показано.
 */
export const settleDispatch = (draft: Draft, place: DispatchPlace, route: DispatchRoute): Draft => {
  const { route: _route, compact, ...rest } = draft;
  const settled = placeIn(draft, place);
  return settled === "here"
    ? { ...rest, place: settled, ...(compact === true ? { compact } : {}) }
    : { ...rest, place: settled, route: withPlace(routeIn(draft, route), settled) };
};

export const setOutcomeNote = (draft: Draft, note: string): Draft => ({ ...draft, outcomeNote: note });

const stageAnswers = (brief: DecisionBrief, draft: Draft): StageAnswer[] =>
  stageItems(brief).map((item) => {
    const own = draft.stages[item.stage.id] ?? {};
    const choice = stageChoiceIn(brief, draft, item);
    const picked = (["run", "executor"] as const).filter((key) => own[key] !== undefined);
    return { id: item.stage.id, ...choice, ...(picked.length === 0 ? {} : { picked: [...picked] }) };
  });

/** Строки первой части, где рекомендация агента уже выбрана при первом открытии. */
const PRESELECTED: readonly string[] = [SETUP_ROW.artifacts, SETUP_ROW.executor, ...REVIEW_ROWS];

const withEntry = (draft: Draft, questionId: string, entry: Entry): Draft => ({
  ...draft,
  entries: { ...draft.entries, [questionId]: entry },
});

const isMulti = (question: DecisionQuestion): boolean => question.kind === "toggles" || question.kind === "pick";

/** Свой текст, который переживает правку вариантов: в `pick` он складывается с ними. */
const keptOwn = (draft: Draft, question: DecisionQuestion): string =>
  question.kind === "pick" ? (draft.entries[question.id]?.own ?? "") : "";

/**
 * Смена исполнителя не оставляет ревью и тестирование, которые при нём выбрать нельзя: строка
 * возвращается к рекомендации агента, а если и она недопустима — к базе «Нет». Это не выбор владельца.
 */
const fitReviews = (draft: Draft, brief: DecisionBrief | undefined): Draft => {
  const rows = brief === undefined ? [] : rowsOf(brief).filter((q) => REVIEW_ROWS.includes(q.id));
  const executorIds = draft.entries[SETUP_ROW.executor]?.optionIds;
  return rows.reduce((next, row) => {
    const current = next.entries[row.id]?.optionIds ?? [];
    if (current.every((id) => checkerAllowed(executorIds, id))) return next;
    const recommended = row.options.find((o) => o.recommended && checkerAllowed(executorIds, o.id))?.id ?? REVIEW_NONE;
    return withEntry(next, row.id, { optionIds: [recommended], own: "" });
  }, draft);
};

const pickedOf = (draft: Draft, rowId: string): readonly string[] => {
  const picked = draft.entries[rowId]?.picked;
  return Array.isArray(picked) ? picked : [];
};

/**
 * Метку несут только ячейки нижнего блока, где рекомендация стоит заранее: в остальных строках выбор и так виден.
 * В строке с одним ответом тронутый вариант один, у артефактов копятся все, которых касался владелец.
 */
const pickedMark = (draft: Draft, question: DecisionQuestion, optionId: string): { picked?: readonly string[] } => {
  if (!PRESELECTED.includes(question.id)) return {};
  const before = isMulti(question) ? pickedOf(draft, question.id).filter((id) => id !== optionId) : [];
  return { picked: [...before, optionId] };
};

/** Выбрал ли владелец значение строки сам; с `optionId` — касался ли он этого варианта. */
export const isPicked = (draft: Draft, rowId: string, optionId?: string): boolean => {
  const picked = pickedOf(draft, rowId);
  return optionId === undefined ? picked.length > 0 : picked.includes(optionId);
};

/** `brief` нужен строке исполнителя: без него смена исполнителя не поправит ревью и тестирование. */
export const pickOption = (draft: Draft, question: DecisionQuestion, optionId: string, brief?: DecisionBrief): Draft => {
  if (!question.options.some((o) => o.id === optionId)) return draft;
  if (question.id === SETUP_ROW.executor) return fitReviews(withEntry(draft, question.id, { optionIds: [optionId], own: "", ...pickedMark(draft, question, optionId) }), brief);
  if (!isMulti(question)) return withEntry(draft, question.id, { optionIds: [optionId], own: "", ...pickedMark(draft, question, optionId) });
  const current = draft.entries[question.id]?.optionIds ?? [];
  const next = current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId];
  // Порядок включённых — порядок брифа, а не порядок нажатий.
  const ordered = question.options.map((o) => o.id).filter((id) => next.includes(id));
  return withEntry(draft, question.id, { optionIds: ordered, own: keptOwn(draft, question), ...pickedMark(draft, question, optionId) });
};

export const setOwn = (draft: Draft, question: DecisionQuestion, text: string): Draft => {
  if (question.kind === "toggles") return draft;
  const current = draft.entries[question.id];
  const optionIds = text.trim() === "" || question.kind === "pick" ? (current?.optionIds ?? []) : [];
  return withEntry(draft, question.id, { optionIds, own: text });
};

export const setNote = (draft: Draft, text: string): Draft => ({ ...draft, note: text });

export const setOwnBudget = (draft: Draft, field: "target" | "max", text: string): Draft => ({ ...draft, budget: { ...draft.budget, [field]: text } });

const withCriteria = (draft: Draft, patch: Partial<CriteriaDraft>): Draft => ({ ...draft, criteria: { ...draft.criteria, ...patch } });

/** Крест снимает пункт, «Вернуть» — повторный вызов — возвращает его с прежней правкой. */
export const toggleCriterion = (draft: Draft, index: number): Draft => {
  const { removed } = draft.criteria;
  const next = removed.includes(index) ? removed.filter((i) => i !== index) : [...removed, index];
  return withCriteria(draft, { removed: [...next].sort((a, b) => a - b) });
};

export const editCriterion = (draft: Draft, index: number, text: string): Draft =>
  withCriteria(draft, { edited: { ...draft.criteria.edited, [index]: text } });

/** Запись в позицию за концом списка дописывает пункт: так поле «Добавить пункт» становится пунктом. */
export const setAddedCriterion = (draft: Draft, position: number, text: string): Draft => {
  const { added } = draft.criteria;
  const next = position >= added.length ? [...added, text] : added.map((t, i) => (i === position ? text : t));
  // Стёртый последний пункт снова становится полем «Добавить пункт», а не пустой строкой над ним.
  return withCriteria(draft, { added: next.at(-1) === "" ? next.slice(0, -1) : next });
};

export const removeAddedCriterion = (draft: Draft, position: number): Draft =>
  withCriteria(draft, { added: draft.criteria.added.filter((_, i) => i !== position) });

/**
 * Проставляет рекомендованное поверх черновика. Вопросы без рекомендации и
 * общий текст остаются как были; `toggles` без рекомендованных получает
 * пустую запись, только если его ещё не касались, — «ничего не включать».
 * Своя цена снимается: бюджет возвращается к прогнозу, как и остальные ячейки блока — к рекомендации.
 */
export const acceptRecommendations = (brief: DecisionBrief, draft: Draft = emptyDraft()): Draft =>
  rowsOf(brief).reduce((next, question) => {
    const recommended = question.options.filter((o) => o.recommended).map((o) => o.id);
    const untouchedMulti = isMulti(question) && next.entries[question.id] === undefined;
    return recommended.length > 0 || untouchedMulti
      ? withEntry(next, question.id, { optionIds: recommended, own: keptOwn(next, question) })
      : next;
  }, { ...draft, budget: emptyBudget(), stages: {} });

/** Черновик нового брифа при первом открытии: кнопки первой части стоят на рекомендации, остальное не решено. */
export const initialDraft = (brief: DecisionBrief): Draft => {
  // Галочку у обязательного документа ставит владелец сам; утверждённый остаётся отмеченным.
  const ownTick = requiredOf(brief).filter((a) => a.state !== "approved").map((a) => a.id);
  // Выбор владельца из прошлого брифа треда встаёт вместо рекомендации — без метки: это значение по умолчанию.
  const carried = carriedFor(brief);
  return rowsOf(brief)
    .filter((q) => PRESELECTED.includes(q.id))
    .reduce((next, q) => {
      const recommended = carried[q.id] ?? q.options.filter((o) => o.recommended && !(q.id === SETUP_ROW.artifacts && ownTick.includes(o.id))).map((o) => o.id);
      return recommended.length > 0 || q.kind === "toggles" ? withEntry(next, q.id, { optionIds: [...recommended], own: "" }) : next;
    }, emptyDraft());
};

export const toAnswer = (brief: DecisionBrief, draft: Draft): DecisionAnswer => {
  const hidden = hiddenIn(brief, draft);
  const answers = rowsOf(brief).filter((question) => !hidden.has(question.id)).flatMap((question) => {
    // Артефакты не обязательны: нетронутая строка — «ничего не делать», а не «не дошёл».
    const entry = draft.entries[question.id] ?? (question.id === SETUP_ROW.artifacts ? { optionIds: [], own: "" } : undefined);
    if (entry === undefined) return [];
    const own = entry.own.trim() === "" ? {} : { own: entry.own };
    const picked = pickedOf(draft, question.id);
    return [{ questionId: question.id, optionIds: [...entry.optionIds], ...own, ...(picked.length === 0 ? {} : { picked: [...picked] }) }];
  });
  const items = brief.setup?.criteria;
  const { target, max } = draft.budget;
  const own = target.trim() === "" && max.trim() === "" ? {} : { budget: { ...(target.trim() === "" ? {} : { target }), ...(max.trim() === "" ? {} : { max }) } };
  return {
    briefId: brief.id,
    answers,
    ...(stageItems(brief).length === 0 ? {} : { stages: stageAnswers(brief, draft) }),
    ...(items === undefined ? {} : { criteria: criteriaAnswer(items, draft.criteria) }),
    ...own,
    ...(draft.note.trim() === "" ? {} : { note: draft.note }),
    ...(draft.place === undefined ? {} : { place: draft.place }),
    ...(draft.route === undefined ? {} : { route: draft.route }),
    ...(draft.compact === true ? { compact: true } : {}),
    // Пустой комментарий — «Продолжить»; написанный — «Отправить»: Демонстрация не принята, flow дальше не идёт.
    ...(brief.outcome === undefined ? {} : { outcome: (draft.outcomeNote ?? "").trim() === "" ? { accepted: true } : { accepted: false, note: draft.outcomeNote ?? "" } }),
  };
};

const criteriaAnswer = (items: readonly Criterion[], criteria: CriteriaDraft): NonNullable<DecisionAnswer["criteria"]> => {
  const removed = criteria.removed.filter((i) => i < items.length);
  const edited = items.flatMap((item, index) => {
    const original = criterionEditable(item);
    const text = criteria.edited[index];
    return text === undefined || text === original || text.trim() === "" || removed.includes(index) ? [] : [{ index, text }];
  });
  return { removed, edited, added: criteria.added.filter((t) => t.trim() !== "") };
};

/** Вопросы, снятые выбором в черновике, — тем же расчётом, что у сервера и реплики. */
export const hiddenIn = (brief: DecisionBrief, draft: Draft): ReadonlySet<string> =>
  hiddenQuestions(brief, { answers: Object.entries(draft.entries).map(([questionId, e]) => ({ questionId, optionIds: [...e.optionIds] })) });

export const decidedCount = (brief: DecisionBrief, draft: Draft): { decided: number; total: number } => {
  const hidden = hiddenIn(brief, draft);
  const total = rowsOf(brief).filter((q) => q.kind !== "yesno" && !hidden.has(q.id)).length;
  return { decided: total - openQuestions(brief, toAnswer(brief, draft)).length, total };
};

/** Решён ли отдельный вопрос в черновике — для подсветки строки. */
export const isDecided = (question: DecisionQuestion, draft: Draft): boolean => {
  const entry = draft.entries[question.id];
  return isQuestionAnswered(
    question,
    entry && { questionId: question.id, optionIds: [...entry.optionIds], own: entry.own },
  );
};

/** Черновик из записанного ответа — чтобы отвеченный бриф рисовался теми же частями. */
export const fromAnswer = (answer: DecisionAnswer): Draft => ({
  entries: Object.fromEntries(answer.answers.map((a) => [a.questionId, { optionIds: a.optionIds, own: a.own ?? "", ...(a.picked === undefined ? {} : { picked: a.picked }) }])),
  note: answer.note ?? "",
  budget: { target: answer.budget?.target ?? "", max: answer.budget?.max ?? "" },
  stages: Object.fromEntries(
    (answer.stages ?? []).map((s) => [
      s.id,
      {
        ...(s.picked?.includes("run") ? { run: s.run } : {}),
        ...(s.picked?.includes("executor") ? { executor: s.executor } : {}),
      },
    ]),
  ),
  criteria: {
    removed: answer.criteria?.removed ?? [],
    edited: Object.fromEntries((answer.criteria?.edited ?? []).map((e) => [e.index, e.text])),
    added: answer.criteria?.added ?? [],
  },
});
