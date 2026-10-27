// Инструмент `ask_decision` — единственный способ агента спросить владельца.
// Кладёт бриф в хранилище и возвращает строку директивы, которую агент
// вставляет в ответ; ответ владельца приходит обычной репликой в тред.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import type { Carried } from "../core/carry";
import { awaitingKind } from "../core/awaiting";
import { resolvesIssues, type ResolveTarget } from "../core/clarify";
import { approvalIssues, outcomeText } from "../core/approval-guard";
import { unfinishedBefore } from "../core/automation-run";
import { isApproval, memberSources, nextGroup, restoredOf } from "../core/fold";
import { liveIssues, nextFlowIssues, outcomeKind, reportOnlyIssues } from "../core/outcome";
import { DECISION_ID_PREFIX, directiveLine } from "../core/directive";
import { terminalCommandIssue } from "../core/terminal-command";
import { money, plannedMinutes, recommendedForecast } from "../core/budget";
import { contextTone, plannedModel, withSubagents, type CatalogModel } from "../core/context";
import { INSTRUCTIONS_LIMIT_CHARS } from "../lib/agent-limits";
import { holdsNothing, joinsApproval, settleOf } from "../core/settle";
import { FLOW_RULE, SELF_ONLY_RULE, compactStageInstructions, isAskedStage, isAutomationStage, isStageCarryKey, recommendedStageChoice, reportIssues, stageInstructions, stageItems, withStepResults } from "../core/stages";
import { isHeadingStage } from "../core/sub-stages";
import { stageKindOf, type BuiltinKind, type StageKind } from "../lib/stage-constants";
import { FORK_ZERO_RULE, OPTION_PRICE_RULE, askDecisionParamsSchema, type AskDecisionParams, type ContextFillView, type Criterion, type DecisionBrief, type Execution, type FlowProgress, type Planning, type RestoredDraft, type StageSettings } from "../shared/contract";
import { ANSWERED_CHANNEL } from "./api";
import { FLOW_STAGE_TOOL, type ProgressStore } from "./progress";
import { KV_VALUE_LIMIT_BYTES, type DecisionStore } from "./store";
import type { FlowTrigger } from "./automations";

export const ASK_TOOL_NAME = "ask_decision";

const RULE = `Ask the owner every question, clarification, fork and point of confusion only with the ${ASK_TOOL_NAME} tool, never as prose in your reply; gather what has piled up into one brief and mark the option you would pick as recommended.`;

export const ASK_INSTRUCTIONS = `Ask the owner only through this tool, never as prose; mark the option you would pick as recommended.

scope — what you understood: the minimal work, each fork at its simplest answer, as a nested list; every brief before launch starts with it.

setup — the first part, no questions:
- criteria — Definition of Done, one checkable item each; a changed item names before and after. add { target, max, risk, minutes } — your active spend with own tests; target and minutes > 0.
- stages — every stage of the flow, in order. share { percent, risk } on every todo skill stage — its part of the scope (the work itself 100); factors { <executor id>: { factor, risk } } — a multiplier > 0, you are 1. No add or adds on stages.
The budget forecast: scope = kept items + chosen options; a run stage adds scope × percent × factor. Risk is an integer, 1r ≈ 10% chance a blocking defect reaches the owner: implementation raises it, spec, plan, prototype, review and testing lower it.

questions — an id does not start with "setup.".
- fork — one answer that changes the outcome; every option needs description and add (or cost + risk XS…XXL). The simplest option costs 0, its work in setup.criteria; others: add = price of own criteria.
- pick — several answers, description on every option.
- confirm — one "Yes" on what scope leaves open.
hides on an option — ids of questions below that lose meaning when it is chosen; the owner does not see them. criteria on an option — items it adds while chosen, required if priced; an item of an option the owner drops themselves stays in the list struck through, so an item that depends on one answer goes on the option, not into setup.criteria; removes — setup.criteria indexes it strikes.

outcome — a demo of running work instead of setup; results hold a live one — an http(s) URL or { label, command } — unless documentsOnly.

clarify — any question with no setup, price or outcome; brief — only an approval stops you.

Paste the result's directive line standalone, with no quotes or backticks.`;

/**
 * Сообщение владельца в чат при ждущем брифе возвращает бриф агенту (./brief-return.ts). В описании инструмента, а не в
 * инструкциях: те уже упираются в 4096 символов.
 */
