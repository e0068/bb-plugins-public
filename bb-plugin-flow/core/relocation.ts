// Перенос треда из чекаута проекта в новое дерево от origin/main — решения без эффектов. Тред, заведённый в «Project
// checkout», работал бы прямо в папке проекта на main: коммит лёг бы в main, PR открыть было бы не из чего. Если первый
// этап его flow — шаг «Дерево и ветка от origin/main», Flow до первого хода заводит вместо него тред в worktree с тем же
// сообщением (../server/relocate.ts).
import type { StepId } from "@bb-plugins/automation-steps/catalog";

import type { WorkStage } from "../shared/contract";

export const TREE_STEP = "git.tree-from-origin" satisfies StepId;

/** Провайдер окружения bb для чекаута проекта. */
const PROJECT_CHECKOUT = "project-checkout";

/**
 * Где bb поднимет тред, глазами переноса: `checkout` — новый чекаут проекта, `environment` — готовое окружение, о котором
 * решает само окружение, `other` — что угодно ещё, включая нечитаемое намерение: перенос тогда не делается.
 */
export type CheckoutIntent = { kind: "checkout" } | { kind: "environment"; environmentId: string } | { kind: "other" };

const OTHER: CheckoutIntent = { kind: "other" };

/** Разбор `environmentIntent` хука `message.dispatch`: типы SDK его пока не описывают, bb 0.47 кладёт его в контекст. */
export const checkoutIntentOf = (raw: unknown): CheckoutIntent => {
  if (typeof raw !== "object" || raw === null) return OTHER;
  const intent = raw as { kind?: unknown; environmentProviderId?: unknown; environmentId?: unknown };
  if (intent.kind === "provider") return intent.environmentProviderId === PROJECT_CHECKOUT ? { kind: "checkout" } : OTHER;
  if (intent.kind === "environment" && typeof intent.environmentId === "string") return { kind: "environment", environmentId: intent.environmentId };
  return OTHER;
};

/** Переносит ли flow тред из чекаута: его первый этап — встроенная автоматизация с шагом дерева. */
export const movesOutOfCheckout = (stages: readonly WorkStage[]): boolean => {
  const automation = stages[0]?.automation;
  return automation !== undefined && "source" in automation && automation.steps.includes(TREE_STEP);
};

/** База ветки нового дерева: ветка проекта по умолчанию на origin. */
export const originBase = (defaultBranch: string | null): string => `origin/${(defaultBranch ?? "main").replace(/^origin\//, "")}`;

type Source = { threadId: string; projectId: string; label: string };

/** Первое сообщение нового треда: упоминание исходного — по нему тред получает flow исходного, — и сообщение владельца как было. */
export const relocatedInput = <Block>({ intro, source, blocks }: { intro: (token: string) => string; source: Source; blocks: readonly Block[] }) => {
  const token = `@thread:${source.threadId}`;
  const text = intro(token);
  const start = text.indexOf(token);
  const mention = { start, end: start + token.length, resource: { kind: "thread" as const, projectId: source.projectId, threadId: source.threadId, label: source.label } };
  return [{ type: "text" as const, text, mentions: [mention] }, ...blocks];
};
