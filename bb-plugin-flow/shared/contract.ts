// Схемы брифа, ответа и контракт RPC — единственное место, где задана форма
// брифа. Длина текста не ограничивается нигде, кроме цены варианта в новом
// брифе: цена — короткая оценка, пояснение уходит в `description`. Фронт
// берёт отсюда только типы — `defineRpcContract` значением в бандл фронта
// не попадает.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

import { STEP_IDS } from "../packages/automation-steps/catalog";
import { MAX_SCRIPT_CHARS } from "../lib/script-limit";
import { SELF_EXECUTOR, STAGE_BUTTON_WIDTH, STAGE_KINDS } from "../lib/stage-constants";

export { SELF_EXECUTOR, STAGE_BUTTON_WIDTH };

// Непустая строка. Не `.trim()`: он переписывает значение, а текст брифа
// хранится ровно таким, каким его прислал агент.
const text = z.string().refine((s) => s.trim().length > 0, "must not be blank");

/** Потолок команды для владельца: запись с запасом ложится в kv. */
export const COMMAND_MAX_LENGTH = 20_000;

export const riskLevelSchema = z.enum(["XS", "S", "M", "L", "XL", "XXL"]);

/**
 * Добавка к бюджету — цель и потолок в долларах, — к риску целым числом и ко времени в минутах.
 * Все части в обе стороны: у исполнителя, ревью и тестирования добавка — разница с базой, и минус значит экономию.
 */
export const addSchema = z
  .object({ target: z.number(), max: z.number(), risk: z.number().int(), minutes: z.number().int().optional() })
  .refine((a) => a.max >= a.target, { message: "an add max is not below its target", path: ["max"] });

export const decisionOptionSchema = z.object({
  id: text,
  /** «Что делаем» — заголовок варианта. */
  action: text,
  recommended: z.boolean().default(false),
  /** Абзац о том, что произойдёт; обязателен у развилки и у `pick`. */
  description: z.string().optional(),
  cost: z.string().optional(),
  /** Уровень риска; обязателен у развилки нового брифа. */
  risk: riskLevelSchema.optional(),
  /** Риски прозой — поле старых брифов, новые пишут риски в `description`. */
  risks: z.string().optional(),
  /** Добавка варианта к бюджету и риску брифа; у развилки заменяет пару `cost` и `risk`. */
  add: addSchema.optional(),
  /** Вопросы того же брифа, которые при этом выборе теряют смысл: владелец их не видит, агент их не получает. */
  hides: z.array(text).optional(),
  /** Пункты «Готово, когда», которые вариант приносит: они в списке, пока вариант выбран. */
  criteria: z.array(text).min(1).optional(),
  /** Номера пунктов `setup.criteria` с нуля, которые вариант снимает, пока выбран. */
  removes: z.array(z.number().int().nonnegative()).min(1).optional(),
});

/**
 * `fork`, `pick`, `confirm` — вопросы второй части. `toggles`, `choice` и
 * `yesno` внутри брифа — вид старых брифов: хранилище их читает, инструмент
 * больше не принимает. `yesno` остаётся видом уточнения.
 */
export const questionKindSchema = z.enum(["fork", "pick", "confirm", "yesno", "toggles", "choice"]);

const filled = (value: string | undefined): boolean => (value ?? "").trim().length > 0;

const uniqueIds = (items: ReadonlyArray<{ id: string }>): boolean => new Set(items.map((i) => i.id)).size === items.length;

export const decisionQuestionSchema = z
  .object({
    id: text,
    question: text,
    context: z.string().optional(),
    /** Поле своего ответа у `choice`; у остальных видов оно есть всегда, у `toggles` запрещено. */
    allowOwn: z.boolean().default(false),
    kind: questionKindSchema,
    options: z.array(decisionOptionSchema).min(1),
  })
  .superRefine((q, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message, path: ["options"] });
    const optionIssue = (message: string, i: number) => ctx.addIssue({ code: "custom", message, path: ["options", i] });
    if (!uniqueIds(q.options)) issue("option ids must be unique within a question");
    if (q.kind === "confirm" ? q.options.length !== 1 : q.options.length < 2)
      issue(q.kind === "confirm" ? "a confirm question has exactly one option: yes" : "a question needs at least two options");
    if (q.kind !== "toggles" && q.kind !== "pick" && q.options.filter((o) => o.recommended).length > 1)
      issue(`a ${q.kind} question recommends at most one option`);
    if (q.kind === "yesno" && q.options.length !== 2) issue("a yesno question has exactly two options: yes and no");
    if (q.kind === "toggles" && q.allowOwn)
      ctx.addIssue({ code: "custom", message: "a toggles question takes no own answer", path: ["allowOwn"] });
    q.options.forEach((o, i) => {
      const priced = o.add !== undefined || (filled(o.cost) && (o.risk !== undefined || filled(o.risks)));
      if (q.kind === "fork" && (!filled(o.description) || !priced)) optionIssue("every fork option needs description and add, or description, cost and risk", i);
      if (q.kind === "pick" && !filled(o.description)) optionIssue("every pick option needs a description", i);
    });
  });

export const artifactStateSchema = z.enum(["approved", "ready", "stale", "missing"]);

export const artifactSchema = z
  .object({
    id: text,
    /** Имя колонки; в новом брифе — из `ARTIFACT_SLOTS`. */
    name: text,
    /** `approved` — есть и утверждён; `ready` — есть, ждёт утверждения; `stale` — не актуален; `missing` — нет. */
    state: artifactStateSchema,
    /** `target` — путь файла от корня worktree или URL. */
    link: z.object({ label: text, target: text }).optional(),
    recommended: z.boolean().default(false),
    add: addSchema.optional(),
  })
  .superRefine((a, ctx) => {
    const exists = a.state === "approved" || a.state === "ready";
    // Ссылка обязательна у существующего, у неактуального — по желанию (прежний документ, зачёркнутый), у отсутствующего её нет.
    if (exists && a.link === undefined) ctx.addIssue({ code: "custom", message: `an ${a.state} artifact needs a link`, path: ["link"] });
    if (a.state === "missing" && a.link !== undefined) ctx.addIssue({ code: "custom", message: "a missing artifact takes no link", path: ["link"] });
    if (a.state === "approved" && a.recommended)
      ctx.addIssue({ code: "custom", message: "an approved artifact has nothing to recommend", path: ["recommended"] });
  });

export const scaleSchema = z
  .object({ options: z.array(z.object({ id: text, action: text, recommended: z.boolean().default(false) })).min(2) })
  .superRefine((s, ctx) => {
    if (!uniqueIds(s.options)) ctx.addIssue({ code: "custom", message: "option ids must be unique", path: ["options"] });
    if (s.options.filter((o) => o.recommended).length > 1)
      ctx.addIssue({ code: "custom", message: "a scale recommends at most one option", path: ["options"] });
  });

/** Кто исполняет работу; подписи способов рисует виджет. */
export const executorSchema = z.object({
  recommended: z.enum(["self", "subagents", "workflow", "fanout"]),
  /** Добавки способов; ключи необязательны — у способа без добавки её нет. */
  adds: z.object({ self: addSchema, subagents: addSchema, workflow: addSchema, fanout: addSchema }).partial().optional(),
});

