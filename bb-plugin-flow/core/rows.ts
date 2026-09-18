// Строки брифа, на которые отвечает владелец: первая часть (setup) разворачивается
// в строки с зарезервированными идентификаторами, за ними идут вопросы. Ответ,
// счётчик и реплика агенту считают по строкам и не различают, откуда строка.
import type { Locale } from "../lib/i18n";
import { messages, type Messages } from "../lib/messages";
import type { Add, Artifact, BriefSetup, Checker, DecisionBrief, DecisionQuestion, Executor, Scale } from "../shared/contract";

/** Идентификаторы строк первой части; префикс совпадает с `SETUP_ID_PREFIX` контракта. */
export const SETUP_ROW = {
  artifacts: "setup.artifacts",
  budgetTarget: "setup.budget-target",
  budgetMax: "setup.budget-max",
  executor: "setup.executor",
  /** Ревью; идентификатор остался от «проверяющего», чтобы записанные ответы читались. */
  checker: "setup.checker",
  testing: "setup.testing",
  /** Не строка ответа: так помечается ответ, чьи правки критерия не ложатся на пункты брифа. */
  criteria: "setup.criteria",
} as const;

export const artifactVerb = (artifact: Artifact, locale?: Locale): string => {
  const m = messages(locale).rows;
  return artifact.state === "approved" ? m.keepApproved : artifact.state === "ready" ? m.approve : m.make;
};

// В брифе с отзывом утверждений утверждённый артефакт входит в строку отмеченным: снятая галочка — «отозвать
// утверждение». В брифе, записанном раньше, утверждённых в строке нет, иначе старые ответы читались бы как отзыв.
const artifactsRow = (all: readonly Artifact[], revocable: boolean, locale?: Locale): DecisionQuestion[] => {
  const artifacts = revocable ? all : all.filter((a) => a.state !== "approved");
  return artifacts.length === 0
    ? []
    : [
        {
          id: SETUP_ROW.artifacts,
          question: messages(locale).brief.artifacts,
          kind: "toggles",
          allowOwn: false,
          options: artifacts.map((a) => ({
            id: a.id,
            action: `${a.name} — ${artifactVerb(a, locale).toLowerCase()}`,
            recommended: a.state === "approved" || a.recommended,
            ...(a.add === undefined ? {} : { add: a.add }),
          })),
        },
      ];
};

const EXECUTORS: ReadonlyArray<[Executor["recommended"], keyof Messages["rows"]]> = [
  ["self", "self"],
  ["subagents", "subagents"],
  ["workflow", "workflow"],
  ["fanout", "fanout"],
];

/** Строки, чей шаг workflow зависит от исполнителя: ревью и тестирование. */
export const REVIEW_ROWS: readonly string[] = [SETUP_ROW.checker, SETUP_ROW.testing];

/** База ревью и тестирования: никто. Добавки остальных вариантов — разница с ней. */
export const REVIEW_NONE = "none";

/** Исполнители, при которых ревью и тестирование могут быть шагом того же workflow. */
export const WORKFLOW_EXECUTORS: readonly string[] = ["workflow", "fanout"];

export const CHECKER_WORKFLOW = "workflow";

/** Можно ли выбрать это ревью или тестирование при таком выборе исполнителя; без строки исполнителя ограничения нет. */
export const checkerAllowed = (executorIds: readonly string[] | undefined, checkerId: string): boolean =>
  checkerId !== CHECKER_WORKFLOW || executorIds === undefined || executorIds.some((id) => WORKFLOW_EXECUTORS.includes(id));

const executorRow = (executor: Executor | undefined, m: Messages["rows"]): DecisionQuestion[] =>
  executor === undefined
    ? []
    : [
        {
          id: SETUP_ROW.executor,
          question: m.executor,
          kind: "choice",
          allowOwn: false,
          options: EXECUTORS.map(([id, key]) => {
            const add = executor.adds?.[id];
            return { id, action: String(m[key]), recommended: id === executor.recommended, ...(add === undefined ? {} : { add }) };
          }),
        },
      ];

const withAdd = (add: Add | undefined): { add?: Add } => (add === undefined ? {} : { add });

// Сторонний агент разворачивается в вариант на каждую модель: выбор модели — это и есть выбор того, кто проверяет.
const reviewRow = (id: string, question: string, checker: Checker | undefined, m: Messages["rows"]): DecisionQuestion[] => {
  if (checker === undefined) return [];
  const agents =
    checker.models === undefined
      ? [{ id: "agent", action: m.agent, recommended: checker.recommended === "agent", ...withAdd(checker.adds?.agent) }]
      : checker.models.map((model) => ({ id: `agent:${model.name}`, action: m.agentOn(model.name), recommended: checker.recommended === "agent" && model.recommended, ...withAdd(model.add) }));
  return [
    {
      id,
      question,
      kind: "choice",
      allowOwn: false,
      options: [
        { id: REVIEW_NONE, action: m.none, recommended: checker.recommended === REVIEW_NONE },
        { id: "self", action: m.self, recommended: checker.recommended === "self", ...withAdd(checker.adds?.self) },
        ...agents,
        { id: CHECKER_WORKFLOW, action: m.inWorkflow, recommended: checker.recommended === "workflow", ...withAdd(checker.adds?.workflow) },
      ],
    },
  ];
};

const scaleRow = (id: string, question: string, scale: Scale | undefined, allowOwn: boolean): DecisionQuestion[] =>
  scale === undefined ? [] : [{ id, question, kind: "choice", allowOwn, options: scale.options }];

export const setupRows = (setup: BriefSetup | undefined, revocable = false, locale?: Locale): DecisionQuestion[] => {
  const m = messages(locale).rows;
  return [
    ...artifactsRow(setup?.artifacts ?? [], revocable, locale),
    ...executorRow(setup?.executor, m),
    ...reviewRow(SETUP_ROW.checker, m.review, setup?.checker, m),
    ...reviewRow(SETUP_ROW.testing, m.testing, setup?.testing, m),
    ...scaleRow(SETUP_ROW.budgetTarget, m.targetBudget, setup?.budgetTarget, true),
    ...scaleRow(SETUP_ROW.budgetMax, m.maxBudget, setup?.budgetMax, true),
  ];
};

/** Строки брифа; язык меняет только подписи строк первой части. */
export const rowsOf = (brief: DecisionBrief, locale?: Locale): DecisionQuestion[] => [...setupRows(brief.setup, brief.revocable === true, locale), ...brief.questions];

/** Бриф прежнего вида — с компактными вопросами вместо первой части; рисуется как раньше. */
export const isLegacyBrief = (brief: DecisionBrief): boolean =>
  brief.questions.some((q) => q.kind === "toggles" || q.kind === "choice" || (brief.kind === "brief" && q.kind === "yesno"));
