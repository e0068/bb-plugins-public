// Слой 1 — решение, показывать ли кнопку «Merge» и какой индикатор проверок у неё
// рисовать. Ноль эффектов.
//
// Кнопка «Merge» — зеркало кнопки «Pull Request»: та живёт, пока PR ещё не открыт
// (см. visibility.ts); эта — с момента, когда открытый PR появился, до его слияния
// или закрытия. Видна ровно при живом (не draft, не закрытом, не слитом) PR.

/** `checks.state` из ответа GitHub через bb: агрегированный статус проверок PR. */
export type ChecksState = "failing" | "no_checks" | "passing" | "pending" | "unknown";

/** `pullRequest.state` из ответа bb. */
export type PrState = "closed" | "draft" | "merged" | "open";

export interface MergeReadinessInput {
  prState: PrState;
  checksState: ChecksState;
}

/** Что рисовать на кнопке — форма иконки под агрегированный статус проверок. */
export type MergeIndicator = "success" | "failure" | "pending" | "neutral" | "unknown";

export interface MergeReadinessDecision {
  visible: boolean;
  indicator: MergeIndicator;
}

export function decideMergeReadiness(input: MergeReadinessInput): MergeReadinessDecision {
  // Мёржить можно только живой, не-draft PR — draft и settled кнопку прячут,
  // симметрично тому, как их прячет кнопка «Pull Request» на своей стороне.
  if (input.prState !== "open") return { visible: false, indicator: "unknown" };
  return { visible: true, indicator: mergeIndicator(input.checksState) };
}

function mergeIndicator(state: ChecksState): MergeIndicator {
  switch (state) {
    case "passing":
      return "success";
    case "failing":
      return "failure";
    case "pending":
      return "pending";
    case "no_checks":
      return "neutral";
    case "unknown":
      return "unknown";
  }
}