/**
 * Ревью или тестирование: никто (база), сам, сторонний агент на одной из моделей или шаг внутри workflow.
 * У базы `none` добавки нет — добавки остальных и есть разница с ней.
 */
export const checkerSchema = z
  .object({
    recommended: z.enum(["none", "self", "agent", "workflow"]),
    /** Добавки проверяющих; у стороннего агента со списком моделей добавка — у модели. */
    adds: z.object({ self: addSchema, agent: addSchema, workflow: addSchema }).partial().optional(),
    models: z.array(z.object({ name: text, recommended: z.boolean().default(false), add: addSchema.optional() })).min(1).optional(),
  })
  .superRefine((c, ctx) => {
    const picked = (c.models ?? []).filter((m) => m.recommended).length;
    if (picked > 1) ctx.addIssue({ code: "custom", message: "a checker recommends at most one model", path: ["models"] });
    if (c.recommended === "agent" && picked !== 1)
      ctx.addIssue({ code: "custom", message: "a recommended agent checker names models with exactly one recommended", path: ["models"] });
    if (!uniqueIds((c.models ?? []).map((m) => ({ id: m.name }))))
      ctx.addIssue({ code: "custom", message: "model names must be unique", path: ["models"] });
  });

// ——— этапы работ ———

/** Исполнитель этапа из настроек: агент или workflow. Подписи хранятся вместе с id, чтобы снимок в брифе не зависел от файлов агентов. */
export const stageExecutorSchema = z.object({
  /** `agent:<name>` или `workflow:<name>`. */
  id: text,
  kind: z.enum(["agent", "workflow"]),
  name: text,
  model: z.string().optional(),
  /** Поставщик агента — по нему виджет берёт иконку. */
  provider: z.string().optional(),
  description: z.string().optional(),
});

/**
 * Автоматизация этапа. Встроенная (`source: "flow"`) — шаги Flow и скрипты этапа по порядку, их исполняет сам Flow;
 * автоматизация Automations — снимок id, имени и подписей шагов на момент добавления, чтобы бриф и таблица читались без плагина.
 * У записей до встроенных автоматизаций `source` нет — это автоматизация Automations.
 */
/** Скрипт, добавленный владельцем файлом: имя файла — подпись шага, содержимое — то, что Flow запускает. */
export const automationScriptSchema = z.object({ id: text, name: text, content: z.string().max(MAX_SCRIPT_CHARS) });

/** Шаг встроенной автоматизации: шаг Flow по id или скрипт этапа — `script:<id скрипта>`. */
export const automationStepSchema = z.union([z.enum(STEP_IDS), z.templateLiteral(["script:", z.string().min(1)])]);

/** Сохранённый набор шагов встроенной автоматизации: без имени, в меню кнопки «Автоматизация» — строкой шагов. */
export const automationSetSchema = z.object({ steps: z.array(automationStepSchema).min(1), scripts: z.array(automationScriptSchema).optional() });

export const stageAutomationSchema = z.union([
  z.object({ source: z.literal("flow"), steps: z.array(automationStepSchema), scripts: z.array(automationScriptSchema).optional() }),
  z.object({ id: text, name: text, steps: z.array(text).optional() }),
]);

/**
 * Этап работ в настройках: вид, навык, название и кто может исполнять кроме самого агента.
 * `kind` нет у записей до видов — вид тогда выводит `stageKindOf`; `review` — флаг прежних снимков брифа, новые этапы его не пишут.
 */
export const workStageSchema = z
  .object({
    id: text,
    kind: z.enum(STAGE_KINDS).optional(),
    skill: z.string(),
    name: text,
    review: z.boolean().optional(),
    executors: z.array(stageExecutorSchema),
    /** Этап-автоматизация: её исполняет Flow, а не агент. */
    automation: stageAutomationSchema.optional(),
  })
  .superRefine((s, ctx) => {
    if (!uniqueIds(s.executors)) ctx.addIssue({ code: "custom", message: "executor ids must be unique within a stage", path: ["executors"] });
  });

export const stageSettingsSchema = z
  .object({ stages: z.array(workStageSchema), minButtonWidth: z.number().int().min(STAGE_BUTTON_WIDTH.min).max(STAGE_BUTTON_WIDTH.max) })
  .superRefine((s, ctx) => {
    if (!uniqueIds(s.stages)) ctx.addIssue({ code: "custom", message: "stage ids must be unique", path: ["stages"] });
  });

/** Flow — именованная таблица этапов. Тред идёт по одному flow: из него инструкции агенту и проверка брифа. */
export const flowSchema = z
  // `description` — когда выбирать этот flow: из описаний Flow пишет корневой навык, по которому агент выбирает flow сам.
  .object({ id: text, name: text, description: z.string().optional(), stages: z.array(workStageSchema) })
  .superRefine((f, ctx) => {
    if (!uniqueIds(f.stages)) ctx.addIssue({ code: "custom", message: "stage ids must be unique within a flow", path: ["stages"] });
  });

/**
 * Все flow владельца; первый — flow по умолчанию. Ширина кнопки этапа общая на все flow. `agentChoosesFlow` — тред, где
 * выбрано «без flow», получает flow от агента по корневому навыку. `version: 2` — flow перенесены на виды этапов.
 */
export const flowSettingsSchema = z
  .object({
    flows: z.array(flowSchema).min(1),
    minButtonWidth: stageSettingsSchema.shape.minButtonWidth,
    agentChoosesFlow: z.boolean().optional(),
    automationSets: z.array(automationSetSchema).optional(),
    version: z.literal(2).optional(),
  })
  .superRefine((s, ctx) => {
    if (!uniqueIds(s.flows)) ctx.addIssue({ code: "custom", message: "flow ids must be unique", path: ["flows"] });
  });

/**
 * Этап черновика flow от агента: id и название необязательны — их даёт ядро, исполнители — id из каталога,
 * автоматизация — в форме хранилища, скрипты содержимым.
 */
export const stageDraftSchema = z.object({
  id: text.optional(),
  kind: z.enum(STAGE_KINDS),
  skill: z.string().optional(),
  name: text.optional(),
  executors: z.array(text).optional(),
  automation: stageAutomationSchema.optional(),
});

/** Параметры `save_flow`: flow без `id` — новый; `position` — место в списке с нуля, первый flow — flow по умолчанию. */
export const flowDraftSchema = z.object({
  id: text.optional(),
  name: text,
  description: z.string().optional(),
  position: z.number().int().nonnegative().optional(),
  stages: z.array(stageDraftSchema),
});

/**
 * Отчёт агента об этапе: `todo` — не сделан, `done` — сделан; `review` — сделан и ждал приёмки, только в брифах, записанных до Демонстрации.
 * `add` — добавка этапа, когда исполняет сам агент; `adds` — разница исполнителей этапа по их id.
 */
