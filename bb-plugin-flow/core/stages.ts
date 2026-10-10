// Этапы работ в брифе: снимок настроек и отчёт агента сводятся к тому, что
// показывает кнопка этапа, что считается выбором по умолчанию, что стоит
// выбранный исполнитель и что уходит в следующий бриф треда. Нужно и
// серверу, и виджету, поэтому из контракта берутся только типы.
import type { Locale } from "../lib/i18n";
import { messages } from "../lib/messages";
import { currentName, isDefaultName, SELF_EXECUTOR, stageKindOf, stageSkillOf, type BuiltinKind } from "../lib/stage-constants";
import { ACTION_TAIL, AUTOMATION_TAIL } from "./automation-run";
import { hasMainAgent } from "./stage-execution";
import { isHeadingStage, stageNumbers } from "./sub-stages";
import type { Add, DecisionAnswer, DecisionBrief, Flow, FlowProgress, StageAnswer, StageReport, WorkStage } from "../shared/contract";
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

/** Этап, который бриф спрашивает у владельца до работы: flow без таких этапов запуска не ждёт. */
export const isAskedStage = (stage: Pick<WorkStage, "id" | "kind">): boolean => (ASKED as readonly string[]).includes(stageKindOf(stage));

/** Этапы, на которые бриф отвечает сам: ведущий ряд несделанных Вопросов, Definition of Done и Выбора этапов в отчёте. */
export const askedStageIds = (brief: DecisionBrief): string[] => {
  const list = brief.stages?.list ?? [];
  const todo = (brief.setup?.stages ?? []).filter((r) => r.state === "todo");
  const asked = (id: string) => {
    const stage = list.find((s) => s.id === id);
    return stage !== undefined && isAskedStage(stage);
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

/** Кому владелец может отдать этап: Main Agent, если не снят, и исполнители этапа. */
export const stageExecutorIds = (stage: WorkStage): string[] => [...(hasMainAgent(stage) ? [SELF] : []), ...stage.executors.map((e) => e.id)];

export const knownExecutor = (stage: WorkStage, id: string): boolean => stageExecutorIds(stage).includes(id);

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
    executor: knownExecutor(item.stage, executor) ? executor : (stageExecutorIds(item.stage)[0] ?? SELF),
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

const cents = (n: number): number => Math.round(n * 100) / 100;

/** Доля объёма: деньги и минуты — объём × процент × множитель, риск — этапа плюс исполнителя; без объёма — только риск. */
const sharePrice = (share: NonNullable<StageReport["share"]>, factor: { factor: number; risk: number }, scope: Add | undefined): Add => {
  const k = (share.percent / 100) * factor.factor;
  const risk = share.risk + factor.risk;
  if (scope === undefined) return { target: 0, max: 0, risk };
  return { target: cents(scope.target * k), max: cents(scope.max * k), risk, ...(scope.minutes === undefined ? {} : { minutes: Math.round(scope.minutes * k) }) };
};

const SELF_FACTOR = { factor: 1, risk: 0 } as const;

/**
 * Цена этапа с исполнителем. Этап с долей — доля объёма работы с множителем исполнителя (сам агент — ×1);
 * этап брифа, записанного раньше, — своя добавка в долларах плюс разница исполнителя. У автоматизации цены нет, что бы ни прислал агент.
 */
export const stageAdd = (item: StageItem, executor: string, scope?: Add): Add | undefined => {
  if (isAutomationStage(item.stage)) return undefined;
  const share = item.report?.share;
  if (share !== undefined) return sharePrice(share, executor === SELF ? SELF_FACTOR : (item.report?.factors?.[executor] ?? SELF_FACTOR), scope);
  return sumAdds([item.report?.add, executor === SELF ? undefined : item.report?.adds?.[executor]]);
};

/** Доля этапа самой работы — весь объём. */
const WORK_PERCENT = 100;

const isWorkStage = (item: StageItem): boolean => (item.report?.share?.percent ?? 0) >= WORK_PERCENT;

const minus = (a: Add, b: Add): Add => ({ target: cents(a.target - b.target), max: cents(a.max - b.max), risk: a.risk - b.risk, ...(a.minutes === undefined ? {} : { minutes: a.minutes - (b.minutes ?? 0) }) });

/**
 * Надбавка этапа к итогу брифа. Этап самой работы у Main Agent — база, её уже называют пункты Definition of Done:
 * он не прибавляет ничего, другой исполнитель — только разницу против Main Agent. Остальные этапы прибавляют свою цену.
 */
export const stageSurcharge = (item: StageItem, executor: string, scope?: Add): Add | undefined => {
  const price = stageAdd(item, executor, scope);
  const base = isWorkStage(item) ? stageAdd(item, SELF, scope) : undefined;
  return price === undefined || base === undefined ? price : minus(price, base);
};

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

/**
 * Отчёты брифа с итогами шагов: сделанная автоматизация и этап Action показывают ссылки, которые оставили их шаги, —
 * агент их не присылает. Шаги ничего не оставили — остаются ссылки агента, если он их прислал.
 */
export const withStepResults = (stages: readonly WorkStage[], reports: readonly StageReport[] | undefined, progress: FlowProgress | null): StageReport[] | undefined =>
  reports?.map((r) => {
    const stage = stages.find((s) => s.id === r.id);
    const results = progress?.stages[r.id]?.results?.map(({ label, target }) => ({ label, target })) ?? [];
    return r.state === "done" && stage !== undefined && isAutomationStage(stage) && results.length > 0 ? { ...r, results } : r;
  });

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
    const allowed = idList(stageExecutorIds(stage));
    // Встроенные этапы сдаются в самом брифе — ссылаться у них не на что; этап навыка сдаётся ссылками,
    // а ссылки автоматизации дают её шаги — их подставляет сам Flow (withStepResults).
    // Заголовку ссылаться не на что: его работу сдают под-этапы.
    const unlinked = r.state !== "todo" && r.results === undefined && stageKindOf(stage) === "skill" && !isAutomationStage(stage) && !isHeadingStage(stages, stage);
    return [
      ...(unlinked ? [`stage ${r.id}: a ${r.state} skill stage needs results with links`] : []),
      ...(knownExecutor(stage, r.executor) ? [] : [`stage ${r.id}: executor ${r.executor} is not one of the stage's — ${allowed}`]),
      ...Object.keys(r.adds ?? {})
        .filter((key) => !stage.executors.some((e) => e.id === key))
        .map((key) => `stage ${r.id}: adds for ${key} — the stage has no such executor, adds only for ${idList(stage.executors.map((e) => e.id))}`),
      ...Object.keys(r.factors ?? {})
        .filter((key) => !stage.executors.some((e) => e.id === key))
        .map((key) => `stage ${r.id}: factors for ${key} — the stage has no such executor, factors only for ${idList(stage.executors.map((e) => e.id))}`),
    ];
  });
  return [...order, ...executors];
};

