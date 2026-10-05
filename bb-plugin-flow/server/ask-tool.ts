// Инструмент `ask_decision` — единственный способ агента спросить владельца.
// Кладёт бриф в хранилище и возвращает строку директивы, которую агент
// вставляет в ответ; ответ владельца приходит обычной репликой в тред.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import type { Carried } from "../core/carry";
import { awaitingKind } from "../core/awaiting";
import { liveIssues, nextFlowIssues } from "../core/outcome";
import { DECISION_ID_PREFIX, directiveLine } from "../core/directive";
import { criterionEditable, money, plannedMinutes, recommendedForecast } from "../core/budget";
import { FLOW_RULE, SELF_ONLY_RULE, isAskedStage, isAutomationStage, isStageCarryKey, reportIssues, stageInstructions, withStepResults } from "../core/stages";
import { isHeadingStage } from "../core/sub-stages";
import { stageKindOf, type BuiltinKind } from "../lib/stage-constants";
import { FORK_ZERO_RULE, OPTION_PRICE_RULE, askDecisionParamsSchema, type AskDecisionParams, type Criterion, type DecisionBrief, type Planning, type RestoredDraft, type StageSettings } from "../shared/contract";
import type { ProgressStore } from "./progress";
import { KV_VALUE_LIMIT_BYTES, type DecisionStore } from "./store";
import type { FlowTrigger } from "./automations";

export const ASK_TOOL_NAME = "ask_decision";

const RULE = `Ask the owner every question, clarification, fork and point of confusion only with the ${ASK_TOOL_NAME} tool — never as prose in your reply. Gather everything that has piled up so far into one brief instead of asking one question per turn. Mark as recommended the option you would pick yourself.`;

export const ASK_INSTRUCTIONS = `${RULE}

A brief has two parts.

scope — what you understood: the minimal work, each fork at its simplest answer, as a nested list; every brief before launch starts with it.

setup — the first part: no questions; show what there is and mark what you recommend.
- criteria — "Done when", one checkable statement per item: { text, add } or { text, before, after, add }, scope items first. add { target, max, risk, minutes } — what one agent on the current model and effort spends, target and minutes > 0; kept items are the base.
- stages (setup.stages) — all stages of the flow, in order (Flow instructions): { id, state (todo, done), results, recommended, executor, share, factors }. A done skill stage needs results [{ label, target }], label = file name or task key. recommended: true — into the run. executor — self or the stage's agent:…/workflow:…. share { percent, risk } on every todo skill stage — its part of the scope (the work itself 100, a spec ~15); factors { <executor id>: { factor, risk } } — multiplier > 0, you are 1. No add or adds on stages.

The budget forecast: scope = base + chosen options; a run stage costs scope × percent × factor; without a 100 stage the scope counts once, stages on top. Risk: integer, 1r ≈ 10% chance a blocking defect reaches the owner; implementation raises it, spec, plan, prototype, review and testing lower it (scale: flow skill). Refused before launch: no scope, unpriced item, skill stage without share, fork without 0, $0 forecast.

questions — the second part; an id does not start with "setup.".
- fork — one answer, the choice changes the outcome. Every option requires description and add (or old cost + risk XS…XXL). The simplest option costs 0, its work in setup.criteria; others: add = price of own criteria ≥ 0, replaced items in removes. At most one recommended.
- pick — several answers. Every option requires description; add if it adds work.
- confirm — "did I get this right" on what scope leaves open: one "Yes"; context — not scope retold.
hides on an option — ids of questions below that lose meaning when it is chosen; the owner does not see them.
criteria on an option — items it adds while chosen, required if priced; an item of an option the owner drops themselves stays in the list struck through, so an item that depends on one answer goes on the option, not into setup.criteria; removes — setup.criteria indexes it strikes then.
The owner may answer any question in own words.

outcome — a demo of running work instead of setup: { stage (a demo stage id), final, next (only when not final), done ([text] — closed since the previous demo), pending ([{ text, why }]), notes, tasks ([{ key, done, note }]), results (at least one: { label, target } — a file, path or URL; { label, command } — a command run in one click), documentsOnly (only documents changed since the previous demo) }. Unless documentsOnly, results hold a live one: an http(s) URL or a command.

After launch (an answered brief with a stage in the run), setup.stages is accepted only while a stage selection or criteria stage is todo, setup.criteria only while a criteria stage is todo.

The owner also chooses where the work runs; a new thread takes the answer over and this thread stops.

Brief kind: brief — you wait for the answer; clarify — one yesno question with "Yes" and "No", no setup; you continue on your own understanding.

After the call, paste the directive line from the result into your reply as a standalone line, without quotes or backticks. For a brief, end the turn right after it. The answer arrives as "Brief … —" in the owner's language.

One brief per run: go through the run stages in order; on a demo stage, stop with a brief carrying its outcome. Another brief only if it is unclear how to proceed, and only about that.`;