export const stageReportSchema = z
  .object({
    id: text,
    state: z.enum(["todo", "review", "done"]),
    results: z.array(z.object({ label: text, target: text })).min(1).optional(),
    /** Рекомендую взять в ближайший прогон; только у несделанного. */
    recommended: z.boolean().default(false),
    executor: text.default(SELF_EXECUTOR),
    add: addSchema.optional(),
    adds: z.record(z.string(), addSchema).optional(),
  })
  .superRefine((s, ctx) => {
    // Ссылки сделанного этапа навыка проверяет `reportIssues`: вид этапа знают настройки, а не отчёт.
    if (s.state === "todo" && s.results !== undefined) ctx.addIssue({ code: "custom", message: "a todo stage has no results yet", path: ["results"] });
    if (s.state !== "todo" && s.recommended) ctx.addIssue({ code: "custom", message: "only a todo stage is recommended for the next run", path: ["recommended"] });
  });

/**
 * Где исполнять работу: `here` — этот тред; `thread` — новый тред соседом этого, без родителя;
 * `child` — тот же новый тред, но дочерний этому; `other` — новый тред в другом проекте bb;
 * `worktree` — прежнее место, новый тред в новом рабочем дереве: его не предлагают, но
 * запомненный выбор читается.
 */
export const dispatchPlaceSchema = z.enum(["here", "thread", "worktree", "child", "other"]);

/** Рабочее дерево нового треда: это же, новое или чекаут проекта. */
export const routeTreeSchema = z.enum(["same", "new", "local"]);

/** Ветка нового треда: текущая, отведённая от текущей, от origin/main, от main или без смены ветки. */
export const routeBranchSchema = z.enum(["current", "from-current", "from-origin-main", "from-main", "none"]);

/**
 * Маршрут нового треда; какие деревья и ветки возможны в каком месте, решает ядро.
 * `projectId` есть только у места `other`; маршруты, записанные раньше, читаются без него.
 */
export const dispatchRouteSchema = z.object({ tree: routeTreeSchema, branch: routeBranchSchema, projectId: text.optional() });

/**
 * Итог этапа: что из «Готово, когда» сделано, что нет и почему, что ещё важно знать и какие задачи закрыты.
 * Промежуточный итог называет следующий этап, финальному называть нечего.
 */
export const stageOutcomeSchema = z
  .object({
    /** Id этапа из настроек плагина. */
    stage: text,
    final: z.boolean(),
    /** Название следующего этапа; только у промежуточного итога. */
    next: text.optional(),
    done: z.array(text),
    pending: z.array(z.object({ text, why: text.optional() })),
    /** «Важно знать» — то, что владельцу нужно знать помимо пунктов; абзацы — через пустую строку. */
    notes: text.optional(),
    /** Дополнительные секции Демонстрации: заголовок и текст абзацами через пустую строку. */
    sections: z.array(z.object({ title: text, text })).min(1).optional(),
    tasks: z.array(z.object({ key: text, done: z.boolean(), note: text.optional() })).min(1).optional(),
    /** Ссылка — файл, путь или адрес страницы; команда — запуск результата одной кнопкой в терминале треда. */
    results: z.array(z.union([z.object({ label: text, target: text }).strict(), z.object({ label: text, command: text.max(COMMAND_MAX_LENGTH) }).strict()])).min(1),
    /** С прошлой Демонстрации менялись только документы — живой ссылки нет. */
    documentsOnly: z.literal(true).optional(),
  })
  .superRefine((o, ctx) => {
    if (o.done.length + o.pending.length === 0)
      ctx.addIssue({ code: "custom", message: "an outcome names at least one done or pending item", path: ["done"] });
    if (o.final && o.next !== undefined) ctx.addIssue({ code: "custom", message: "a final outcome has no next stage", path: ["next"] });
  });

/** Пункт «Готово, когда»: строка или объект с добавкой; пункт-изменение несёт и «было», и «стало». */
export const criterionSchema = z.union([
  text,
  z.object({ text, before: text, after: text, add: addSchema.optional() }).strict(),
  z.object({ text, add: addSchema.optional() }).strict(),
]);

/** Первая часть брифа: не вопросы, а состояние и рекомендации. Подписи строк рисует виджет. */
export const briefSetupSchema = z
  .object({
    artifacts: z.array(artifactSchema).min(1).optional(),
    priority: scaleSchema.optional(),
    executor: executorSchema.optional(),
    checker: checkerSchema.optional(),
    testing: checkerSchema.optional(),
    budgetTarget: scaleSchema.optional(),
    budgetMax: scaleSchema.optional(),
    /** «Готово, когда» — по проверяемому утверждению на пункт; владелец снимает, правит и дописывает пункты. */
    criteria: z.array(criterionSchema).min(1).optional(),
    /** Этапы работ из настроек плагина — по отчёту на этап. */
    stages: z.array(stageReportSchema).min(1).optional(),
  })
  .superRefine((s, ctx) => {
    if (s.artifacts !== undefined && !uniqueIds(s.artifacts))
      ctx.addIssue({ code: "custom", message: "artifact ids must be unique", path: ["artifacts"] });
    if (s.stages !== undefined && !uniqueIds(s.stages)) ctx.addIssue({ code: "custom", message: "stage ids must be unique", path: ["stages"] });
    // Шаг ревью или тестирования внутри workflow есть только у работы, которую исполняет workflow.
    const inWorkflow = s.executor === undefined || s.executor.recommended === "workflow" || s.executor.recommended === "fanout";
    for (const key of ["checker", "testing"] as const)
      if (s[key]?.recommended === "workflow" && !inWorkflow)
        ctx.addIssue({ code: "custom", message: `a workflow ${key} needs executor workflow or fanout`, path: [key] });
  });

/** Колонки артефактов нового брифа — все четыре и в этом порядке: прототип вторым, спецификация третьей. */
export const ARTIFACT_SLOTS = [
  { id: "task", name: "Задача" },
  { id: "prototype", name: "HTML-прототип" },
  { id: "spec", name: "Спецификация" },
  { id: "plan", name: "План" },
] as const;

/** Префикс идентификаторов строк первой части в ответе. */
export const SETUP_ID_PREFIX = "setup.";

export const briefKindSchema = z.enum(["brief", "clarify"]);

const briefFields = {
  title: text,
  intro: z.string().optional(),
  /** `brief` — агент ждёт ответа; `clarify` — можно не отвечать. */
  kind: briefKindSchema.default("brief"),
  setup: briefSetupSchema.optional(),
  /** Итог этапа вместо первой части: работа уже идёт, спрашивать про этапы и бюджет нечего. */
  outcome: stageOutcomeSchema.optional(),
  questions: z.array(decisionQuestionSchema).default([]),
};

type BriefShape = {
  kind: "brief" | "clarify";
  outcome?: unknown;
  setup?:
    | {
        artifacts?: ReadonlyArray<{ id: string; name: string; state: string; link?: { label: string; target: string } | undefined }> | undefined;
        priority?: unknown;
        executor?: unknown;
        checker?: unknown;
        testing?: unknown;
        budgetTarget?: unknown;
        budgetMax?: unknown;
        criteria?: unknown;
        stages?: readonly unknown[] | undefined;
      }
    | undefined;
  questions: ReadonlyArray<{
    id: string;
    kind: string;
    options: ReadonlyArray<{ risk?: string | undefined; cost?: string | undefined; add?: unknown; hides?: readonly string[] | undefined; removes?: readonly number[] | undefined }>;
  }>;
};