/** Чем встроенный этап отвечает владельцу в этом треде; что он делает — в его навыке. */
const BUILTIN_ANSWERS: Record<BuiltinKind, string> = {
  questions: "ask the owner with ask_decision",
  criteria: "send setup.criteria through ask_decision",
  select: "send setup.stages through ask_decision",
  demo: "stop and send a brief with outcome through ask_decision (outcome.stage — this id); on a comment answer it: if it asks for a change, roll back to the stage where the change is made (flow_stage) and go through the stages again in order up to this demo; without a change, send this demo again, not going further",
  approve:
    "the only stage that holds the work: stop and send a brief with outcome through ask_decision (outcome.stage — this id) — right after the widgets of the stages before it, or, after a skill stage, with sections: what earlier approvals approved, what you did since the last one, what you will do next; Approve without a comment — go on to the next stage; a comment — not approved: rework the stage before this approval as the comment asks (roll back to it with flow_stage when it is done) and send this approval again",
};

/** Правило треда с flow: владелец видит работу этапами, а не прозой. */
export const FLOW_RULE =
  "This thread runs a flow: talk to the owner only through its stages — a brief for questions, Definition of Done and stage selection (consecutive ones go into one brief), a brief with outcome for a demo or an approval. Only an approval stage holds the work: a comment anywhere else does not stop you — ask about what is unclear and carry on with what is clear. For anything the stages do not cover, ask a clarify brief. Around a brief's directive line write at most one sentence — do not retell the brief.";

/**
 * Исполнитель «Сам» для агента: этап ведётся в его сессии, без помощников.
 * Перехватить вызов субагента плагин не может, поэтому нужду в нём агент
 * заявляет заранее — в брифе, пока владелец выбирает исполнителя.
 */
export const SELF_ONLY_RULE =
  "self means you do the stage's work in your own session: no subagents and no workflows; if you think a stage needs one, say so up front in the stage-selection brief: recommend that executor in setup.stages, or, when the stage has no such executor, name the need in the brief's intro.";

/** Выбор агента — «Без flow» и flow владельца с описаниями «когда выбирать». */
type FlowChoices = { flows: readonly Flow[]; noFlowDescription?: string | undefined };

/** Пункт выбора блоком: описание многострочное, со своими списками, и без заголовка слилось бы со следующим пунктом. */
const choiceBlock = (name: string, idLine: string, description: string | undefined): string => `### ${name}\n\n${idLine}\n\n${description ?? "No description."}`;

/** Пункты выбора: «Без flow» первым, чтобы агент сперва прочёл, когда flow не нужен, потом flow по порядку. */
const choiceBlocks = ({ flows, noFlowDescription }: FlowChoices, noFlowIdLine: string): string[] => [
  choiceBlock("No flow", noFlowIdLine, noFlowDescription),
  ...flows.map((flow) => choiceBlock(flow.name, `id: \`${flow.id}\``, flow.description)),
];