/**
 * Сообщение владельца в чат при ждущем брифе возвращает бриф агенту (./brief-return.ts). В описании инструмента, а не в
 * инструкциях: те уже упираются в 4096 символов.
 */
export const RETURNED_RULE =
  "A chat message from the owner while your brief waits returns that brief to you: the message outranks the brief — it means the plan changed. Take the message in, its text and attachments, then send the brief again, revised; the owner's choices in the returned brief stay preselected where question and option ids match. A stage closes only when the owner sends a brief with its button.";

const briefResult = (brief: DecisionBrief): string =>
  `${directiveLine(brief.id)}

Paste the line above into your reply as a standalone line — the owner sees the brief in its place.${
    brief.kind === "brief" ? " Then end the turn and wait for the answer." : " Keep working; the answer arrives along the way."
  }${brief.restored === undefined ? "" : " The owner's choices from the returned brief are preselected where question and option ids match."}`;

/**
 * Черновик брифа, который владелец вернул сообщением в чат, — для нового брифа треда, вместе с пунктами возвращённого:
 * правки пунктов ложатся на новый бриф по тексту. Черновика нет — возвращать нечего, указатель снимет новый бриф.
 */
const restoredFrom = async (store: DecisionStore, threadId: string): Promise<{ briefId: string; restored?: RestoredDraft } | null> => {
  const briefId = await store.getThreadReturned(threadId);
  if (briefId === null) return null;
  const [draft, old] = await Promise.all([store.getDraft(briefId), store.getBrief(briefId)]);
  // Бриф взамен возвращённого вернули снова, не тронув: его выбор — тот, что он сам принёс.
  if (draft === null) return old?.restored === undefined ? { briefId } : { briefId, restored: old.restored };
  const criteria = old?.setup?.criteria?.map(criterionEditable);
  return { briefId, restored: { draft, ...(criteria === undefined ? {} : { criteria }) } };
};

/** Перенос треда — только этапы, которые агент прислал в setup нового брифа: исполнителя, ревью и тестирования прежнего вида инструмент не принимает. */
const carriedInto = (setup: AskDecisionParams["setup"], carried: Carried): Record<string, string[]> => {
  const stageIds = (setup?.stages ?? []).map((s) => s.id);
  return Object.fromEntries(Object.entries(carried).filter(([key]) => isStageCarryKey(key, stageIds)).map(([key, ids]) => [key, [...ids]]));
};

/**
 * Первая часть брифа после запуска работы — и виды этапов, пока несделанный из которых её ещё можно прислать:
 * этапы — при втором Выборе этапов или Критериях посреди flow (критерий сдаётся вместе с отчётом), критерий — при Критериях.
 */
const LAUNCHED_SETUP = [
  ["stages", ["select", "criteria"]],
  ["criteria", ["criteria"]],
] as const satisfies ReadonlyArray<readonly ["stages" | "criteria", readonly BuiltinKind[]]>;

const launchedIssues = (setup: AskDecisionParams["setup"], stages: StageSettings["stages"]): string[] => {
  const openKind = (kinds: readonly BuiltinKind[]) =>
    (setup?.stages ?? []).some((r) => r.state === "todo" && stages.some((s) => s.id === r.id && kinds.includes(stageKindOf(s) as BuiltinKind)));
  const sent = LAUNCHED_SETUP.filter(([key, kinds]) => setup?.[key] !== undefined && !openKind(kinds)).map(([key]) => key);
  return sent.length === 0
    ? []
    : [
        `setup.${sent.join(", setup.")} are not accepted here: the work in this thread is already launched — send them only while a todo stage selection or criteria stage stands in setup.stages; otherwise ask only questions, or send a demo outcome`,
      ];
};