const hasSetup = (brief: BriefShape): boolean => Object.values(brief.setup ?? {}).some((v) => v !== undefined);

/** Есть ли в первой части что решать: шкала, критерий, исполнитель, ревью, тестирование или артефакт — утверждение тоже можно отозвать. */
const setupHasRows = ({ setup }: BriefShape): boolean =>
  setup?.criteria !== undefined ||
  setup?.priority !== undefined ||
  setup?.executor !== undefined ||
  setup?.checker !== undefined ||
  setup?.testing !== undefined ||
  setup?.budgetTarget !== undefined ||
  setup?.budgetMax !== undefined ||
  (setup?.artifacts ?? []).length > 0 ||
  (setup?.stages ?? []).length > 0;

const checkBrief = (brief: BriefShape, ctx: z.RefinementCtx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message, path: ["questions"] });
  if (brief.questions.length === 0 && !setupHasRows(brief) && brief.outcome === undefined)
    issue("a brief needs something to decide: a setup row, a question or a stage outcome");
  // Итог этапа — про уже идущую работу: этапы и «Готово, когда» в таком брифе больше не решаются.
  if (brief.outcome !== undefined && (brief.setup?.stages !== undefined || brief.setup?.criteria !== undefined))
    ctx.addIssue({ code: "custom", message: "a brief with an outcome sends no setup.stages and no setup.criteria", path: ["outcome"] });
  if (!uniqueIds(brief.questions)) issue("question ids must be unique within a brief");
  if (brief.questions.some((q) => q.id.startsWith(SETUP_ID_PREFIX))) issue(`question ids must not start with ${SETUP_ID_PREFIX}`);
  // Уточнение — одна строка, отвечаемая одним нажатием: второй вопрос в нём остался бы без ответа навсегда.
  if (brief.kind === "clarify" && (brief.questions.length !== 1 || brief.questions[0]?.kind !== "yesno" || hasSetup(brief)))
    issue("a clarify brief holds exactly one yesno question and no setup");
  // Скрывать можно только вопросы ниже: расчёт скрытого идёт одним проходом сверху вниз.
  const position = new Map(brief.questions.map((q, i) => [q.id, i]));
  if (brief.questions.some((q, i) => q.options.some((o) => (o.hides ?? []).some((id) => (position.get(id) ?? -1) <= i))))
    issue("an option hides only questions below its own in the same brief");
  const items = Array.isArray(brief.setup?.criteria) ? brief.setup.criteria.length : 0;
  if (brief.questions.some((q) => q.options.some((o) => (o.removes ?? []).some((i) => i >= items))))
    issue("an option removes only items of setup.criteria, by their index from zero");
};

/** Подпись ссылки документа — имя файла из пути (с расширением или без) или ключ задачи; ссылка на URL подписывается как угодно. */
const labelNamesFile = (label: string, target: string): boolean => {
  if (/^https?:\/\//.test(target) || /^[A-Z][A-Z0-9]*-\d+$/.test(label)) return true;
  const base = target.split("/").pop() ?? "";
  return label === base || label === base.replace(/\.[^.]+$/, "");
};

/** Потолок цены варианта: длиннее — уже пояснение, а не оценка, и в строке «Цена · Риск» оно не помещается. */
export const COST_MAX_LENGTH = 40;

// Новый бриф: артефакты — только в setup, приоритета и бюджетов-шкал нет, вопросы — только fork, pick и confirm,
// у развилки — уровень риска. Хранилище эти правила не применяет: старые брифы читаются как были.
const checkNewBrief = (brief: BriefShape, ctx: z.RefinementCtx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message, path: ["questions"] });
  const artifacts = brief.setup?.artifacts;
  const slotted = (list: NonNullable<typeof artifacts>) =>
    list.length === ARTIFACT_SLOTS.length && ARTIFACT_SLOTS.every((slot, i) => list[i]?.id === slot.id && list[i]?.name === slot.name);
  if (artifacts !== undefined && !slotted(artifacts))
    ctx.addIssue({
      code: "custom",
      message: `artifacts are exactly ${ARTIFACT_SLOTS.map((a) => a.id).join(", ")} in this order, named ${ARTIFACT_SLOTS.map((a) => `«${a.name}»`).join(", ")}; an absent one is state missing`,
      path: ["setup", "artifacts"],
    });
  const unnamed = (artifacts ?? []).filter((a) => a.link !== undefined && !labelNamesFile(a.link.label, a.link.target)).map((a) => a.id);
  if (unnamed.length > 0)
    ctx.addIssue({
      code: "custom",
      message: `artifact link label is the file name or task key, not a document title: ${unnamed.join(", ")} — use the base name of target, like "spec.md", or a key like "BP-28"`,
      path: ["setup", "artifacts"],
    });
  if (brief.setup?.priority !== undefined)
    issue("priority is gone: the owner decides executor, checker (review) and testing; send those instead");
  if (brief.setup?.budgetTarget !== undefined || brief.setup?.budgetMax !== undefined)
    issue("budgetTarget and budgetMax are gone: the budget button sums add { target, max, risk, minutes } of criteria, artifacts, executor, checker, testing and options");
  // Развилка без добавки у одного из вариантов занизила бы прогноз; в pick вариант без добавки честно значит «+0».
  if (brief.questions.some((q) => q.kind === "fork" && q.options.some((o) => o.add !== undefined) && q.options.some((o) => o.add === undefined)))
    issue("within one fork either every option has add or none does");
  if (brief.kind === "brief" && brief.questions.some((q) => q.kind !== "fork" && q.kind !== "pick" && q.kind !== "confirm"))
    issue("brief questions are fork, pick or confirm; artifacts, executor, checker and testing go into setup");
  if (brief.questions.some((q) => q.kind === "fork" && q.options.some((o) => o.risk === undefined && o.add === undefined)))
    issue("every fork option needs an add { target, max, risk } or a risk level: XS, S, M, L, XL or XXL");
  if ((brief.setup?.stages ?? []).some((s) => (s as { state?: string }).state === "review"))
    ctx.addIssue({ code: "custom", message: "stage state review is gone: a stage is todo or done, and the owner sees results on a demo stage", path: ["setup", "stages"] });
  if (brief.questions.some((q) => q.options.some((o) => (o.cost ?? "").length > COST_MAX_LENGTH)))
    issue(`an option cost is a short estimate like "~1M tokens" or "$12", at most ${COST_MAX_LENGTH} characters; move the explanation into description`);
};

/** Параметры инструмента `ask_decision`: бриф без того, что проставляет плагин. */
export const askDecisionParamsSchema = z.object(briefFields).superRefine(checkBrief).superRefine(checkNewBrief);

/** Выбор владельца, перенесённый из прошлого отвеченного брифа треда: строка `setup.*` → варианты. */
export const carriedSchema = z.record(z.string(), z.array(z.string()));

