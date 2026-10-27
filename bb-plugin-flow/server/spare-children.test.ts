// @vitest-environment node
import { describe, expect, it } from "vitest";

import { spareOpenChildren, withSparedChildren, type SpareDeps } from "./spare-children";

type Child = { id: string; status: string };

/** Дерево под `parent`: id треда → его дети. */
type Tree = Record<string, Child[]>;

/** Родитель `parent` с детьми; `open` — треды с незаконченным прогоном; `grandparent` — над родителем. */
const world = (over: { children?: Child[]; tree?: Tree; open?: string[]; grandparent?: string | null; updateFails?: boolean } = {}) => {
  const log: string[] = [];
  const tree: Tree = over.tree ?? { parent: over.children ?? [] };
  const deps: SpareDeps = {
    sdk: {
      threads: {
        list: async (args: { parentThreadId: string; includeHidden?: boolean }) => (args.includeHidden === true ? (tree[args.parentThreadId] ?? []) : []),
        get: async (args: { threadId: string }) => ({ parentThreadId: args.threadId === "parent" ? (over.grandparent ?? null) : "wrong-thread" }),
        update: async (args: { threadId: string; parentThreadId: string | null }) => {
          if (over.updateFails === true) throw new Error("update refused");
          log.push(`update:${args.threadId}->${args.parentThreadId}`);
          return {};
        },
      },
    } as never,
    runOpen: async (threadId) => (over.open ?? []).includes(threadId),
  };
  return { deps, log };
};

describe("дети архивируемого треда", () => {
  it("ребёнок с незаконченным прогоном поднимается на уровень родителя", async () => {
    const { deps, log } = world({ children: [{ id: "c1", status: "idle" }], open: ["c1"], grandparent: "root" });
    expect(await spareOpenChildren(deps, "parent")).toEqual(["c1"]);
    expect(log).toEqual(["update:c1->root"]);
  });

  it("у корневого родителя ребёнок уходит в корень", async () => {
    const { deps, log } = world({ children: [{ id: "c1", status: "idle" }], open: ["c1"] });
    await spareOpenChildren(deps, "parent");
    expect(log).toEqual(["update:c1->null"]);
  });

  it("ребёнок, чей агент сейчас в ходе, поднимается, даже если прогона у него нет", async () => {
    const { deps, log } = world({ children: [{ id: "c1", status: "active" }] });
    expect(await spareOpenChildren(deps, "parent")).toEqual(["c1"]);
    expect(log).toEqual(["update:c1->null"]);
  });

  it("ребёнок с законченным прогоном или без работы остаётся под родителем и уходит в архив с ним", async () => {
    const { deps, log } = world({ children: [{ id: "done", status: "idle" }, { id: "bare", status: "idle" }], open: [] });
    expect(await spareOpenChildren(deps, "parent")).toEqual([]);
    expect(log).toEqual([]);
  });

  it("из нескольких детей поднимаются только открытые", async () => {
    const { deps, log } = world({ children: [{ id: "a", status: "idle" }, { id: "b", status: "idle" }, { id: "c", status: "idle" }], open: ["a", "c"], grandparent: "root" });
    expect(await spareOpenChildren(deps, "parent")).toEqual(["a", "c"]);
    expect(log).toEqual(["update:a->root", "update:c->root"]);
  });
});

describe("внуки архивируемого треда", () => {
  it("открытый внук под законченным ребёнком поднимается, сам ребёнок и закрытые остаются", async () => {
    const { deps, log } = world({
      tree: { parent: [{ id: "c1", status: "idle" }], c1: [{ id: "g1", status: "idle" }, { id: "g2", status: "idle" }] },
      open: ["g1"],
      grandparent: "root",
    });
    expect(await spareOpenChildren(deps, "parent")).toEqual(["g1"]);
    expect(log).toEqual(["update:g1->root"]);
  });

  it("открытый ребёнок едет со всем поддеревом: его потомков отдельно не трогают", async () => {
    const { deps, log } = world({
      tree: { parent: [{ id: "c1", status: "idle" }], c1: [{ id: "g1", status: "idle" }], g1: [{ id: "h1", status: "active" }] },
      open: ["c1"],
    });
    expect(await spareOpenChildren(deps, "parent")).toEqual(["c1"]);
    expect(log).toEqual(["update:c1->null"]);
  });
});

describe("шаг Archive", () => {
  const archive = (log: string[] = []) => {
    const calls: string[] = log;
    const steps = { "bb.archive": async (threadId: string) => (calls.push(`archive:${threadId}`), { ok: true as const }), "git.commit": async () => ({ ok: true as const }) };
    return { calls, steps: steps as never };
  };

  it("сперва поднимает открытых детей, потом архивирует родителя, и называет их в итоге шага", async () => {
    const { deps, log } = world({ children: [{ id: "c1", status: "idle" }], open: ["c1"] });
    const { steps } = archive(log);
    const wrapped = withSparedChildren(steps, (id) => spareOpenChildren(deps, id)) as unknown as Record<string, (id: string) => Promise<{ ok: boolean; detail?: string; error?: string }>>;
    const result = await wrapped["bb.archive"]("parent");
    expect(log).toEqual(["update:c1->null", "archive:parent"]);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("c1");
  });

  it("не удалось поднять ребёнка — родитель не архивируется, шаг падает с причиной", async () => {
    const { deps, log } = world({ children: [{ id: "c1", status: "idle" }], open: ["c1"], updateFails: true });
    const { calls, steps } = archive(log);
    const wrapped = withSparedChildren(steps, (id) => spareOpenChildren(deps, id)) as unknown as Record<string, (id: string) => Promise<{ ok: boolean; error?: string }>>;
    const result = await wrapped["bb.archive"]("parent");
    expect(calls).toEqual([]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("update refused");
  });

  it("остальные шаги не тронуты", () => {
    const { steps } = archive();
    const wrapped = withSparedChildren(steps, async () => []) as unknown as Record<string, unknown>;
    expect(wrapped["git.commit"]).toBe((steps as unknown as Record<string, unknown>)["git.commit"]);
  });
});