/** Итог — про запущенную работу и про этап Демонстрации из flow треда; flow без Вопросов, Критериев и Выбора этапов запуска не ждёт. */
const outcomeIssues = (outcome: AskDecisionParams["outcome"], launched: boolean, stages: StageSettings["stages"], flowIds: readonly string[]): string[] => {
  if (outcome === undefined) return [];
  if (!launched && stages.some(isAskedStage)) return ["an outcome reports a stage of running work, and the work in this thread has not started yet: send a brief with setup.stages first"];
  const demos = stages.filter((stage) => stageKindOf(stage) === "demo").map((s) => s.id);
  return [
    ...(demos.includes(outcome.stage) ? [] : [`outcome.stage ${outcome.stage} is not a demo stage of the thread's flow: ${demos.length === 0 ? "the flow has none" : demos.join(", ")}`]),
    ...liveIssues(outcome),
    ...nextFlowIssues(outcome, flowIds),
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

/** Цена пункта «Готово, когда» — деньги и минуты одного агента; без неё база брифа нулевая. */
const pricedItem = (item: Criterion): boolean => typeof item !== "string" && item.add !== undefined && item.add.target > 0 && (item.add.minutes ?? 0) > 0;

/** Бюджет считается у незапущенного брифа, в котором решается работа; уточнение, итог Демонстрации и вопрос посреди работы его не считают. */
const decidesBudget = (params: Pick<AskDecisionParams, "kind" | "outcome">, launched: boolean): boolean => params.kind === "brief" && !launched && params.outcome === undefined;

/** База бюджета: «Что я понял», цена у каждого пункта «Готово, когда», пункты у варианта с ценой, доля у несделанного этапа-навыка. Ошибки идут в общий отказ брифа. */
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
      ? ["setup.criteria is missing: the done-when items are the base of the budget, each with add { target, max, risk, minutes } — what one agent on the current model and effort spends on it"]
      : []),
    ...(unpriced.length === 0 ? [] : [`setup.criteria items ${unpriced.join(", ")} have no price: each item needs add with target and minutes above zero — what one agent on the current model and effort spends on it`]),
    ...(unshared.length === 0 ? [] : [`stages ${unshared.join(", ")} have no share: a todo skill stage sends share { percent, risk } — implementation by you is 100`]),
    ...bareOptionIssues(params.questions),
    ...zeroOptionIssues(params.questions),
  ];
};

/**
 * Вариант с ценой — работа, которую принимают, значит у него свои пункты «Готово, когда».
 * Без них пункт, зависящий от ответа, оседает в общем списке, и отметка варианта список не меняет.
 */
