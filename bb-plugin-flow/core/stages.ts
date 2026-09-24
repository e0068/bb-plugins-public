// Этапы работ в брифе: снимок настроек и отчёт агента сводятся к тому, что
// показывает кнопка этапа, что считается выбором по умолчанию, что стоит
// выбранный исполнитель и что уходит в следующий бриф треда. Нужно и
// серверу, и виджету, поэтому из контракта берутся только типы.
import type { Locale } from "../lib/i18n";
import { messages } from "../lib/messages";
import { isDefaultName, SELF_EXECUTOR, stageKindOf, stageSkillOf, type BuiltinKind } from "../lib/stage-constants";
import { actionInstruction, automationInstruction } from "./automation-run";
import type { Add, DecisionAnswer, DecisionBrief, StageAnswer, StageReport, WorkStage } from "../shared/contract";
import { sumAdds } from "./adds";

/** Id исполнителя «сам». */
export const SELF = SELF_EXECUTOR;

/** Строка этапа в списке открытых вопросов ответа. */
export const stageRowId = (stageId: string): string => `setup.stage.${stageId}`;

export type StageItem = { stage: WorkStage; report: StageReport | undefined };

export type StagePhase = StageReport["state"];

/** Что владелец решает по несделанному этапу: брать ли в прогон и кто исполняет. */
export type StageChoice = { run: boolean; executor: string };

/** Встроенные виды, которые бриф спрашивает у владельца до работы. */
const ASKED: readonly BuiltinKind[] = ["questions", "criteria", "select"];

/** Этапы, на которые бриф отвечает сам: ведущий ряд несделанных Вопросов, Критериев и Выбора этапов в отчёте. */
export const askedStageIds = (brief: DecisionBrief): string[] => {
  const list = brief.stages?.list ?? [];
  const todo = (brief.setup?.stages ?? []).filter((r) => r.state === "todo");
  const asked = (id: string) => {
    const stage = list.find((s) => s.id === id);
    return stage !== undefined && (ASKED as readonly string[]).includes(stageKindOf(stage));
  };
  const firstOther = todo.findIndex((r) => !asked(r.id));
  return (firstOther === -1 ? todo : todo.slice(0, firstOther)).map((r) => r.id);
};

/**
 * Этапы брифа в порядке снимка настроек, каждый со своим отчётом агента.
 * Этап, на который бриф отвечает сам, показавшись владельцу, пройден — он стоит сделанным.
 * У брифа с итогом этапа снимок нужен только ради названия этапа — кнопок этапов в нём нет.
 */
export const stageItems = (brief: DecisionBrief): StageItem[] => {
  if (brief.outcome !== undefined) return [];
  const asked = askedStageIds(brief);
  return (brief.stages?.list ?? []).map((stage) => {
    const report = brief.setup?.stages?.find((r) => r.id === stage.id);
    return { stage, report: report !== undefined && asked.includes(stage.id) ? { ...report, state: "done" as const, recommended: false } : report };
  });
};

/** Этап без отчёта агента не сделан. */
export const stagePhase = (item: StageItem): StagePhase => item.report?.state ?? "todo";

export const knownExecutor = (stage: WorkStage, id: string): boolean => id === SELF || stage.executors.some((e) => e.id === id);

/** Исполнитель словами: «Сам», «planner · opus», «DEV2». */
export const executorLabel = (stage: WorkStage, id: string, locale?: Locale): string => {
  if (id === SELF) return messages(locale).stages.self;
  const executor = stage.executors.find((e) => e.id === id);
  return executor === undefined ? id : executor.model === undefined ? executor.name : `${executor.name} · ${executor.model}`;
};

const carryKey = (stageId: string): string => `stage:${stageId}:executor`;

/** Рекомендация агента: в прогон и его исполнитель, если он ещё есть в этапе. */
export const recommendedStageChoice = (item: StageItem): StageChoice => {
  const executor = item.report?.executor ?? SELF;
  return {
    run: stagePhase(item) === "todo" && item.report?.recommended === true,
    executor: knownExecutor(item.stage, executor) ? executor : SELF,
  };
};