export const RETURNED_RULE =
  "A chat message from the owner while your brief waits returns it and outranks it: take in the text and attachments, then send the brief again, revised; the owner's choices stay preselected where ids match. A message or a comment under an approval's Continue returns the whole group of widgets since the previous approval: send the reworked widgets first, then the approval — one right after a returned one, without reworked widgets between, is refused. An approval closes only when the owner sends it with its button.";

/**
 * Повтор строки в последнем ответе хода: bb сворачивает реплики между вызовами инструментов в «Worked for», а карточка брифа
 * встаёт в последнем сообщении с его строкой — так виджет, не остановивший ход, остаётся на виду и после хода.
 */
const repeatInFinalReply = (where: string): string =>
  ` When the turn ends, paste the line once more in the final reply of this turn${where}: bb folds replies between tool calls under "Worked for", and the card moves to the last copy of its line.`;

/**
 * Что агенту делать после брифа: ждать ответа только у Утверждения и брифа без метки, остальным — работать дальше и
 * повторить строку в конце хода. Бриф, который кончает ход, сам напоминает о повторе: между демо и утверждением может
 * пройти целый этап, и наказ демо забыт.
 */
const nextStep = (brief: DecisionBrief): string => {
  if (brief.kind !== "brief") return ` Keep working; the answer arrives along the way.${repeatInFinalReply("")}`;
  if (brief.outcome !== undefined && outcomeKind(brief) === "demo")
    return ` Then go on to the next stage of the run without waiting: the demo stage is closed by this call.${brief.settle === "approval" ? " The owner's comment on it arrives with the next approval." : ""}${repeatInFinalReply(", above the approval line or the brief line that ends the turn")}`;
  if (brief.settle === "approval")
    return ` Then go on without waiting, on the recommended values: these stages are closed by this call, and the owner's answers, edits and comments arrive together with the next approval.${repeatInFinalReply(", above the approval line or the brief line that ends the turn")}`;
  if (brief.settle === "agent")
    return ` Then go on without waiting: no approval stands ahead in the flow, so the recommended values are your decision — items formulated and stages chosen from the history of similar tasks; the widget only shows them.${repeatInFinalReply(", above the approval line or the brief line that ends the turn")}`;
  return " In the same reply, paste again above this line the lines of demos and clarifies you sent earlier in this turn. Then end the turn and wait for the answer.";
};

/** Наказ после каждого вызова: строка виджета прошлого хода не повторяется, а решённое уточнение закрывается `resolves`. */
const EARLIER_TURN_RULE = `Paste a directive line only in the turn that sent it; never repeat the line of a widget from an earlier turn — its card would move there. A clarify you fixed or decided yourself — close it with resolves in your next ${ASK_TOOL_NAME} call: its card collapses in place into a "Resolved: …" line.`;

const briefResult = (brief: DecisionBrief): string =>
  `${directiveLine(brief.id)}

Paste the line above into your reply as a standalone line — the owner sees the brief in its place.${nextStep(brief)}${
    brief.restored === undefined ? "" : " The owner's choices from the returned brief are preselected where question and option ids match."
  }

${EARLIER_TURN_RULE}`;

/**
 * Возвращённый брифу треда и выбор владельца в нём — для нового брифа. `grouped` — вернулась группа утверждения: её указатель
 * держится до следующего утверждения, чтобы выбор получили все доработанные виджеты; одиночный забирает следующий бриф.
 */
type Returned = { briefId: string; grouped: boolean; restored?: RestoredDraft };

/**
 * Выбор владельца из возвращённого: у группы — из всех её виджетов, у одиночного — из него самого. Ответ и черновик каждого — источник,
 * вместе с пунктами Definition of Done: правки пунктов ложатся на новый бриф по тексту. Выбора нет — возвращать нечего.
 */
const restoredFrom = async (store: DecisionStore, threadId: string): Promise<Returned | null> => {
  const briefId = await store.getThreadReturned(threadId);
  if (briefId === null) return null;
  const holder = await store.getBrief(briefId);
  const grouped = holder !== null && isApproval(holder);
  const ids = grouped ? ((await store.getFold(briefId))?.ids ?? [briefId]) : [briefId];
  const members = await Promise.all(
    ids.map(async (id) => ({
      brief: id === briefId ? holder : await store.getBrief(id),
      answer: (await store.getAnswer(id))?.answer ?? null,
      draft: await store.getDraft(id),
    })),
  );
  const restored = restoredOf(members.flatMap(memberSources));
  return { briefId, grouped, ...(restored === undefined ? {} : { restored }) };
};