const bareOptionIssues = (questions: AskDecisionParams["questions"]): string[] => {
  const bare = questions.flatMap((q) => q.options.filter((o) => (o.add?.target ?? 0) > 0 && o.criteria === undefined).map((o) => `${q.id}/${o.id}`));
  return bare.length === 0
    ? []
    : [
        `options ${bare.join(", ")} add work without done-when items: an option priced above zero sends criteria — the items it adds while chosen; move the items that depend on this answer from setup.criteria onto the option`,
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

const toolError = (text: string) => ({ isError: true as const, content: [{ type: "text" as const, text }] });

/** Вклад Flow в ход треда с flow: правило брифа и этапы flow. Его же отдаёт выбор flow агентом — этапы нужны в том же ходе. */
export const flowTurnInstructions = (stages: StageSettings["stages"]): string => {
  const listed = stageInstructions(stages);
  return [RULE, ...(listed === null ? [] : [FLOW_RULE, listed, SELF_ONLY_RULE])].join("\n\n");
};

export const registerAskTool = (
  bb: Pick<BbPluginApi, "agents">,
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
    /** Идёт ли тред по flow; `false` — «без flow» или «Автоматически» до выбора агентом, и Flow не вкладывает в ход ничего, кроме `chooseFlow`. */
    hasFlow?: (threadId: string) => boolean;
    /** Указание треду с «Автоматически» выбрать flow самому; `null` — тред не ждёт выбора агентом. */
    chooseFlow?: (threadId: string) => string | null;
    /** Длительность и стоимость планирования в треде; `undefined` — неизвестно. */
    planning?: (threadId: string) => Promise<Planning | undefined>;
    /** Прогресс flow треда: бриф отмечает ждущие и сделанные этапы. */
    progress?: Pick<ProgressStore, "recordBrief" | "get">;
    /** Сообщает Automations о событии Flow; не ждётся и не бросает (./automations.ts). */
    emit?: (trigger: FlowTrigger, threadId: string, context?: { stageId?: string }) => void;
  },
): void => {
  bb.agents.registerTool({
    name: ASK_TOOL_NAME,
    description:
      "Ask the owner: a brief rendered as a widget in the thread. It opens with scope — what you understood; first part (setup) shows the work stages of the thread's flow — done ones with links and ones to run with executor, share and factors — plus done-when criteria priced by one agent and a budget button counted from them with time, recommendations preselected; second part holds questions: forks with description and add, multi-answer picks and confirmations. " +
      'Every text field takes markdown links [text](target) — a path from the tree root (path:12 for a line), an absolute path or a URL: anything that lives in a file is named as a link to it, a fragment as one link "fragment (what it is) — file". ' +
      RETURNED_RULE,
    instructions: ASK_INSTRUCTIONS,
    presentation: { label: { pending: "Preparing a brief", completed: "Brief in the thread" } },
    parameters: askDecisionParamsSchema,
    async execute(params, ctx) {
      const settings = deps.stages?.(ctx.threadId) ?? { stages: [], minButtonWidth: 0 };
      const launched = await store.isLaunched(ctx.threadId);
      const legacy = params.kind === "brief" ? legacyIssues(params.setup) : [];
      const launchedSetup = params.kind === "brief" && launched ? launchedIssues(params.setup, settings.stages) : [];
      const outcomeProblems = outcomeIssues(params.outcome, launched, settings.stages, deps.flowIds?.() ?? []);
      const stageIssues = [...missingStagesIssues(params, launched, settings.stages), ...reportIssues(settings.stages, params.setup?.stages)];
      const base = baseIssues(params, launched, settings.stages);
      if (launchedSetup.length > 0 || outcomeProblems.length > 0)
        return toolError(`Brief not accepted: ${[...launchedSetup, ...outcomeProblems].join("; ")}.`);
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
      const approvedBudget = midWork && params.setup?.stages === undefined ? ((await deps.progress?.get(ctx.threadId))?.planned ?? null) : null;
      // Ссылки сделанной автоматизации — из её шагов: агент их не присылает.
      const stepped = withStepResults(settings.stages, params.setup?.stages, params.setup?.stages === undefined ? null : ((await deps.progress?.get(ctx.threadId)) ?? null));
      const brief: DecisionBrief = {
        ...params,
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
          : { stages: { list: settings.stages, minButtonWidth: settings.minButtonWidth, ...(flowName === undefined ? {} : { flowName }) } }),
        createdAt: deps.now(),
      };
      const zero = zeroForecastIssues(brief, launched);
      if (zero.length > 0) return toolError(`Brief not accepted: ${zero.join("; ")}.`);
      const stored = await store.putBrief(brief);
      if (stored.kind === "stored") {
        if (returned !== null) {
          // Черновик уехал в новый бриф: у возвращённого его больше никто не спросит.
          await store.clearThreadReturned(ctx.threadId, returned.briefId).catch(() => undefined);
          await store.dropDraft(returned.briefId).catch(() => undefined);
        }
        await deps.progress?.recordBrief(brief, brief.createdAt).catch(() => undefined);
        const kind = awaitingKind(brief);
        if (kind !== null) await store.putAwaiting(brief.threadId, { briefId: brief.id, kind }).catch(() => undefined);
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
    if (deps.hasFlow?.(threadId) === false) return deps.chooseFlow?.(threadId) ?? "";
    return flowTurnInstructions(deps.stages?.(threadId).stages ?? []);
  });
};
