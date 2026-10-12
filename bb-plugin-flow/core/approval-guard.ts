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
export const approvalIssues = (stages: readonly WorkStage[], progress: FlowProgress | null | undefined, approvalId: string, reworkPending = false): string[] => {
  const unsent = progress === undefined ? [] : unsentDemos(stages, progress, approvalId);
  return [
    ...(unsent.length === 0
      ? []
      : [
          `the owner sees only a comment field under an approval and judges by the widgets above it, and ${unsent.map((s) => `${s.id} "${currentName(s)}"`).join(", ")} has no widget yet — send it first (a brief with outcome, outcome.stage — its id), then this approval`,
        ]),
    ...reworkIssues(reworkPending),
  ];
};