/** Перенос треда — только этапы, которые агент прислал в setup нового брифа: исполнителя, ревью и тестирования прежнего вида инструмент не принимает. */
const carriedInto = (setup: AskDecisionParams["setup"], carried: Carried): Record<string, string[]> => {
  const stageIds = (setup?.stages ?? []).map((s) => s.id);
  return Object.fromEntries(Object.entries(carried).filter(([key]) => isStageCarryKey(key, stageIds)).map(([key, ids]) => [key, [...ids]]));
};

/**
 * Первая часть брифа после запуска работы — и виды этапов, пока несделанный из которых её ещё можно прислать:
 * этапы — при втором Выборе этапов или Definition of Done посреди flow (критерий сдаётся вместе с отчётом), критерий — при Definition of Done.
 */
const LAUNCHED_SETUP = [
  ["stages", ["select", "criteria"]],
  ["criteria", ["criteria"]],
] as const satisfies ReadonlyArray<readonly ["stages" | "criteria", readonly BuiltinKind[]]>;

/**
 * Бриф запущенной работы. Во flow с Definition of Done развилка, критерий или выбор этапов спрашиваются только после отката
 * к нему: иначе они пройдут мимо критериев и выбора этапов, которые от них зависят. Откатанный Definition of Done стоит
 * в брифе todo — ответ закрывает его снова. Демонстрация и уточнение да/нет — не развилка.
 */
const launchedIssues = (params: AskDecisionParams, stages: StageSettings["stages"], progress: FlowProgress | null): string[] => {
  const openKind = (kinds: readonly BuiltinKind[]) =>
    (params.setup?.stages ?? []).some((r) => r.state === "todo" && stages.some((s) => s.id === r.id && kinds.includes(stageKindOf(s) as BuiltinKind)));
  const criteria = stages.find((s) => stageKindOf(s) === "criteria");
  const asks = params.outcome === undefined && (params.questions.length > 0 || params.setup !== undefined);
  const track = criteria === undefined ? undefined : progress?.stages[criteria.id];
  if (criteria !== undefined && asks && track?.finishedAt !== undefined)
    return [`the work is already launched: a new fork, criterion or stage choice goes through Definition of Done again — roll back to it with ${FLOW_STAGE_TOOL} { stage: "${criteria.id}", state: "started" }, then send this brief with ${criteria.id} and the stage selection todo in setup.stages`];
  if (criteria !== undefined && asks && track?.startedAt !== undefined && !openKind(["criteria"]))
    return [`the work is already launched and Definition of Done is rolled back: send this brief with ${criteria.id} and the stage selection todo in setup.stages`];
  const sent = LAUNCHED_SETUP.filter(([key, kinds]) => params.setup?.[key] !== undefined && !openKind(kinds)).map(([key]) => key);
  return sent.length === 0
    ? []
    : [`setup.${sent.join(", setup.")} are not accepted here: the work in this thread is already launched — send them only while a todo stage selection or Definition of Done stage stands in setup.stages`];
};

/** Этапы, о которых бриф докладывает итогом: Демонстрация и Утверждение. */
const OUTCOME_KINDS: readonly StageKind[] = ["demo", "approve"];

