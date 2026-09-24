// Инструмент `ask_decision` — единственный способ агента спросить владельца.
// Кладёт бриф в хранилище и возвращает строку директивы, которую агент
// вставляет в ответ; ответ владельца приходит обычной репликой в тред.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import type { Carried } from "../core/carry";
import { awaitingKind } from "../core/awaiting";
import { liveIssues } from "../core/outcome";
import { DECISION_ID_PREFIX, directiveLine } from "../core/directive";
import { FLOW_RULE, SELF_ONLY_RULE, isStageCarryKey, reportIssues, stageInstructions } from "../core/stages";
import { stageKindOf, type BuiltinKind } from "../lib/stage-constants";
import { askDecisionParamsSchema, type AskDecisionParams, type DecisionBrief, type Planning, type StageSettings } from "../shared/contract";
import type { ProgressStore } from "./progress";
import { KV_VALUE_LIMIT_BYTES, type DecisionStore } from "./store";
import type { FlowTrigger } from "./automations";

export const ASK_TOOL_NAME = "ask_decision";

const RULE = `Ask the owner every question, clarification, fork and point of confusion only with the ${ASK_TOOL_NAME} tool — never as prose in your reply. Gather everything that has piled up so far into one brief instead of asking one question per turn. Mark as recommended the option you would pick yourself.`;

export const ASK_INSTRUCTIONS = `${RULE}

A brief has two parts.

setup — the first part: no questions, you show what there is and mark what you recommend.
- stages (setup.stages) — all stages of the thread's flow, in their order; ids and executors are in the Flow instructions for the turn. A stage is { id, state, results, recommended, executor, add, adds }. state: todo or done. A done skill stage needs results — [{ label, target }], label being the file name from target (spec.md) or a task key; built-in stages and todo ones have none. recommended: true — take this todo stage into the run. executor — self or one of the stage's executors (agent:…, workflow:…). add — the stage's own add; adds — the difference per executor id.
- criteria — "Done when", one checkable statement per item: a string, { text, add }, or a change item { text, before, after, add }; send them before you create the task.
- do not send artifacts, executor, checker, testing, budgetTarget or budgetMax: the widget sums the budget forecast from add.

add { target, max, risk, minutes } — dollars (target, ceiling), risk as an integer, minutes; a minus lowers it, max is not below target; stage risk is its change to the work's risk, 1r ≈ 10% chance a blocking defect reaches the owner: implementation raises it, spec, plan, prototype, review and testing lower it (scale: flow skill); the price of the work is on the stages; an item's add is its share inside the stages, not on top of them; an option's add is its difference from the recommended option.

questions — the second part; an id does not start with "setup.".
- fork — one answer, the choice changes the outcome. Every option requires description and add (or the old cost plus risk XS…XXL). At most one recommended.
- pick — several answers. Every option requires description; add if it changes the budget.
- confirm — "did I get this right": exactly one option "Yes", and context says what you understood.
hides on an option — ids of questions below it that lose their meaning when it is chosen: the owner does not see them and you do not get their answers.
criteria on an option — items it adds while chosen; an item of an option the owner drops themselves stays in the list struck through, so an item that depends on one answer goes on the option, not into setup.criteria; removes — setup.criteria indexes it strikes then.
The owner can answer any question in their own words.

outcome — a demo of running work instead of setup: { stage (a demo stage id), final, next (only when not final), done ([text] — closed since the previous demo), pending ([{ text, why }]), notes, tasks ([{ key, done, note }]), results (at least one: { label, target } — a file, path or page URL; { label, command } — a command the owner runs with one click), documentsOnly (only when nothing but documents changed since the previous demo) }. Unless documentsOnly, results hold a live one: an http(s) URL or a command.

After the owner launches work (an answered brief with a stage in the run), setup.stages is accepted only while a stage selection or criteria stage in it is todo, setup.criteria only while a criteria stage is todo.

The owner also chooses where the work runs; a new thread takes the answer over and this thread stops.

Brief kind: brief — you wait for the answer; clarify — one yesno question with "Yes" and "No", no setup, and you continue on your own understanding.

After the call, paste the directive line from the result into your reply as a standalone line, without quotes or backticks. For a brief, end the turn right after it. The answer arrives as "Brief … — answer:" in the owner's language.

One brief per run: go through the run stages in order; on a demo stage, stop with a brief carrying its outcome. Another brief only if it is unclear how to proceed, and only about that.`;