export const decisionBriefSchema = z
  .object({
    id: text,
    threadId: text,
    createdAt: text,
    /** Ставит сервер новым брифам: утверждённые артефакты в них можно отозвать. У записанных раньше метки нет — они читаются как были. */
    revocable: z.boolean().optional(),
    /** Ставит сервер брифу запущенной работы: в нём не рисуются ни бюджет, ни цены вариантов. */
    launched: z.literal(true).optional(),
    /** Ставит сервер из настроек: какие документы сделать и какие утвердить обязательно. */
    required: z.object({ make: z.array(text), approve: z.array(text) }).optional(),
    /** Ставит сервер: сколько минут шло и сколько долларов стоило планирование в треде до брифа; без известной цены модели — только минуты. */
    planning: z.object({ minutes: z.number().int().nonnegative(), cost: z.number().nonnegative().optional() }).optional(),
    /** Ставит сервер: исполнитель, ревью и тестирование, которые владелец выбрал сам в прошлом отвеченном брифе треда. */
    carried: carriedSchema.optional(),
    /** Ставит сервер: этапы работ из настроек на момент брифа — отвеченный бриф рисуется ими, даже если настройки потом поменялись. */
    stages: z.object({ list: z.array(workStageSchema), minButtonWidth: z.number().int() }).optional(),
    ...briefFields,
  })
  .superRefine(checkBrief);

export const questionAnswerSchema = z.object({
  questionId: text,
  optionIds: z.array(z.string()).refine((ids) => new Set(ids).size === ids.length, "option ids must not repeat"),
  own: z.string().optional(),
  /** Варианты нижнего блока, которых владелец коснулся сам; нет у ответов, записанных раньше. */
  picked: z.array(z.string()).optional(),
});

const criterionIndex = z.number().int().nonnegative();

/** Правки «Готово, когда» по номерам пунктов брифа, считая с нуля; нетронутые пункты не перечисляются. */
export const criteriaAnswerSchema = z.object({
  removed: z.array(criterionIndex),
  edited: z.array(z.object({ index: criterionIndex, text })),
  added: z.array(text),
});

/**
 * Выбор владельца по этапу: взять в ближайший прогон, исполнитель, остановка на приёмку.
 * У этапа на приёмке — принят ли он и свой ответ; `picked` — что из выбора владелец менял сам.
 */
export const stageAnswerSchema = z.object({
  id: text,
  run: z.boolean(),
  executor: text,
  /** Остановка на приёмку — только в ответах, записанных до Демонстрации. */
  review: z.boolean().optional(),
  accepted: z.boolean().optional(),
  note: z.string().optional(),
  picked: z.array(z.enum(["run", "executor", "review"])).optional(),
});

export const decisionAnswerSchema = z.object({
  briefId: text,
  answers: z.array(questionAnswerSchema),
  /** Есть у брифа с этапами. */
  stages: z.array(stageAnswerSchema).optional(),
  /** Есть ровно у брифа с критерием. */
  criteria: criteriaAnswerSchema.optional(),
  /** Своя цена владельца вместо прогноза: цель и потолок текстом, как набраны. */
  budget: z.object({ target: z.string().optional(), max: z.string().optional() }).optional(),
  /** Свободный текст ко всему брифу. */
  note: z.string().optional(),
  /** Где исполнять работу; ответы, записанные раньше, читаются как «в этом треде». */
  place: dispatchPlaceSchema.optional(),
  /** Дерево и ветка нового треда; без маршрута новый тред идёт по старому месту. */
  route: dispatchRouteSchema.optional(),
  /** Сперва компактировать тред, потом отдать ответ агенту; только у места «в этом треде». */
  compact: z.boolean().optional(),
  /** Ответ на итог этапа: «Продолжить» и свой ответ. Есть только у брифа с итогом. */
  outcome: z.object({ accepted: z.boolean(), note: z.string().optional() }).optional(),
});

/** Прогноз бюджета на момент отправки ответа — та же форма, что считает ядро; `null` — величина неизвестна. */
export const forecastSnapshotSchema = z.object({
  lines: z.array(
    z.object({ label: z.string(), note: z.string(), minutes: z.number().nullable(), risk: z.number(), target: z.number().nullable(), max: z.number().nullable() }),
  ),
  minutes: z.number().nullable(),
  risk: z.number(),
  target: z.number(),
  max: z.number(),
  /** Сколько первых строк — уже потраченное; нет у снимков, записанных раньше. */
  spent: z.number().int().nonnegative().optional(),
});

export const answerRecordSchema = z.object({
  answer: decisionAnswerSchema,
  /** Ставит сервер при приёме: прогноз, который владелец видел; нет у брифа без прогноза и у ответов, записанных раньше. */
  forecast: forecastSnapshotSchema.optional(),
  /** Есть, когда владелец передал работу: тред, созданный ответом. */
  handoffThreadId: text.optional(),
  /** Сообщение, в котором стоит директива брифа. */
  messageId: text,
  answeredAt: z.iso.datetime(),
});

/** Сколько картинок владелец прикладывает к одному ответу и сколько base64 они весят вместе — предел тела RPC, как у голоса. */
export const ANSWER_IMAGES_MAX = 6;
export const ANSWER_IMAGES_MAX_BASE64 = 16 * 1024 * 1024;

/** Форматы, которые провайдеры принимают картинкой; svg и heic упали бы уже после принятого ответа. */
export const ANSWER_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

/**
 * Картинки ответа: в kv-запись не входят, сервер кладёт их файлами в хранилище треда и отдаёт агенту путями.
 * `n` — номер метки «[картинка N]» в тексте ответа: по нему сервер называет файл и связывает метку с путём.
 */
export const answerImagesSchema = z
  .array(z.object({ n: z.number().int().positive(), mimeType: z.enum(ANSWER_IMAGE_TYPES), dataBase64: z.string().min(1) }))
  .max(ANSWER_IMAGES_MAX)
  .refine((images) => new Set(images.map((i) => i.n)).size === images.length, "image numbers must not repeat")
  .refine((images) => images.reduce((sum, i) => sum + i.dataBase64.length, 0) <= ANSWER_IMAGES_MAX_BASE64, "images exceed 16 MB of base64");

export const decisionsRpcContract = defineRpcContract({
  getBrief: {
    input: z.object({ id: z.string() }),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("found"), brief: decisionBriefSchema, answer: answerRecordSchema.nullable() }),
      z.object({ kind: z.literal("not_found") }),
    ]),
  },
  answerBrief: {
    /** `locale` — язык интерфейса владельца: на нём уходит реплика агенту; без него — русский, как до выбора языка. */
    input: z.object({ id: z.string(), answer: decisionAnswerSchema, messageId: text, images: answerImagesSchema.optional(), locale: z.enum(["en", "ru"]).optional() }),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("accepted"), record: answerRecordSchema }),
      z.object({ kind: z.literal("already_answered"), record: answerRecordSchema }),
      z.object({ kind: z.literal("not_found") }),
      z.object({ kind: z.literal("incomplete"), questionIds: z.array(z.string()) }),
    ]),
  },
});

/**
 * Место исполнения — своим контрактом, как голос и файлы: тестовые обработчики
 * RPC типизируются по всему контракту, и метод внутри контракта брифа заставил
 * бы дописывать его в каждый тест брифа.
 */
