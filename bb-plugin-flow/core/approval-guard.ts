// Слой 1 — чисто. Утверждение показывает владельцу одно поле комментария и судит по виджетам выше: пока Демонстрация
// между прошлым утверждением и этим не прислана, утверждать нечего — и агент, считающий, что владелец её видит, ошибается.
import { currentName, stageKindOf } from "../lib/stage-constants";
import type { FlowProgress, WorkStage } from "../shared/contract";

/**
 * Демонстрации прогона, которые стоят после прошлого утверждения и до этого и ещё не присланы: прислана — закрыта
 * (`finishedAt`), вне прогона — снята владельцем. Утверждения, которого нет во flow, — нечего требовать.
 */
export const unsentDemos = (stages: readonly WorkStage[], progress: FlowProgress | null, approvalId: string): WorkStage[] => {
  const at = stages.findIndex((s) => s.id === approvalId);
  const before = stages.slice(0, Math.max(at, 0));
  const previous = before.map(stageKindOf).lastIndexOf("approve");
  return before
    .slice(previous + 1)
    .filter((s) => stageKindOf(s) === "demo" && progress?.stages[s.id]?.skipped !== true && progress?.stages[s.id]?.finishedAt === undefined);
};

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Стоит ли `term` в тексте отдельным словом, а не частью другого. */
const hasWord = (text: string, term: string): boolean => new RegExp(`(?<![\\p{L}\\p{N}_-])${escaped(term)}(?![\\p{L}\\p{N}_-])`, "iu").test(text);

/** Текст без имён других этапов, длиннее данного и содержащих его имя словом: «Plan review» этап «Plan» не называет. */
const withoutLongerNames = (text: string, stage: WorkStage, stages: readonly WorkStage[]): string =>
  stages
    .filter((other) => other.id !== stage.id && currentName(other).length > currentName(stage).length && hasWord(currentName(other), currentName(stage)))
    .reduce((rest, other) => rest.replace(new RegExp(escaped(currentName(other)), "giu"), " "), text);

/** Назван ли этап в тексте: его имя или id стоит отдельным словом, не внутри имени другого этапа. */
const mentions = (text: string, stage: WorkStage, stages: readonly WorkStage[]): boolean => {
  const own = withoutLongerNames(text, stage, stages);
  return hasWord(own, currentName(stage)) || hasWord(own, stage.id);
};

/** Предложенные агентом к снятию этапы, которых нет в тексте утверждения, — в порядке flow. */
export const unnamedProposals = (stages: readonly WorkStage[], progress: FlowProgress, named: string): WorkStage[] =>
  stages.filter((s) => progress.stages[s.id]?.proposed === true && !mentions(named, s, stages));

/** Всё, что утверждение показывает текстом: итог, незавершённое, заметки, разделы и подписи ссылок. */
export const outcomeText = (outcome: { done: readonly string[]; pending: ReadonlyArray<{ text: string }>; next?: string | undefined; notes?: string | undefined; sections?: ReadonlyArray<{ title: string; text: string }> | undefined; results: ReadonlyArray<{ label: string }> }): string =>
  [...outcome.done, ...outcome.pending.map((p) => p.text), outcome.next ?? "", outcome.notes ?? "", ...(outcome.sections ?? []).flatMap((s) => [s.title, s.text]), ...outcome.results.map((r) => r.label)].join("\n");

/** Утверждение вслед за свёрнутым, без доработанных виджетов между ними: комментарий владельца ещё не учтён. */
const reworkIssues = (reworkPending: boolean): string[] =>
  reworkPending
    ? [
        "the owner's comment on the previous approval folded its widgets and sent them back to you: send reworked widgets first — at least one brief that is not an approval (a brief without outcome or a demo), the owner's choices are preselected in it, the comment under the Continue button outranks them — then this approval",
      ]
    : [];

/**
 * Отказ утверждению: неприсланные демонстрации (`undefined` вместо прогресса — прогресс не подключён, проверять нечем) и
 * непринятый комментарий к прошлому утверждению (`reworkPending`).
 */
export const approvalIssues = (stages: readonly WorkStage[], progress: FlowProgress | null | undefined, approvalId: string, reworkPending = false, named = ""): string[] => {
  const unsent = progress === undefined ? [] : unsentDemos(stages, progress, approvalId);
  const unnamed = progress === undefined || progress === null ? [] : unnamedProposals(stages, progress, named);
  return [
    ...(unnamed.length === 0
      ? []
      : [
          `the owner agrees to ${unnamed.map((s) => `${s.id} "${currentName(s)}"`).join(", ")} being taken out of the run only through this approval, and it does not name ${unnamed.length === 1 ? "it" : "them"}: name each stage you propose to drop and why in done or sections — until the owner approves, the stage stays in the run`,
        ]),
    ...(unsent.length === 0
      ? []
      : [
          `the owner sees only a comment field under an approval and judges by the widgets above it, and ${unsent.map((s) => `${s.id} "${currentName(s)}"`).join(", ")} has no widget yet — send it first (a brief with outcome, outcome.stage — its id), then this approval`,
        ]),
    ...reworkIssues(reworkPending),
  ];
};