/** Итог — про запущенную работу и про этап Демонстрации или Утверждения из flow треда; flow без Вопросов, Definition of Done и Выбора этапов запуска не ждёт. */
const outcomeIssues = (outcome: AskDecisionParams["outcome"], questionCount: number, launched: boolean, stages: StageSettings["stages"], flowIds: readonly string[], progress: FlowProgress | null | undefined, reworkPending: boolean): string[] => {
  if (outcome === undefined) return [];
  if (!launched && stages.some(isAskedStage)) return ["an outcome reports a stage of running work, and the work in this thread has not started yet: send a brief with setup.stages first"];
  const approval = stages.some((stage) => stage.id === outcome.stage && stageKindOf(stage) === "approve");
  const reported = stages.filter((stage) => OUTCOME_KINDS.includes(stageKindOf(stage))).map((s) => s.id);
  // Демонстрация и Утверждение показывают пройденную работу: этап прогона перед ними, не закрытый агентом, — работа пропущена.
  // Утверждение, где владелец соглашается на снятие этапа, этапами, предложенными к снятию, не держится.
  const open = progress === null || progress === undefined ? null : unfinishedBefore(stages, progress, outcome.stage, !approval);
  return [
    ...(reported.includes(outcome.stage) ? [] : [`outcome.stage ${outcome.stage} is not a demo or approval stage of the thread's flow: ${reported.length === 0 ? "the flow has none" : reported.join(", ")}`]),
    ...(open === null ? [] : [`stage ${open.id} "${open.name}" comes before ${outcome.stage} in the run and is not marked done: finish it and mark it done with ${FLOW_STAGE_TOOL} first`]),
    // Команду результата владелец запускает кнопкой в терминале: длинная обрежется там так же, как у share_command.
    ...outcome.results.flatMap((result, i) => ("command" in result ? [terminalCommandIssue(result.command, `outcome.results[${i}].command`)] : [])).filter((issue) => issue !== null),
    // Утверждение показывает, что утверждается, и переводит работу в рекомендованный flow; Демонстрация — отчёт с живым результатом, без вопросов и перехода.
    ...(approval ? [...approvalIssues(stages, progress, outcome.stage, reworkPending, outcomeText(outcome)), ...nextFlowIssues(outcome, flowIds)] : [...liveIssues(outcome), ...reportOnlyIssues(outcome, questionCount)]),
  ];
};

/**
 * Бюджет брифа складывается из этапов: первый бриф треда, чей flow выбирает этапы, без них вышел бы «$0 · до $0».
 * Уточнение и итог Демонстрации этапов не несут, а после запуска этапы уже выбраны.
 */
const missingStagesIssues = (params: AskDecisionParams, launched: boolean, stages: StageSettings["stages"]): string[] => {
  const exempt = params.kind !== "brief" || launched || params.outcome !== undefined || params.setup?.stages !== undefined;
  const selects = stages.some((s) => stageKindOf(s) === "select");
  return exempt || !selects
    ? []
    : ["setup.stages is missing: the thread's flow has a stage selection and the work is not launched yet, so this brief carries every stage of the flow — the budget is summed from them"];
};

/** Цена пункта Definition of Done — деньги и минуты одного агента; без неё база брифа нулевая. */
const pricedItem = (item: Criterion): boolean => typeof item !== "string" && item.add !== undefined && item.add.target > 0 && (item.add.minutes ?? 0) > 0;

/** Бюджет считается у незапущенного брифа, в котором решается работа; уточнение, итог Демонстрации и вопрос посреди работы его не считают. */
const decidesBudget = (params: Pick<AskDecisionParams, "kind" | "outcome">, launched: boolean): boolean => params.kind === "brief" && !launched && params.outcome === undefined;

/** База бюджета: «Что я понял», цена у каждого пункта Definition of Done, пункты у варианта с ценой, доля у несделанного этапа-навыка. Ошибки идут в общий отказ брифа. */
const baseIssues = (params: AskDecisionParams, launched: boolean, stages: StageSettings["stages"]): string[] => {
  if (!decidesBudget(params, launched)) return [];
  const criteria = params.setup?.criteria ?? [];
  const unpriced = criteria.flatMap((item, i) => (pricedItem(item) ? [] : [i + 1]));
  const unshared = (params.setup?.stages ?? [])
    .filter((r) => r.state === "todo" && r.share === undefined && stages.some((s) => s.id === r.id && stageKindOf(s) === "skill" && !isAutomationStage(s) && !isHeadingStage(stages, s)))
    .map((r) => r.id);
  return [
    ...(params.scope === undefined ? ["scope is missing: start the brief with what you understood — the minimal set of work as a nested list; its items are setup.criteria"] : []),
    ...(criteria.length === 0
      ? ["setup.criteria is missing: the Definition of Done items are the base of the budget, each with add { target, max, risk, minutes } — your active spend on the current model and effort, its own tests included"]
      : []),
    ...(unpriced.length === 0 ? [] : [`setup.criteria items ${unpriced.join(", ")} have no price: each item needs add with target and minutes above zero — your active spend on the current model and effort, its own tests included`]),
    ...(unshared.length === 0 ? [] : [`stages ${unshared.join(", ")} have no share: a todo skill stage sends share { percent, risk } — implementation by you is 100`]),
    ...bareOptionIssues(params.questions),
    ...zeroOptionIssues(params.questions),
  ];
};

