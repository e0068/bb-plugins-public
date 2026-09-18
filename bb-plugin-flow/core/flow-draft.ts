// Черновик flow от агента — в flow хранилища. Ядро раздаёт свободные id и
// названия по умолчанию, исполнителей берёт из каталога и собирает все
// проблемы сразу: навык или исполнитель не из каталога, этап-навык без навыка
// и автоматизации, автоматизация у встроенного этапа или с исполнителями,
// шаг-скрипт без скрипта, повтор id. Сохраняет — server/flow-tools.ts.
import { automationStageId, builtinStage, freeId } from "../lib/stage-constants";
import type { Flow, FlowDraft, StageCatalog, StageDraft, StageExecutor, WorkStage } from "../shared/contract";

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
  if (draft.kind !== "skill") return builtinStage(draft.kind, taken).id;
  if (draft.automation === undefined) return freeId(draft.skill ?? "stage", taken);
  return freeId("source" in draft.automation ? "flow-automation" : automationStageId(draft.automation.id), taken);
};

const defaultName = (draft: StageDraft): string => {
  if (draft.kind !== "skill") return builtinStage(draft.kind, []).name;
  if (draft.automation === undefined) return draft.skill ?? draft.kind;
  return "source" in draft.automation ? AUTOMATION_NAME : draft.automation.name;
};

/** `taken` — id уже разобранных этапов, `reserved` — id, заданные в черновике: сгенерированный id не занимает ни тех, ни других. */
const resolveStage = (draft: StageDraft, n: number, taken: readonly string[], reserved: readonly string[], catalog: StageCatalog): Resolved => {
  const at = `stage ${n}`;
  const skill = draft.automation === undefined ? (draft.skill ?? "").trim() : "";
  const known = new Set(catalog.skills.map((s) => s.name));
  const byId = new Map(catalog.executors.map((e) => [e.id, e]));
  const executorIds = draft.executors ?? [];
  const id = stageId(draft, [...taken, ...reserved]);
  const executors = executorIds.map((e) => byId.get(e)).filter((e): e is StageExecutor => e !== undefined);
  const problems = [
    ...(draft.id !== undefined && taken.includes(draft.id) ? [`${at}: the stage id "${draft.id}" repeats an earlier stage`] : []),
    ...(draft.kind === "skill" && draft.automation === undefined && skill === "" ? [`${at}: a skill stage needs a skill or an automation`] : []),
    ...(draft.kind !== "skill" && draft.automation !== undefined ? [`${at}: an automation belongs to a stage of kind skill, not ${draft.kind}`] : []),
    ...(draft.automation !== undefined && executorIds.length > 0 ? [`${at}: an automation stage takes no executor — Flow runs it itself`] : []),
    ...(skill !== "" && known.size > 0 && !known.has(skill) ? [`${at}: the skill "${skill}" is not in the catalog`] : []),
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
  };
  return { stage, problems };
};

/** Черновик — в flow; хоть одна проблема — список всех проблем вместо flow. `newId` даёт id новому flow. */
export const resolveFlowDraft = (draft: FlowDraft, catalog: StageCatalog, newId: () => string): FlowDraftResult => {
  const referencesSkills = draft.stages.some((s) => s.automation === undefined && (s.skill ?? "").trim() !== "");
  const referencesExecutors = draft.stages.some((s) => (s.executors ?? []).length > 0);
  const unreadParts = [...(referencesSkills && catalog.skills.length === 0 ? [unread("skill")] : []), ...(referencesExecutors && catalog.executors.length === 0 ? [unread("executor")] : [])];
  if (unreadParts.length > 0) return { ok: false, problems: unreadParts };
  const reserved = draft.stages.flatMap((s) => (s.id === undefined ? [] : [s.id]));
  const resolved = draft.stages.reduce<Resolved[]>((done, stage, i) => [...done, resolveStage(stage, i + 1, done.map((r) => r.stage.id), reserved, catalog)], []);
  const problems = resolved.flatMap((r) => r.problems);
  return problems.length > 0 ? { ok: false, problems } : { ok: true, flow: { id: draft.id ?? `flow-${newId()}`, name: draft.name, stages: resolved.map((r) => r.stage) } };
};
