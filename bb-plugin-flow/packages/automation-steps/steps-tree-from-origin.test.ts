// Шаг «Дерево и ветка от origin/main» сам тред не переносит — это делает Flow до первого хода. Шаг говорит, где тред
// работает, и не падает: тред, у которого дерево и ветка уже свои, проходит его зелёным.
import { describe, expect, it } from "vitest";

import { isStepId, STEP_IDS, STEP_LABELS } from "./catalog";
import { createSteps, type StepPorts } from "./steps";

const ports = (environment: object | null): StepPorts => ({
  sdk: {
    threads: { get: async () => ({ id: "t1", environmentId: environment === null ? null : "e1", title: "T" }) },
    environments: { get: async () => environment },
  } as unknown as StepPorts["sdk"],
  kv: { get: async () => undefined, set: async () => undefined, delete: async () => undefined, list: async () => [] } as unknown as StepPorts["kv"],
  settings: { get: async () => ({ githubToken: undefined }) },
  plugins: {} as StepPorts["plugins"],
  ownPluginId: "flow",
});

const worktree = { isGitRepo: true, isWorktree: true, managed: true, branchName: "bb/flow-t1", defaultBranch: "main" };
const checkout = { isGitRepo: true, isWorktree: false, managed: false, branchName: "main", defaultBranch: "main" };

describe("шаг «Дерево и ветка от origin/main»", () => {
  it("есть в каталоге первым, с подписью на обоих языках", () => {
    expect(isStepId("git.tree-from-origin")).toBe(true);
    expect(STEP_IDS[0]).toBe("git.tree-from-origin");
    expect(STEP_LABELS["git.tree-from-origin"]).toEqual({ en: "Worktree and branch from origin/main", ru: "Дерево и ветка от origin/main" });
  });

  it("тред в своём дереве — зелёный «уже в своём дереве»", async () => {
    expect(await createSteps(ports(worktree))["git.tree-from-origin"]("t1")).toEqual({ ok: true, detail: "already in its own worktree" });
  });

  it("тред ещё не запущен — зелёный, дерево выберет Flow до первого хода", async () => {
    expect(await createSteps(ports(null))["git.tree-from-origin"]("t1")).toEqual({ ok: true, detail: "not started yet — Flow moves the thread before its first turn" });
  });

  it("тред уже работает в чекауте проекта — зелёный с пометкой, а не провал", async () => {
    expect(await createSteps(ports(checkout))["git.tree-from-origin"]("t1")).toEqual({
      ok: true,
      detail: "the thread already works in the project checkout — Flow moves a thread only before its first turn",
    });
  });
});