/**
 * Вариант с ценой — работа, которую принимают, значит у него свои пункты Definition of Done.
 * Без них пункт, зависящий от ответа, оседает в общем списке, и отметка варианта список не меняет.
 */
const bareOptionIssues = (questions: AskDecisionParams["questions"]): string[] => {
  const bare = questions.flatMap((q) => q.options.filter((o) => (o.add?.target ?? 0) > 0 && o.criteria === undefined).map((o) => `${q.id}/${o.id}`));
  return bare.length === 0
    ? []
    : [
        `options ${bare.join(", ")} add work without Definition of Done items: an option priced above zero sends criteria — the items it adds while chosen; move the items that depend on this answer from setup.criteria onto the option`,
      ];
};

/**
 * Развилка до запуска решает, что войдёт в базу: самый простой её ответ стоит 0 и уже лежит в setup.criteria, остальные —
 * добавка сверх него. Без варианта за 0 в базе лежит ответ богаче, и цены вариантов — разница с ним (BBPL-531).
 * Посреди работы база — утверждённый объём, и каждый ответ развилки вправе быть добавкой к нему.
 */
const zeroOptionIssues = (questions: AskDecisionParams["questions"]): string[] => {
  const free = (o: AskDecisionParams["questions"][number]["options"][number]) => o.add !== undefined && o.add.target === 0 && o.add.max === 0 && (o.add.minutes ?? 0) === 0;
  const priced = questions.filter((q) => q.kind === "fork" && q.options.some((o) => o.add !== undefined) && !q.options.some(free)).map((q) => q.id);
  return priced.length === 0 ? [] : [`forks ${priced.join(", ")} have no option for 0: ${FORK_ZERO_RULE}; ${OPTION_PRICE_RULE}`];
};

/** Прогноз по рекомендациям у брифа с базой: работа всегда стоит денег и времени, ноль значит, что в прогон не взято ничего. */
const zeroForecastIssues = (brief: DecisionBrief, launched: boolean): string[] => {
  if (!decidesBudget(brief, launched)) return [];
  const f = recommendedForecast(brief);
  const minutes = plannedMinutes(f) ?? 0;
  return f.target > 0 && minutes > 0 ? [] : [`the forecast with your recommendations is ${money(f.target)} / ${minutes} min: work always costs money and time — take at least one stage into the run`];
};

/** Поля первой части, которые заменили этапы работ. */
const LEGACY_SETUP = ["artifacts", "executor", "checker", "testing"] as const;

const legacyIssues = (setup: AskDecisionParams["setup"]): string[] => {
  const sent = LEGACY_SETUP.filter((key) => setup?.[key] !== undefined);
  return sent.length === 0 ? [] : [`setup.${sent.join(", setup.")} are no longer accepted: work stages replaced documents, executor, review and testing — send them in setup.stages`];
};

/** Уточнения из `resolves` глазами хранилища: чьи они, какого вида и отвечены ли; без повторов, по порядку. */
const resolveTargets = (store: DecisionStore, ids: readonly string[]): Promise<Array<readonly [string, ResolveTarget]>> =>
  Promise.all(
    [...new Set(ids)].map(async (id) => {
      const found = await store.getBrief(id);
      const target: ResolveTarget = found === null ? null : { threadId: found.threadId, kind: found.kind, answered: (await store.getAnswer(id)) !== null };
      return [id, target] as const;
    }),
  );

/**
 * Неотвеченные уточнения группы ждут «Продолжить» нового Утверждения: метка `approval` снимает с них свою кнопку и вносит их
 * в группу, а `refresh` перерисовывает их открытые виджеты.
 */
const joinClarifies = async (store: DecisionStore, ids: readonly string[], refresh: (id: string) => void): Promise<void> => {
  for (const id of ids) {
    const member = await store.getBrief(id);
    if (member === null || !joinsApproval(member, (await store.getAnswer(id)) !== null, await store.isResolved(id))) continue;
    await store.putBrief({ ...member, settle: "approval" });
    refresh(id);
  }
};

const toolError = (text: string) => ({ isError: true as const, content: [{ type: "text" as const, text }] });

