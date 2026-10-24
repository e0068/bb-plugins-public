import { describe, expect, it } from "vitest";

import type { WorkStage } from "../shared/contract";
import { checkoutIntentOf, movesOutOfCheckout, originBase, relocatedInput, TREE_STEP } from "./relocation";

const stage = (patch: Partial<WorkStage>): WorkStage => ({ id: "s", kind: "skill", skill: "", name: "S", executors: [], ...patch }) as WorkStage;
const tree = stage({ id: "tree", automation: { source: "flow", steps: [TREE_STEP] } });

describe("checkoutIntentOf", () => {
  it("новое окружение провайдера project-checkout — чекаут", () => {
    expect(checkoutIntentOf({ kind: "provider", environmentProviderId: "project-checkout", machine: null, inputs: {} })).toEqual({ kind: "checkout" });
  });

  it("новый worktree — не чекаут", () => {
    expect(checkoutIntentOf({ kind: "provider", environmentProviderId: "git-worktree" })).toEqual({ kind: "other" });
  });

  it("готовое окружение — решает само окружение", () => {
    expect(checkoutIntentOf({ kind: "environment", environmentId: "env_1" })).toEqual({ kind: "environment", environmentId: "env_1" });
  });

  it("намерения нет или оно нечитаемо — не чекаут", () => {
    for (const raw of [undefined, null, "x", { kind: "provider" }, { kind: "environment" }, { kind: "other" }]) expect(checkoutIntentOf(raw)).toEqual({ kind: "other" });
  });
});

describe("movesOutOfCheckout", () => {
  it("первый этап flow — автоматизация с шагом дерева: переносит", () => {
    expect(movesOutOfCheckout([tree, stage({ id: "b" })])).toBe(true);
  });

  it("шаг дерева не первым этапом или его нет — не переносит", () => {
    expect(movesOutOfCheckout([stage({ id: "a" }), tree])).toBe(false);
    expect(movesOutOfCheckout([stage({ id: "a", automation: { source: "flow", steps: ["git.commit"] } })])).toBe(false);
    expect(movesOutOfCheckout([])).toBe(false);
  });
});

describe("originBase", () => {
  it("ветка по умолчанию с origin и без — origin/<ветка>, неизвестна — origin/main", () => {
    expect(originBase("main")).toBe("origin/main");
    expect(originBase("origin/master")).toBe("origin/master");
    expect(originBase(null)).toBe("origin/main");
  });
});

describe("relocatedInput", () => {
  it("первым блоком — упоминание исходного треда, за ним сообщение владельца как было", () => {
    const owner = [{ type: "text" as const, text: "Сделай кнопку", mentions: [] }, { type: "localImage" as const, path: "/a.png" }];
    const input = relocatedInput({ intro: (token) => `Перенесено из ${token}.`, source: { threadId: "thr_s", projectId: "p", label: "Кнопка" }, blocks: owner });
    expect(input).toEqual([
      { type: "text", text: "Перенесено из @thread:thr_s.", mentions: [{ start: 14, end: 27, resource: { kind: "thread", projectId: "p", threadId: "thr_s", label: "Кнопка" } }] },
      ...owner,
    ]);
  });
});