/** Выбор при открытии брифа: рекомендация, поверх неё — исполнитель, которого владелец выбрал сам в прошлом брифе треда. */
export const initialStageChoice = (brief: DecisionBrief, item: StageItem): StageChoice => {
  const recommended = recommendedStageChoice(item);
  const executor = (brief.carried ?? {})[carryKey(item.stage.id)]?.[0];
  return { run: recommended.run, executor: executor !== undefined && knownExecutor(item.stage, executor) ? executor : recommended.executor };
};

export const stageAnswerOf = (answer: DecisionAnswer, stageId: string): StageAnswer | undefined => answer.stages?.find((s) => s.id === stageId);

/** Выбор по этапу в ответе; этап без записи в ответе стоит на выборе по умолчанию. */
export const answeredStageChoice = (brief: DecisionBrief, answer: DecisionAnswer, item: StageItem): StageChoice => {
  const entry = stageAnswerOf(answer, item.stage.id);
  return entry === undefined ? initialStageChoice(brief, item) : { run: entry.run, executor: entry.executor };
};

/** Этап-автоматизацию исполняет сам Flow, без модели и без агента: выбирать в ней нечего и стоить она не может. */
export const isAutomationStage = (stage: Pick<WorkStage, "automation">): boolean => stage.automation !== undefined;

/** Добавка этапа с исполнителем: своя добавка этапа плюс разница исполнителя; у автоматизации добавки нет, что бы ни прислал агент. */
export const stageAdd = (item: StageItem, executor: string): Add | undefined =>
  isAutomationStage(item.stage) ? undefined : sumAdds([item.report?.add, executor === SELF ? undefined : item.report?.adds?.[executor]]);

/**
 * Что из выбора по этапу уходит в следующий бриф треда: исполнитель, которого владелец менял сам,
 * и перенесённый из прошлого брифа, если владелец его оставил, — иначе выбор жил бы ровно один бриф.
 */
export const stageCarryOf = (brief: DecisionBrief, answer: DecisionAnswer): Record<string, string[]> => {
  const stages = brief.stages?.list ?? [];
  const carried = brief.carried ?? {};
  const kept = (key: string, value: string, picked: boolean): Array<[string, string[]]> => (picked || carried[key]?.[0] === value ? [[key, [value]]] : []);
  return Object.fromEntries(
    (answer.stages ?? []).flatMap((entry): Array<[string, string[]]> => {
      const stage = stages.find((s) => s.id === entry.id);
      if (stage === undefined) return [];
      return knownExecutor(stage, entry.executor) ? kept(carryKey(entry.id), entry.executor, entry.picked?.includes("executor") === true) : [];
    }),
  );
};

/** Ключ переноса относится к этапу брифа. */
export const isStageCarryKey = (key: string, stageIds: readonly string[]): boolean => stageIds.some((id) => key === carryKey(id));

const idList = (ids: readonly string[]): string => (ids.length === 0 ? "—" : ids.join(", "));

/** Отчёты агента против настроек: все этапы по разу и в порядке настроек, исполнители и добавки — из этапа. */
export const reportIssues = (stages: readonly WorkStage[], reports: readonly StageReport[] | undefined): string[] => {
  if (reports === undefined) return [];
  const expected = stages.map((s) => s.id);
  if (expected.length === 0) return ["the plugin settings have no work stages — do not send setup.stages"];
  const got = reports.map((r) => r.id);
  const order =
    got.length === expected.length && got.every((id, i) => id === expected[i])
      ? []
      : [`setup.stages — every settings stage once, in its order: ${idList(expected)}; sent: ${idList(got)}`];
  const executors = reports.flatMap((r) => {
    const stage = stages.find((s) => s.id === r.id);
    if (stage === undefined) return [];
    const allowed = idList([SELF, ...stage.executors.map((e) => e.id)]);
    // Встроенные этапы сдаются в самом брифе — ссылаться у них не на что; этап навыка сдаётся ссылками.
    const unlinked = r.state !== "todo" && r.results === undefined && stageKindOf(stage) === "skill";
    return [
      ...(unlinked ? [`stage ${r.id}: a ${r.state} skill stage needs results with links`] : []),
      ...(knownExecutor(stage, r.executor) ? [] : [`stage ${r.id}: executor ${r.executor} is not one of the stage's — ${allowed}`]),
      ...Object.keys(r.adds ?? {})
        .filter((key) => key === SELF || !stage.executors.some((e) => e.id === key))
        .map((key) => `stage ${r.id}: adds for ${key} — the stage has no such executor, adds only for ${idList(stage.executors.map((e) => e.id))}`),
    ];
  });
  return [...order, ...executors];
};