export const dispatchRpcContract = defineRpcContract({
  /** Последний выбор места в проекте треда: с него виджет открывает бриф. */
  getDispatchPlace: {
    input: z.object({ threadId: text }),
    output: z.object({ place: dispatchPlaceSchema, route: dispatchRouteSchema.optional() }),
  },
  /** Проекты bb, кроме проекта треда: третья колонка выбора места. Список — удобство, поэтому сбой возвращается отказом, а не ошибкой. */
  listProjects: {
    input: z.object({ threadId: text }),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("found"), projects: z.array(z.object({ id: text, name: z.string() })) }),
      z.object({ kind: z.literal("unavailable") }),
    ]),
  },
});

/** Хост и корень хранилища треда: по ним виджет открывает результат, лежащий вне дерева треда. */
export const filesRpcContract = defineRpcContract({
  threadStorage: {
    input: z.object({ threadId: text }),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("found"), hostId: z.string(), storageRootPath: z.string() }),
      z.object({ kind: z.literal("unavailable") }),
    ]),
  },
});

/** Команда, которую агент отдаёт владельцу инструментом `share_command`; предел — чтобы запись уместилась в kv с запасом. */
export const shareCommandParamsSchema = z.object({
  command: text.max(COMMAND_MAX_LENGTH),
});

export const commandRecordSchema = z.object({
  id: text,
  threadId: text,
  command: text,
  createdAt: z.iso.datetime(),
});

export const commandsRpcContract = defineRpcContract({
  getCommand: {
    input: z.object({ id: z.string() }),
    output: z.discriminatedUnion("kind", [z.object({ kind: z.literal("found"), command: commandRecordSchema }), z.object({ kind: z.literal("not_found") })]),
  },
  /** Тред берётся из записи команды, а не от клиента: выполнить можно только в треде, где агент её отдал. */
  runCommand: {
    input: z.object({ id: z.string() }),
    output: z.discriminatedUnion("kind", [z.object({ kind: z.literal("sent"), created: z.boolean() }), z.object({ kind: z.literal("not_found") })]),
  },
});

/** Запуск результата Демонстрации — своим контрактом: тестовые обработчики типизируются по всему контракту, и метод в контракте команды потребовал бы его в каждом тесте команды. */
export const outcomeRpcContract = defineRpcContract({
  /** Команда — из сохранённого брифа по индексу результата, тред — брифа. */
  runOutcomeCommand: {
    input: z.object({ briefId: z.string(), index: z.number().int().nonnegative() }),
    output: z.discriminatedUnion("kind", [z.object({ kind: z.literal("sent"), created: z.boolean() }), z.object({ kind: z.literal("not_found") })]),
  },
});

/** Навыки и исполнители, из которых владелец собирает этапы в настройках. */
export const stageCatalogSchema = z.object({
  skills: z.array(z.object({ name: text, description: z.string().optional() })),
  executors: z.array(stageExecutorSchema),
});

/** Где лежит корневой навык flow: хост и абсолютный путь файла; нет навыка или хоста — `null`. */
export const rootSkillSchema = z.object({ hostId: z.string(), path: z.string() }).nullable();

/** Страница Flow — своим контрактом: брифу он не нужен. */
export const flowSettingsRpcContract = defineRpcContract({
  getFlowSettings: { input: z.object({}), output: flowSettingsSchema },
  saveFlowSettings: { input: flowSettingsSchema, output: flowSettingsSchema },
  getStageCatalog: { input: z.object({}), output: stageCatalogSchema },
  getRootSkill: { input: z.object({}), output: rootSkillSchema },
  /** Файл навыка по имени — для кнопки «Открыть навык»; `null` — не найден. */
  getSkillFile: { input: z.object({ name: z.string() }), output: rootSkillSchema },
  /** Показать файл навыка в файловой системе машины сервера bb; путь сервер находит сам по имени. */
  revealSkill: { input: z.object({ name: z.string() }), output: z.object({ revealed: z.boolean(), error: z.string().nullable() }) },
});

/** Путь журнала решений по проекту — словарь `projectId → путь от корня рабочего дерева треда`. */
export const journalDirsSchema = z.record(z.string(), text);

export const journalDirResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("saved"), path: z.string().nullable() }),
  z.object({ kind: z.literal("invalid"), reason: z.enum(["absolute", "traversal"]) }),
]);

/** `id` и `name` идут от хоста как есть, не от агента — `z.string()`, а не `text`: пустое имя проекта не должно ронять всю секцию невалидным выводом RPC. */
export const journalProjectSchema = z.object({ id: z.string(), name: z.string(), path: z.string().nullable() });

/** Секция настроек пути журнала решений — своим контрактом: брифу он не нужен. */
export const journalSettingsRpcContract = defineRpcContract({
  getJournalProjects: { input: z.object({}), output: z.array(journalProjectSchema) },
  setJournalDir: { input: z.object({ projectId: text, path: z.string() }), output: journalDirResultSchema },
});

// ——— прогресс flow ———

const resultSchema = z.object({ label: text, target: text });

/** Отметки этапа в треде: начат и закончен (ISO), ссылки, стоимость и активные минуты окна, вне прогона и выбранный исполнитель. */
export const stageTrackSchema = z.object({
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  results: z.array(resultSchema).optional(),
  cost: z.number().nonnegative().optional(),
  /** Минуты окна этапа, в которые лог сессии писался; поля нет — минуты этапа ещё не считались. */
  activeMinutes: z.number().int().nonnegative().optional(),
  /** Накопленный простой этапа с шагами, мс: время, пока упавший шаг ждал владельца, а этап Action — нажатия. */
  idleMs: z.number().int().nonnegative().optional(),
  /** Начало открытого интервала простоя (ISO); поля нет — этап сейчас не стоит. */
  idleSince: z.string().optional(),
  skipped: z.boolean().optional(),
  executor: z.string().optional(),
  /**
   * Прогон этапа: шаги снимком, номер текущего шага, ошибка упавшего (`null` —
   * не падал), `busy` — шаг Action сейчас исполняется, и `failures` — история
   * падений. История не чистится ни повтором, ни пропуском: `error` говорит,
   * чем прогон занят сейчас, а `failures` — что с ним случалось, и по ней
   * видно, какой шаг ломается раз за разом.
   */
  run: z
    .object({
      steps: z.array(z.object({ id: text, label: text, detail: z.string().optional() })),
      at: z.number().int().nonnegative(),
      error: z.string().nullable(),
      busy: z.boolean().optional(),
      failures: z.array(z.object({ step: text, at: text, error: text })).optional(),
    })
    .optional(),
});

export const plannedSchema = z.object({ minutes: z.number().nullable(), target: z.number(), max: z.number() });

/** Прогресс flow треда в kv: этапы по id, этапы, ждущие владельца, и план из прогноза ответа. */
export const flowProgressSchema = z.object({
  stages: z.record(z.string(), stageTrackSchema),
  waiting: z.array(z.string()),
  planned: plannedSchema.optional(),
  /** Последний бриф треда, коснувшийся прогресса: под его карточкой встаёт итог завершённого прогона. */
  lastBriefId: z.string().optional(),
  /** Тред, который ведёт прогон сейчас; у записи до переноса прогресса на прогон поля нет — её ведёт тред, под чьим id она лежит. */
  thread: z.string().optional(),
  /** Минуты и доллары этапов считаны по логам всех тредов прогона и их потомков; у записи без пометки их однажды пересчитывают. */
  countedAcrossRun: z.literal(true).optional(),
});