const briefResult = (brief: DecisionBrief): string =>
  `${directiveLine(brief.id)}

Paste the line above into your reply as a standalone line — the owner sees the brief in its place.${
    brief.kind === "brief" ? " Then end the turn and wait for the answer." : " Keep working; the answer arrives along the way."
  }`;

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

/** Итог — про запущенную работу и про этап Демонстрации из flow треда. */
const outcomeIssues = (outcome: AskDecisionParams["outcome"], launched: boolean, stages: StageSettings["stages"]): string[] => {
  if (outcome === undefined) return [];
  if (!launched) return ["an outcome reports a stage of running work, and the work in this thread has not started yet: send a brief with setup.stages first"];
  const demos = stages.filter((stage) => stageKindOf(stage) === "demo").map((s) => s.id);
  return [
    ...(demos.includes(outcome.stage) ? [] : [`outcome.stage ${outcome.stage} is not a demo stage of the thread's flow: ${demos.length === 0 ? "the flow has none" : demos.join(", ")}`]),
    ...liveIssues(outcome),
  ];
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
    /** Идёт ли тред по flow; `false` — владелец выбрал «без flow», и Flow не вкладывает в ход ничего, кроме `chooseFlow`. */
    hasFlow?: (threadId: string) => boolean;
    /** Указание треду без flow выбрать его самому; `null` — выбор агентом выключен. */
    chooseFlow?: (threadId: string) => string | null;
    /** Длительность и стоимость планирования в треде; `undefined` — неизвестно. */
    planning?: (threadId: string) => Promise<Planning | undefined>;
    /** Прогресс flow треда: бриф отмечает ждущие и сделанные этапы. */
    progress?: Pick<ProgressStore, "recordBrief">;
    /** Сообщает Automations о событии Flow; не ждётся и не бросает (./automations.ts). */
    emit?: (trigger: FlowTrigger, threadId: string, context?: { stageId?: string }) => void;
  },
): void => {
  bb.agents.registerTool({
    name: ASK_TOOL_NAME,
    description:
      "Ask the owner: a brief rendered as a widget in the thread. First part (setup) shows the work stages of the thread's flow — done ones with links and ones to run with executor and add — plus done-when criteria and a budget button summed from add with time, recommendations preselected; second part holds questions: forks with description and add, multi-answer picks and confirmations.",
    instructions: ASK_INSTRUCTIONS,
    presentation: { label: { pending: "Preparing a brief", completed: "Brief in the thread" } },
    parameters: askDecisionParamsSchema,
    async execute(params, ctx) {
      const settings = deps.stages?.(ctx.threadId) ?? { stages: [], minButtonWidth: 0 };
      const launched = await store.isLaunched(ctx.threadId);
      const legacy = params.kind === "brief" ? legacyIssues(params.setup) : [];
      const launchedSetup = params.kind === "brief" && launched ? launchedIssues(params.setup, settings.stages) : [];
      const outcomeProblems = outcomeIssues(params.outcome, launched, settings.stages);
      const stageIssues = reportIssues(settings.stages, params.setup?.stages);
      if (launchedSetup.length > 0 || outcomeProblems.length > 0)
        return toolError(`Brief not accepted: ${[...launchedSetup, ...outcomeProblems].join("; ")}.`);
      if (legacy.length > 0 || stageIssues.length > 0)
        return toolError(
          [`Brief not accepted: ${[...legacy, ...stageIssues].join("; ")}.`, ...(stageIssues.length > 0 ? [stageInstructions(settings.stages) ?? "The plugin settings have no stages."] : [])].join("\n\n"),
        );
      const planning = params.kind === "brief" ? await deps.planning?.(ctx.threadId) : undefined;
      const carried = params.kind === "brief" ? carriedInto(params.setup, await store.getThreadCarry(ctx.threadId)) : {};
      const brief: DecisionBrief = {
        ...params,
        id: `${DECISION_ID_PREFIX}${deps.newId()}`,
        threadId: ctx.threadId,
        revocable: true,
        // Бюджет прячется только у брифа запущенной работы без этапов: второй Выбор этапов показывает прогноз.
        ...(launched && params.setup?.stages === undefined ? { launched: true as const } : {}),
        ...(planning === undefined ? {} : { planning }),
        ...(Object.keys(carried).length === 0 ? {} : { carried }),
        ...(params.setup?.stages === undefined && params.outcome === undefined
          ? {}
          : { stages: { list: settings.stages, minButtonWidth: settings.minButtonWidth } }),
        createdAt: deps.now(),
      };
      const stored = await store.putBrief(brief);
      if (stored.kind === "stored") {
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