/** Правило треда с выбором «Автоматически»: сперва flow по описаниям со страницы Flow, потом работа. */
export const CHOOSE_FLOW_RULE = (choices: FlowChoices, tool: string, noFlow: string): string =>
  [
    `This thread has no flow yet, and the owner lets you choose one. Before any other work, compare the request with the owner's choices below — first when no flow is needed, then the flows — and call \`${tool}\` with the id of the choice that fits. A flow's answer lists its stages; follow them from the first one. If no flow is needed or none of the flows fits, call \`${tool}\` with \`${noFlow}\` and work without a flow.`,
    ...choiceBlocks(choices, `id: \`${noFlow}\``),
  ].join("\n\n");

/**
 * Правило треда, который агент оставил без flow (и его детей): тот же выбор каждый ход — разговор без flow доходит до работы,
 * и агент назначает flow сам, не дожидаясь просьбы владельца. «Без flow» уже стоит — его id агенту не нужен.
 */
export const CHOOSE_FLOW_AGAIN_RULE = (choices: FlowChoices, tool: string): string =>
  [
    `This thread runs without a flow by an agent's choice, and the owner still lets you choose one. Before working on each owner message, compare it with the choices below — first when no flow is needed, then the flows. While no flow is needed or none of the flows fits, work without a flow and do not call \`${tool}\`. Once the conversation comes to work that a flow fits, call \`${tool}\` with that flow's id before any other work and follow its stages from the first one.`,
    ...choiceBlocks(choices, "This thread's current choice."),
  ].join("\n\n");

/** Название этапа на экране: свой и переименованный владельцем встроенный — как назван, встроенный с именем по умолчанию — по виду и языку интерфейса. */
export const stageLabel = (stage: Pick<WorkStage, "id" | "name" | "kind">, names: Readonly<Partial<Record<BuiltinKind | "action", string>>>): string => {
  const kind = stageKindOf(stage);
  return kind === "skill" || !isDefaultName(stage) ? stage.name : (names[kind] ?? stage.name);
};

/**
 * Начало строки этапа в инструкциях: у этапа верхнего уровня — номер, у под-этапа — отступ, а за названием — владелец,
 * место и общая галочка.
 */
const stageHead = (stages: readonly WorkStage[], s: WorkStage, numbers: ReadonlyMap<string, number | null>): string => {
  if (s.parent === undefined) return `${numbers.get(s.id)}. ${s.id} "${currentName(s)}"`;
  const before = stages.indexOf(s) < stages.findIndex((owner) => owner.id === s.parent);
  return `   - ${s.id} "${currentName(s)}" — sub-stage of ${s.parent}, runs ${before ? "before" : "after"} it, switched on and off together with it`;
};

/** Этапы настроек строкой для инструкций агенту: номер — у этапов верхнего уровня, под-этап помечен владельцем; без этапов — `null`. */
export const stageInstructions = (stages: readonly WorkStage[]): string | null => {
  if (stages.length === 0) return null;
  const numbers = stageNumbers(stages);
  return ["Work stages in the Flow settings — send all of them in setup.stages, in this order:", ...stages.map((s) => (isHeadingStage(stages, s) ? `${stageHead(stages, s, numbers)}${HEADING_TAIL}` : stageLine(s, stageHead(stages, s, numbers))))].join("\n");
};

/** Хвост этапа-заголовка: исполнять в нём нечего, работа — в его под-этапах. */
const HEADING_TAIL = " — heading: no work of its own, its sub-stages carry the work; send it in setup.stages without share, and when you reach it mark it done without results";

/** Навык встроенного этапа в его строке инструкций; очищенный крестиком — этап идёт без навыка. */
const builtinSkill = (skill: string): string => (skill === "" ? "" : `skill ${skill}: load it for the stage's work; `);

/** Строка этапа в инструкциях: начало `head` и то, что агенту делать на этапе этого вида. */
const stageLine = (s: WorkStage, head: string): string => {
  const kind = stageKindOf(s);
  if (kind === "action") return `${head}${ACTION_TAIL}`;
  if (kind !== "skill") return `${head} — ${builtinSkill(stageSkillOf(s))}${BUILTIN_ANSWERS[kind]}; you execute it yourself, a done stage needs no results`;
  if (s.automation !== undefined) return `${head}${AUTOMATION_TAIL}`;
  const executors = s.executors.length === 0 ? "you execute it yourself" : `executors: ${stageExecutorIds(s).join(", ")}`;
  // Названного навыка мало: агент дойдёт до этапа и уйдёт работать, не
  // прочитав его, — поэтому этап-навык, как и встроенный, велит его загрузить.
  const skill = s.skill === "" ? "" : ` — skill ${s.skill}: load it for the stage's work`;
  return `${head}${skill}; ${executors}`;
};