/** Исполнитель этапов прогона в итоге: кем он был и сколько на нём сделано. */
export const runExecutorSchema = z.object({
  id: text,
  kind: z.enum(["self", "agent", "workflow"]),
  name: text,
  model: z.string().optional(),
  stages: z.number().int().positive(),
  cost: z.number().nonnegative(),
});

/** Итог завершённого прогона: окно, время, деньги, состав этапов и исполнители. */
export const runSummarySchema = z.object({
  startedAt: z.string(),
  finishedAt: z.string(),
  minutes: z.number().int().nonnegative(),
  wallMinutes: z.number().int().nonnegative(),
  idleMinutes: z.number().int().nonnegative(),
  cost: z.number().nonnegative(),
  stages: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  executors: z.array(runExecutorSchema),
});

export const progressStageSchema = z.object({
  id: text,
  kind: z.enum(STAGE_KINDS),
  name: text,
  executor: z.enum(["self", "agent", "workflow"]),
  state: z.enum(["done", "now", "todo", "skip", "fail"]),
  /** На этапе сейчас идёт работа — ход агента или прогон автоматизации; мерцает только живой. */
  live: z.boolean().optional(),
  /** Провайдер исполнителя этапа навыка — треда или субагента; по нему фронт берёт логотип. */
  provider: z.string().optional(),
  results: z.array(resultSchema),
  /** Место этапа среди этапов прогона, с 1; вычеркнутый номера не получает. */
  number: z.number().int().positive().nullable().optional(),
  /** Минуты работы на этапе: активные, а без них — от начала до конца этапа. */
  minutes: z.number().int().nonnegative().nullable(),
  /** Всё время этапа от начала до конца, вместе с ожиданием владельца. */
  wallMinutes: z.number().int().nonnegative().nullable().optional(),
  /** Минуты простоя этапа с шагами: ожидание владельца у упавшего шага или нажатия. У этапа без шагов — `null`. */
  idleMinutes: z.number().int().nonnegative().nullable().optional(),
  cost: z.number().nonnegative().nullable(),
  /** Шаги этапа-автоматизации или этапа Action с состояниями; `wait` — шаг Action ждёт нажатия владельца. У остальных этапов поля нет. */
  automation: z
    .object({
      steps: z.array(
        z.object({
          id: text,
          label: text,
          state: z.enum(["done", "now", "fail", "todo", "wait"]),
          error: z.string().nullable(),
          /** Что шаг сделал: адрес PR, тема коммита, ключи переведённых задач. Не сказал — `null`; поля нет у шагов, снятых до того, как строку успеха начали хранить. */
          detail: z.string().nullable().default(null),
        }),
      ),
    })
    .optional(),
});

/**
 * Заполненность окна контекста треда — вторая полоса баннера. Доля считается
 * на сервере, пороги едут рядом: фронт не делит числа заново и не читает
 * настройки вторым путём.
 */
export const contextFillSchema = z.object({
  /** Доля занятого окна в `0..1`. */
  share: z.number(),
  usedTokens: z.number(),
  windowTokens: z.number(),
  // Пара разобрана на границе: оба на шкале, жёлтый строго меньше красного.
  // Схема сторожит то, что подсказка полосы печатает дословно.
  warnPercent: z.number().min(0).max(100),
  alertPercent: z.number().min(0).max(100),
});

/** Вид прогресса для баннера: этапы flow треда по порядку, счёт сделанных, номер текущего этапа среди этапов прогона и их число, текущий этап и план. */
export const progressViewSchema = z.object({
  stages: z.array(progressStageSchema),
  done: z.number().int().nonnegative(),
  step: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  current: z.string().nullable(),
  planned: plannedSchema.nullable(),
  /** Окружение треда: по нему баннер открывает результат с путём от корня дерева; нет — `null`. */
  environmentId: z.string().nullable().optional(),
  /** Название flow, по которому идёт тред: строкой над этапами раскрытого баннера. */
  flowName: z.string().optional(),
  /** Прогон закрыт целиком: баннер над композером снимается, а в ленту встаёт итог. */
  finished: z.boolean().optional(),
  /** Итог завершённого прогона; `null` — прогон идёт или закрытых этапов ещё нет. */
  summary: runSummarySchema.nullable().optional(),
  /** Бриф, под карточкой которого рисуется итог; `null` — брифа в записи нет. */
  summaryBriefId: z.string().nullable().optional(),
  /** Заполненность окна контекста для второй полосы; поля нет — полосы нет. */
  context: contextFillSchema.optional(),
  /** Тред, который ведёт прогон, когда это не сам тред баннера: работа передана, и баннер её только показывает. */
  carrier: z.object({ threadId: text, title: z.string().nullable() }).optional(),
});

/** Баннер прогресса — своим контрактом: брифу он не нужен. */
/** Замороженный итог прогона: то, что рисует блок под карточкой брифа, когда сам прогон уже сменился следующим. */
export const frozenRunSchema = z.object({
  threadId: text,
  summary: runSummarySchema,
  stages: z.array(progressStageSchema),
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  planned: plannedSchema.nullable(),
  flowName: z.string().optional(),
  environmentId: z.string().nullable(),
});

/** Строка истории прогонов: замороженный итог с брифом, под которым он лежит, и названием треда; `exists: false` — треда больше нет. */
export const runHistoryEntrySchema = frozenRunSchema.extend({
  briefId: text,
  title: z.string().nullable(),
  exists: z.boolean(),
});

export const progressRpcContract = defineRpcContract({
  getFlowProgress: { input: z.object({ threadId: text }), output: progressViewSchema.nullable() },
  /** Итог прогона, замороженный под этим брифом; `null` — прогона под ним не завершалось. */
  getRunSummary: { input: z.object({ briefId: text }), output: frozenRunSchema.nullable() },
  /** Все завершённые прогоны всех тредов, свежие сверху. */
  getRunHistory: { input: z.object({}), output: z.array(runHistoryEntrySchema) },
});

export const flowStageParamsSchema = z.object({
  stage: text,
  state: z.enum(["started", "done"]),
  results: z.array(resultSchema).min(1).optional(),
});

/** Треды, ждущие владельца на брифе Flow, с видом ожидания — для значка в левой панели. */
/** Вид ожидания: встроенный этап брифа или упавшая автоматизация — у неё `briefId` вида `automation:<этап>`. */
export const awaitingEntrySchema = z.object({ briefId: text, kind: z.enum(["questions", "criteria", "select", "demo", "automation", "action"]) });

export const awaitingRpcContract = defineRpcContract({
  awaitingThreads: { input: z.object({}), output: z.array(z.object({ threadId: text, kind: awaitingEntrySchema.shape.kind })) },
});

/** Значок идущего этапа в левой панели: автоматизация или исполнитель этапа навыка. */
export const runningIconSchema = z.enum(["automation", "action", "self", "agent", "workflow"]);