/**
 * Вклад Flow в ход треда с flow: правило брифа и этапы flow. Его же отдаёт выбор flow агентом — этапы нужны в том же ходе.
 */
export const flowTurnInstructions = (stages: StageSettings["stages"]): string => {
  const compose = (listed: string | null): string => [RULE, ...(listed === null ? [] : [FLOW_RULE, listed, SELF_ONLY_RULE])].join("\n\n");
  const full = compose(stageInstructions(stages));
  // Больше лимита bb обрежет хвост, и агент не узнает о последних этапах — Демонстрации и утверждениях.
  return full.length <= INSTRUCTIONS_LIMIT_CHARS ? full : compose(compactStageInstructions(stages));
};

/**
 * План моделей брифа: `plannedModel` каждого навыкового этапа, у которого он есть, и модель треда, от которой считается цена этапа.
 * Встроенные этапы — Вопросы, Демонстрация, Утверждение — модели в Выборе этапов не показывают.
 */
const modelPlanOf = (stages: StageSettings["stages"], thread: { current: Execution; models: readonly CatalogModel[] }): { models: Record<string, Execution>; threadModel: Execution } => ({
  models: Object.fromEntries(
    stages
      .filter((stage) => stageKindOf(stage) === "skill")
      .map((stage) => [stage.id, plannedModel(stage, thread.current, thread.models)] as const)
      .filter((entry): entry is readonly [string, Execution] => entry[1] !== null),
  ),
  threadModel: thread.current,
});

