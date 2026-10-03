// Черновик flow от агента — в flow хранилища. Ядро раздаёт свободные id и
// названия по умолчанию, исполнителей берёт из каталога и собирает все
// проблемы сразу: навык или исполнитель не из каталога, этап-навык без навыка
// и автоматизации, автоматизация у встроенного этапа или с исполнителями,
// шаг-скрипт без скрипта, повтор id, id «без flow». Сохраняет — server/flow-tools.ts.
import { actionStage, automationStageId, builtinStage, freeId, linkedSubStages, NO_SKILL, SUB_STAGE_ISSUE } from "../lib/stage-constants";
import type { Flow, FlowDraft, StageCatalog, StageDraft, StageExecutor, WorkStage } from "../shared/contract";
import { AGENT_NO_FLOW, AUTO_FLOW, NO_FLOW, withDescription } from "./flows";

export type FlowDraftResult = { ok: true; flow: Flow } | { ok: false; problems: string[] };

type Resolved = { stage: WorkStage; problems: string[] };

/** Имя этапа-автоматизации без названия — как у новой автоматизации на странице. */
const AUTOMATION_NAME = "Automation";

const unread = (part: "skill" | "executor") => `the ${part} catalog could not be read, so the ${part}s of the stages cannot be checked; try again later`;

/** Шаги-скрипты встроенной автоматизации, у которых нет своего скрипта в этапе. */
const orphanScripts = (automation: NonNullable<StageDraft["automation"]>): string[] => {
  if (!("source" in automation)) return [];
  const scripts = new Set((automation.scripts ?? []).map((s) => s.id));
  return automation.steps.filter((step) => step.startsWith("script:") && !scripts.has(step.slice("script:".length)));
};

/** Id этапа: заданный, а без него — свободный по виду, навыку или автоматизации. */
const stageId = (draft: StageDraft, taken: readonly string[]): string => {
  if (draft.id !== undefined) return draft.id;
  if (draft.kind === "action") return actionStage(taken).id;
  if (draft.kind !== "skill") return builtinStage(draft.kind, taken).id;
  if (draft.automation === undefined) return freeId(draft.skill ?? "stage", taken);
  return freeId("source" in draft.automation ? "flow-automation" : automationStageId(draft.automation.id), taken);
};

const defaultName = (draft: StageDraft): string => {
  if (draft.kind === "action") return actionStage([]).name;
  if (draft.kind !== "skill") return builtinStage(draft.kind, []).name;
  if (draft.automation === undefined) return draft.skill ?? draft.kind;
  return "source" in draft.automation ? AUTOMATION_NAME : draft.automation.name;
};

/**
 * `taken` — id уже разобранных этапов, `reserved` — id, заданные в черновике: сгенерированный id не занимает ни тех, ни других.
 * `kept` — этапы сохранённого flow: их навык проходит и без каталога, иначе пропавший навык запер бы flow от любой правки,
 * а иконку и снятый Main Agent, выбранные владельцем, этап того же id берёт оттуда — агент их не знает. `owners` — id владельцев под-этапов
 * черновика: этап навыка без навыка с под-этапами — заголовок, и навык ему не нужен.
 */
type DraftContext = { reserved: readonly string[]; catalog: StageCatalog; kept: readonly WorkStage[]; owners: ReadonlySet<string> };