/** Прогон автоматизаций Flow: повтор и пропуск упавшего шага, треды с идущим этапом. */
export const automationRpcContract = defineRpcContract({
  retryAutomation: { input: z.object({ threadId: text, stage: text }), output: z.object({ started: z.boolean() }) },
  skipAutomationStep: { input: z.object({ threadId: text, stage: text }), output: z.object({ started: z.boolean() }) },
  /** Нажатие владельца на кнопку шага этапа Action: `started` — шаг взят в работу, `false` — этап не ждёт нажатия или шаг уже идёт. */
  runActionStep: { input: z.object({ threadId: text, stage: text }), output: z.object({ started: z.boolean() }) },
  /** `provider` — имя и логотип провайдера исполнителя, когда у него есть логотип. */
  runningThreads: { input: z.object({}), output: z.array(z.object({ threadId: text, icon: runningIconSchema, provider: z.object({ name: text, logoUrl: text }).optional() })) },
});

/** Кнопка flow в композере нового треда: выбор запоминается по проекту и достаётся новому треду. */
/**
 * Следующий прогон в том же треде: сообщение владельца в тред с завершённым
 * прогоном Flow придерживает хуком `message.dispatch`, а форма над композером
 * спрашивает flow и компактацию; ответ отпускает придержанное сообщение.
 */
export const nextRunRpcContract = defineRpcContract({
  /** Flow владельца для формы следующего прогона: у области композера треда своего проекта нет, а список от него и не зависит. */
  nextRunFlows: { input: z.object({ threadId: text }), output: z.object({ flows: z.array(z.object({ id: text, name: text })) }) },
  /** Есть ли в очереди треда сообщение, придержанное Flow до выбора flow: форма стоит только над ним. */
  nextRunHeld: { input: z.object({ threadId: text }), output: z.object({ held: z.boolean() }) },
  startNextRun: {
    input: z.object({ threadId: text, flowId: text, compact: z.boolean() }),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("sent") }),
      z.object({ kind: z.literal("failed"), reason: z.string() }),
    ]),
  },
});

export const flowPickerRpcContract = defineRpcContract({
  getFlowChoice: {
    input: z.object({ projectId: text }),
    output: z.object({ flows: z.array(z.object({ id: text, name: text })), selected: text }),
  },
  setFlowChoice: { input: z.object({ projectId: text, flowId: text }), output: z.object({ selected: text }) },
});

/** Пять минут записи браузера (до ~130 кбит/с) в base64 — с запасом. */
const VOICE_AUDIO_MAX_BASE64 = 16 * 1024 * 1024;

/**
 * Голосовой ввод в полях брифа — отдельным контрактом: брифу он не нужен, и
 * контракт брифа не растёт от того, что у полей появился микрофон.
 */
export const voiceRpcContract = defineRpcContract({
  /** Звук поля брифа в base64 → текст из распознавания bb, того же, что у композера. */
  transcribeVoice: {
    input: z.object({
      audio: z.string().min(1).max(VOICE_AUDIO_MAX_BASE64),
      mimeType: z.string(),
      /** Текст поля перед курсором — контекст распознавателю. */
      prompt: z.string().optional(),
    }),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("transcribed"), text }),
      z.object({ kind: z.literal("failed"), reason: z.enum(["empty", "unavailable"]) }),
    ]),
  },
});

export type RiskLevel = z.output<typeof riskLevelSchema>;
export type Add = z.output<typeof addSchema>;
export type Criterion = z.output<typeof criterionSchema>;
export type Planning = NonNullable<z.output<typeof decisionBriefSchema>["planning"]>;
export type Artifact = z.output<typeof artifactSchema>;
export type Scale = z.output<typeof scaleSchema>;
export type Executor = z.output<typeof executorSchema>;
export type Checker = z.output<typeof checkerSchema>;
export type BriefSetup = z.output<typeof briefSetupSchema>;
export type DecisionOption = z.output<typeof decisionOptionSchema>;
export type CommandRecord = z.output<typeof commandRecordSchema>;
export type AnswerImage = z.output<typeof answerImagesSchema>[number];
export type QuestionKind = z.output<typeof questionKindSchema>;
export type DecisionQuestion = z.output<typeof decisionQuestionSchema>;
export type BriefKind = z.output<typeof briefKindSchema>;
export type DecisionBrief = z.output<typeof decisionBriefSchema>;
export type AskDecisionParams = z.output<typeof askDecisionParamsSchema>;
export type QuestionAnswer = z.output<typeof questionAnswerSchema>;
export type CriteriaAnswer = z.output<typeof criteriaAnswerSchema>;
export type DecisionAnswer = z.output<typeof decisionAnswerSchema>;
export type AnswerRecord = z.output<typeof answerRecordSchema>;
export type StageExecutor = z.output<typeof stageExecutorSchema>;
export type WorkStage = z.output<typeof workStageSchema>;
export type StageAutomation = z.output<typeof stageAutomationSchema>;
export type BuiltinAutomation = Extract<StageAutomation, { source: "flow" }>;
export type AutomationStep = z.output<typeof automationStepSchema>;
export type AutomationScript = z.output<typeof automationScriptSchema>;
export type StageTrack = z.output<typeof stageTrackSchema>;
export type RunningIcon = z.output<typeof runningIconSchema>;
/** Идущий тред в левой панели: значок этапа и провайдер исполнителя, когда у него есть логотип. */
export type RunningThread = z.output<typeof automationRpcContract.runningThreads.output>[number];
export type StageSettings = z.output<typeof stageSettingsSchema>;
export type Flow = z.output<typeof flowSchema>;
export type AutomationSet = z.output<typeof automationSetSchema>;
export type FlowSettings = z.output<typeof flowSettingsSchema>;
export type StageReport = z.output<typeof stageReportSchema>;
export type StageAnswer = z.output<typeof stageAnswerSchema>;
export type StageCatalog = z.output<typeof stageCatalogSchema>;
export type StageDraft = z.output<typeof stageDraftSchema>;
export type FlowDraft = z.output<typeof flowDraftSchema>;
export type RootSkill = z.output<typeof rootSkillSchema>;
export type DispatchPlace = z.output<typeof dispatchPlaceSchema>;
export type DispatchRoute = z.output<typeof dispatchRouteSchema>;
export type RouteTree = z.output<typeof routeTreeSchema>;
export type RouteBranch = z.output<typeof routeBranchSchema>;
export type StageOutcome = z.output<typeof stageOutcomeSchema>;
export type OutcomeResult = StageOutcome["results"][number];
export type FlowProgress = z.output<typeof flowProgressSchema>;
export type ProgressView = z.output<typeof progressViewSchema>;
export type ProgressStage = z.output<typeof progressStageSchema>;
export type RunSummaryView = z.output<typeof runSummarySchema>;
export type FrozenRun = z.output<typeof frozenRunSchema>;
export type RunHistoryEntry = z.output<typeof runHistoryEntrySchema>;
export type Planned = z.output<typeof plannedSchema>;
export type ContextFillView = z.output<typeof contextFillSchema>;
export type AwaitingKind = z.output<typeof awaitingEntrySchema>["kind"];