export const registerAskTool = (
  bb: Pick<BbPluginApi, "agents" | "realtime">,
  store: DecisionStore,
  /** `stages` — этапы flow треда; без них бриф с этапами не принимается. */
  deps: {
    newId: () => string;
    now: () => string;
    stages?: (threadId: string) => StageSettings;
    /** Id flow владельца: рекомендованный Демонстрацией flow должен быть одним из них. */
    flowIds?: () => readonly string[];
    /** Название flow треда; `undefined` — тред без flow. Бриф с этапами запоминает его и рисует им бирку Выбора этапов. */
    flowName?: (threadId: string) => string | undefined;
    /** Идёт ли тред по flow; `false` — «без flow» или «Автоматически» до выбора, и Flow не вкладывает в ход ничего. */
    hasFlow?: (threadId: string) => boolean;
    /** Заполненность окна контекста треда с порогами; не ниже жёлтого — бриф с этапами советует субагента на реализации и тестах. Нет — не советует. */
    context?: (threadId: string) => Promise<ContextFillView | null>;
    /** Длительность и стоимость планирования в треде; `undefined` — неизвестно. */
    planning?: (threadId: string) => Promise<Planning | undefined>;
    /** Прогресс flow треда: бриф отмечает ждущие и сделанные этапы. */
    progress?: Pick<ProgressStore, "recordBrief" | "get">;
    /** Бриф, по которому агент решил сам: его рекомендации ложатся, как ответ кнопкой (./api.ts). Нет — ничего не пишется. */
    decided?: (brief: DecisionBrief) => Promise<void>;
    /** Сообщает Automations о событии Flow; не ждётся и не бросает (./automations.ts). */
    emit?: (trigger: FlowTrigger, threadId: string, context?: { stageId?: string }) => void;
    /** Строка лимитов провайдеров для хода треда (./provider-threads.ts); `null` или нет — строки нет. */
    limits?: (threadId: string) => string | null;
    /** Модель треда с effort и каталог моделей его провайдера (./boundary.ts); `null` — тред не Claude Code. Бриф с этапами несёт по ним план моделей; нет или сбой — без плана. */
    threadModels?: (threadId: string) => Promise<{ current: Execution; models: readonly CatalogModel[] } | null>;
  },
): void => {
  bb.agents.registerTool({
    name: ASK_TOOL_NAME,
    description:
      "Ask the owner: a brief rendered as a widget in the thread — scope, setup (the flow's stages with executor, share and factors; Definition of Done items priced by you) and questions. " +
      'Every text field takes markdown links [text](target) — a path from the tree root (path:12 for a line), an absolute path or a URL: anything that lives in a file is named as a link to it, a fragment as one link "fragment (what it is) — file". ' +
      RETURNED_RULE,
    instructions: ASK_INSTRUCTIONS,
    presentation: { label: { pending: "Preparing a widget", completed: "Widget in the thread" } },
    parameters: askDecisionParamsSchema,
    async execute(params, ctx) {
      const settings = deps.stages?.(ctx.threadId) ?? { stages: [], minButtonWidth: 0 };
      const launched = await store.isLaunched(ctx.threadId);
      const legacy = params.kind === "brief" ? legacyIssues(params.setup) : [];
      const progress = (await deps.progress?.get(ctx.threadId)) ?? null;
      const launchedSetup = params.kind === "brief" && launched ? launchedIssues(params, settings.stages, progress) : [];
      // Утверждение вслед за свёрнутым без доработанных виджетов между ними не принимается: комментарий владельца ещё не учтён.
      const reworkPending = (await store.getThreadGroup(ctx.threadId))?.folded === true;
      const outcomeProblems = outcomeIssues(params.outcome, params.questions.length, launched, settings.stages, deps.flowIds?.() ?? [], deps.progress === undefined ? undefined : progress, reworkPending);
      const { resolves = [], ...fields } = params;
      const resolveProblems = resolvesIssues(ctx.threadId, await resolveTargets(store, resolves));
      const stageIssues = [...missingStagesIssues(params, launched, settings.stages), ...reportIssues(settings.stages, params.setup?.stages)];
      const base = baseIssues(params, launched, settings.stages);
      if (launchedSetup.length > 0 || outcomeProblems.length > 0 || resolveProblems.length > 0)
        return toolError(`Brief not accepted: ${[...launchedSetup, ...outcomeProblems, ...resolveProblems].join("; ")}.`);
      if (legacy.length > 0 || stageIssues.length > 0 || base.length > 0)
        return toolError(
          [`Brief not accepted: ${[...legacy, ...stageIssues, ...base].join("; ")}.`, ...(stageIssues.length > 0 ? [stageInstructions(settings.stages) ?? "The plugin settings have no stages."] : [])].join("\n\n"),
        );
      const planning = params.kind === "brief" ? await deps.planning?.(ctx.threadId) : undefined;
      const flowName = deps.flowName?.(ctx.threadId);
      const carried = params.kind === "brief" ? carriedInto(params.setup, await store.getThreadCarry(ctx.threadId)) : {};
      const returned = params.kind === "brief" ? await restoredFrom(store, ctx.threadId) : null;
      const midWork = launched && params.kind === "brief" && params.outcome === undefined;
      const approved = midWork ? await store.getThreadCriteria(ctx.threadId) : [];
      const approvedScope = midWork ? await store.getThreadScope(ctx.threadId) : null;
      // Утверждённый бюджет нужен только уточнению: второй Выбор этапов считает прогноз заново.
      const approvedBudget = midWork && params.setup?.stages === undefined ? (progress?.planned ?? null) : null;
      // Ссылки сделанной автоматизации — из её шагов: агент их не присылает.
      const reported = withStepResults(settings.stages, params.setup?.stages, params.setup?.stages === undefined ? null : progress);
      // Контекст не обычный: у реализации и тестов, оставленных себе, рекомендуется агент-исполнитель этапа — он работает в своём контексте.
      const fill = reported === undefined ? null : await deps.context?.(ctx.threadId).catch(() => null);
      const stepped = reported === undefined || fill === null || fill === undefined ? reported : withSubagents(reported, settings.stages, contextTone(fill.usedTokens, fill));
      const approval = params.outcome !== undefined && settings.stages.some((s) => s.id === params.outcome?.stage && stageKindOf(s) === "approve");
      const settle = settleOf(fields, settings.stages, progress, approval, launched);
      const withStages = params.setup?.stages !== undefined || params.outcome !== undefined;
      // План моделей — тот же `plannedModel`, что потом ставит граница; тред не Claude Code или каталог не прочёлся — плана нет.
      const threadModels = withStages ? await deps.threadModels?.(ctx.threadId).catch(() => null) : null;
      const modelPlan = threadModels === null || threadModels === undefined ? null : modelPlanOf(settings.stages, threadModels);
      const brief: DecisionBrief = {
        ...fields,
        ...(settle === undefined ? {} : { settle }),
        ...(params.setup === undefined || stepped === undefined ? {} : { setup: { ...params.setup, stages: stepped } }),
        id: `${DECISION_ID_PREFIX}${deps.newId()}`,
        threadId: ctx.threadId,
        revocable: true,
        // Бриф запущенной работы без этапов считает итог от утверждённого бюджета прогона; второй Выбор этапов — прогноз заново.
        ...(launched && params.setup?.stages === undefined ? { launched: true as const } : {}),
        ...(planning === undefined ? {} : { planning }),
        ...(Object.keys(carried).length === 0 ? {} : { carried }),
        ...(returned?.restored === undefined ? {} : { restored: returned.restored }),
        ...(approved.length === 0 ? {} : { approved }),
        ...(approvedScope === null ? {} : { approvedScope }),
        ...(approvedBudget === null ? {} : { approvedBudget }),
        ...(params.setup?.stages === undefined && params.outcome === undefined
          ? {}
          : {
              stages: {
                list: settings.stages,
                minButtonWidth: settings.minButtonWidth,
                ...(flowName === undefined ? {} : { flowName }),
                ...(modelPlan === null ? {} : modelPlan),
              },
            }),
        createdAt: deps.now(),
      };
      const zero = zeroForecastIssues(brief, launched);
      if (zero.length > 0) return toolError(`Brief not accepted: ${zero.join("; ")}.`);
      const stored = await store.putBrief(brief);
      if (stored.kind === "stored") {
        // Выбор уехал в новый бриф. Группа, вернувшаяся с утверждением, отдаёт его всем виджетам до следующего утверждения;
        // черновики свёрнутых остаются — их показывает раскрытая строка.
        if (returned !== null && (!returned.grouped || isApproval(brief))) await store.clearThreadReturned(ctx.threadId, returned.briefId).catch(() => undefined);
        const group = nextGroup(await store.getThreadGroup(ctx.threadId), brief);
        await store.putThreadGroup(ctx.threadId, group).catch(() => undefined);
        // Группа утверждения запоминается сейчас: к комментарию список треда уже уйдёт дальше — следующим брифом.
        if (isApproval(brief)) {
          await store.putApprovalGroup(brief.id, group.ids).catch(() => undefined);
          await joinClarifies(store, group.ids, (id) => bb.realtime.publish(ANSWERED_CHANNEL, { id })).catch(() => undefined);
        }
        await deps.progress?.recordBrief(brief, brief.createdAt).catch(() => undefined);
        // Утверждения впереди нет — рекомендации агента и есть решение: пункты, ответы, журнал и события ложатся сразу.
        if (holdsNothing(brief) && brief.settle === "agent") await deps.decided?.(brief).catch(() => undefined);
        // Бриф, который прогон не держит, запускает работу сразу — рекомендованным прогоном; выбор владельца придёт с Утверждением.
        if (holdsNothing(brief) && stageItems(brief).some((item) => recommendedStageChoice(item).run)) await store.markLaunched(ctx.threadId).catch(() => undefined);
        const kind = awaitingKind(brief);
        if (kind !== null) await store.putAwaiting(brief.threadId, { briefId: brief.id, kind }).catch(() => undefined);
      }
      // Решённые уточнения помечаются вместе с записью брифа: отказ по размеру ничего не закрывает. Открытые виджеты перерисуются строкой.
      if (stored.kind === "stored") {
        const closed = [...new Set(resolves)];
        await Promise.all(closed.map((id) => store.markResolved(id)));
        closed.forEach((id) => bb.realtime.publish(ANSWERED_CHANNEL, { id }));
      }
      if (stored.kind === "stored" && params.outcome !== undefined) deps.emit?.("flow.stage-done", ctx.threadId, { stageId: params.outcome.stage });
      return stored.kind === "stored"
        ? briefResult(brief)
        : toolError(`The brief takes ${stored.bytes} bytes, and storage accepts at most ${KV_VALUE_LIMIT_BYTES} bytes per brief. Split the questions into several briefs.`);
    },
  });

  // Этапы — у flow треда и меняются на странице Flow, поэтому их список идёт вкладом к ходу, а не в неизменных инструкциях инструмента.
  bb.agents.contributeInstructions(({ threadId }) => {
    // Тред без flow Flow не ведёт: ни правила про бриф, ни этапов. Инструмент остаётся, агент зовёт его сам.
    if (deps.hasFlow?.(threadId) === false) return "";
    const limits = deps.limits?.(threadId) ?? null;
    return [flowTurnInstructions(deps.stages?.(threadId).stages ?? []), ...(limits === null ? [] : [limits])].join("\n\n");
  });
};