const resolveStage = (draft: StageDraft, n: number, taken: readonly string[], { reserved, catalog, kept, owners }: DraftContext): Resolved => {
  const at = `stage ${n}`;
  const skill = (draft.skill ?? "").trim();
  const known = new Set(catalog.skills.map((s) => s.name));
  const byId = new Map(catalog.executors.map((e) => [e.id, e]));
  const executorIds = draft.executors ?? [];
  const id = stageId(draft, [...taken, ...reserved]);
  const isKept = kept.some((s) => s.id === id && s.skill === skill);
  const icon = kept.find((s) => s.id === id)?.icon;
  const mainAgentOff = kept.some((s) => s.id === id && s.mainAgent === false);
  const executors = executorIds.map((e) => byId.get(e)).filter((e): e is StageExecutor => e !== undefined);
  const problems = [
    ...(draft.id !== undefined && taken.includes(draft.id) ? [`${at}: the stage id "${draft.id}" repeats an earlier stage`] : []),
    ...(draft.kind === "skill" && draft.automation === undefined && skill === "" && !owners.has(id) ? [`${at}: a skill stage needs a skill or an automation`] : []),
    ...(draft.kind !== "skill" && draft.kind !== "action" && draft.automation !== undefined ? [`${at}: an automation belongs to a stage of kind skill or action, not ${draft.kind}`] : []),
    ...(draft.kind === "action" && draft.automation === undefined ? [`${at}: an action stage needs steps`] : []),
    ...(draft.automation !== undefined && executorIds.length > 0 ? [`${at}: an automation stage takes no executor — Flow runs it itself`] : []),
    ...(namesCatalogSkill(draft.kind, skill) && known.size > 0 && !known.has(skill) && !isKept ? [`${at}: the skill "${skill}" is not in the catalog`] : []),
    ...executorIds.filter((e) => !byId.has(e)).map((e) => `${at}: the executor "${e}" is not in the catalog`),
    ...(draft.automation === undefined ? [] : orphanScripts(draft.automation).map((step) => `${at}: the step "${step}" has no script with that id in the stage`)),
  ];
  const stage: WorkStage = {
    id,
    kind: draft.kind,
    skill,
    name: draft.name ?? defaultName(draft),
    executors,
    ...(draft.automation === undefined ? {} : { automation: draft.automation }),
    ...(draft.parent === undefined ? {} : { parent: draft.parent }),
    ...(icon === undefined ? {} : { icon }),
    ...(mainAgentOff && executors.length > 0 ? { mainAgent: false as const } : {}),
  };
  return { stage, problems };
};

/** Навык этапа ищется в каталоге: пустое поле — не навык, `NO_SKILL` у встроенного этапа — «без навыка», а не имя навыка. */
const namesCatalogSkill = (kind: StageDraft["kind"], skill: string): boolean => skill !== "" && !(skill === NO_SKILL && kind !== "skill" && kind !== "action");

/** Черновик — в flow; хоть одна проблема — список всех проблем вместо flow. `newId` даёт id новому flow, `stored` — сохранённый flow с тем же id. */
export const resolveFlowDraft = (draft: FlowDraft, catalog: StageCatalog, newId: () => string, stored?: Flow): FlowDraftResult => {
  const referencesSkills = draft.stages.some((s) => namesCatalogSkill(s.kind, (s.skill ?? "").trim()));
  const referencesExecutors = draft.stages.some((s) => (s.executors ?? []).length > 0);
  const unreadParts = [...(referencesSkills && catalog.skills.length === 0 ? [unread("skill")] : []), ...(referencesExecutors && catalog.executors.length === 0 ? [unread("executor")] : [])];
  if (unreadParts.length > 0) return { ok: false, problems: unreadParts };
  const reserved = draft.stages.flatMap((s) => (s.id === undefined ? [] : [s.id]));
  const context: DraftContext = { reserved, catalog, kept: stored?.stages ?? [], owners: new Set(draft.stages.flatMap((s) => (s.parent === undefined ? [] : [s.parent]))) };
  const resolved = draft.stages.reduce<Resolved[]>((done, stage, i) => [...done, resolveStage(stage, i + 1, done.map((r) => r.stage.id), context)], []);
  const problems = [
    // Иначе flow с этим id был бы невыбираем: кнопка композера читает его как отказ от flow.
    ...(draft.id === NO_FLOW ? [`the flow id "${NO_FLOW}" is reserved for the "no flow" choice of the composer`] : []),
    ...(draft.id === AUTO_FLOW ? [`the flow id "${AUTO_FLOW}" is reserved for the "automatic" choice of the composer`] : []),
    ...(draft.id === AGENT_NO_FLOW ? [`the flow id "${AGENT_NO_FLOW}" is reserved for the "no flow" choice of the agent`] : []),
    ...resolved.flatMap((r) => r.problems),
    ...(linkedSubStages(resolved.map((r) => r.stage)) ? [] : [SUB_STAGE_ISSUE]),
  ];
  return problems.length > 0 ? { ok: false, problems } : { ok: true, flow: withDescription({ id: draft.id ?? `flow-${newId()}`, name: draft.name, stages: resolved.map((r) => r.stage) }, draft.description ?? "") };
};