/** Чем встроенный этап отвечает владельцу в этом треде; что он делает — в его навыке. */
const BUILTIN_ANSWERS: Record<BuiltinKind, string> = {
  questions: "ask the owner with ask_decision",
  criteria: "send setup.criteria through ask_decision",
  select: "send setup.stages through ask_decision",
  demo: "stop and send a brief with outcome through ask_decision (outcome.stage — this id)",
};

/** Правило треда с flow: владелец видит работу этапами, а не прозой. */
export const FLOW_RULE =
  "This thread runs a flow: talk to the owner only through its stages — a brief for questions, criteria and stage selection (consecutive ones go into one brief), a brief with outcome for a demo. For anything the stages do not cover, ask a clarify brief.";

/**
 * Исполнитель «Сам» для агента: этап ведётся в его сессии, без помощников.
 * Перехватить вызов субагента плагин не может, поэтому нужду в нём агент
 * заявляет заранее — в брифе, пока владелец выбирает исполнителя.
 */
export const SELF_ONLY_RULE =
  "self means you do the stage's work in your own session: no subagents and no workflows; if you think a stage needs one, say so up front in the stage-selection brief: recommend that executor in setup.stages, or, when the stage has no such executor, name the need in the brief's intro.";

/** Правило треда без flow, когда flow выбирает агент: сперва flow, потом работа. */
export const CHOOSE_FLOW_RULE = (skill: string, tool: string, noFlow: string): string =>
  `This thread has no flow yet, and the owner lets you choose one. Before any other work, load the skill \`${skill}\` — it lists the owner's flows and when to pick each — and call \`${tool}\` with the id of the flow that fits the request. Its answer lists the stages of that flow; follow them from the first one. If no flow fits, call \`${tool}\` with \`${noFlow}\` and work without a flow.`;

/** Название этапа на экране: свой и переименованный владельцем встроенный — как назван, встроенный с именем по умолчанию — по виду и языку интерфейса. */
export const stageLabel = (stage: Pick<WorkStage, "id" | "name" | "kind">, names: Readonly<Partial<Record<BuiltinKind | "action", string>>>): string => {
  const kind = stageKindOf(stage);
  return kind === "skill" || !isDefaultName(stage) ? stage.name : (names[kind] ?? stage.name);
};

/** Этапы настроек строкой для инструкций агенту; без этапов — `null`. */
export const stageInstructions = (stages: readonly WorkStage[]): string | null =>
  stages.length === 0
    ? null
    : [
        "Work stages in the Flow settings — send all of them in setup.stages, in this order:",
        ...stages.map((s, i) => {
          const kind = stageKindOf(s);
          if (kind === "action") return actionInstruction(s, i);
          if (kind !== "skill") return `${i + 1}. ${s.id} "${s.name}" — skill ${stageSkillOf(s)}: load it for the stage's work; ${BUILTIN_ANSWERS[kind]}; you execute it yourself, a done stage needs no results`;
          if (s.automation !== undefined) return automationInstruction(s, i);
          const executors = s.executors.length === 0 ? "you execute it yourself" : `executors: self, ${s.executors.map((e) => e.id).join(", ")}`;
          // Названного навыка мало: агент дойдёт до этапа и уйдёт работать, не
          // прочитав его, — поэтому этап-навык, как и встроенный, велит его загрузить.
          const skill = s.skill === "" ? "" : ` — skill ${s.skill}: load it for the stage's work`;
          return `${i + 1}. ${s.id} "${s.name}"${skill}; ${executors}`;
        }),
      ].join("\n");
