// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { createCallerEnvironmentCache } from "./caller-cache.js";

/**
 * Панель треда делает десятки вызовов RPC подряд, и каждый из них спрашивает
 * «из какого дерева пришли». Без памяти это обращение к хосту на каждый вызов
 * — та самая нагрузка, ради снятия которой запрещён обход живых деревьев
 * (decisions/tasks-plus-board-roots-blocks-rpc.md).
 */
interface HostCalls {
  threads: string[];
  environments: string[];
}

function host(options: {
  environmentId?: string | null;
  threadFails?: boolean;
  environmentFails?: boolean;
}) {
  const calls: HostCalls = { threads: [], environments: [] };
  const { bb } = createFakePluginHost({
    pluginId: "caller-cache-test",
    sdk: {
      threads: {
        get: async ({ threadId }: { threadId: string }) => {
          calls.threads.push(threadId);
          if (options.threadFails) throw new Error("тред недоступен");
          return { id: threadId, environmentId: options.environmentId ?? null };
        },
        list: async () => {
          throw new Error("обход живых деревьев запрещён — BBPL-293");
        },
      },
      environments: {
        get: async ({ environmentId }: { environmentId: string }) => {
          calls.environments.push(environmentId);
          if (options.environmentFails) throw new Error("окружение недоступно");
          return {
            id: environmentId,
            projectId: "proj_x",
            path: "/worktrees/env_1",
            name: "agent-x",
            branchName: "bb/thr_1",
            isWorktree: true,
            hostId: "host_1",
          };
        },
      },
    },
  });
  return { bb, calls };
}

describe("createCallerEnvironmentCache", () => {
  it("резолвит окружение треда по его id, не обходя живые деревья", async () => {
    const { bb, calls } = host({ environmentId: "env_1" });
    const cache = createCallerEnvironmentCache(bb);

    expect(await cache.get("thr_1")).toEqual({
      environmentId: "env_1",
      projectId: "proj_x",
      path: "/worktrees/env_1",
      name: "agent-x",
      branchName: "bb/thr_1",
      isWorktree: true,
      hostId: "host_1",
    });
    expect(calls.threads).toEqual(["thr_1"]);
  });

  it("склеивает параллельные запросы одного треда в одно обращение к хосту", async () => {
    const { bb, calls } = host({ environmentId: "env_1" });
    const cache = createCallerEnvironmentCache(bb);

    await Promise.all([cache.get("thr_1"), cache.get("thr_1"), cache.get("thr_1")]);

    expect(calls.threads).toEqual(["thr_1"]);
    expect(calls.environments).toEqual(["env_1"]);
  });

  it("повторный запрос внутри срока памяти к хосту не ходит", async () => {
    let now = 1_000;
    const { bb, calls } = host({ environmentId: "env_1" });
    const cache = createCallerEnvironmentCache(bb, { now: () => now });

    await cache.get("thr_1");
    now += 59_000;
    await cache.get("thr_1");

    expect(calls.threads).toEqual(["thr_1"]);
  });

  it("запрос после срока памяти спрашивает хост заново", async () => {
    let now = 1_000;
    const { bb, calls } = host({ environmentId: "env_1" });
    const cache = createCallerEnvironmentCache(bb, { now: () => now });

    await cache.get("thr_1");
    now += 61_000;
    await cache.get("thr_1");

    expect(calls.threads).toEqual(["thr_1", "thr_1"]);
  });

  it("тред без окружения — это null, а не отказ", async () => {
    const { bb, calls } = host({ environmentId: null });
    const cache = createCallerEnvironmentCache(bb);

    expect(await cache.get("thr_1")).toBeNull();
    expect(calls.environments).toEqual([]);
  });

  it("недоступное окружение даёт null", async () => {
    const { bb } = host({ environmentId: "env_1", environmentFails: true });
    const cache = createCallerEnvironmentCache(bb);

    expect(await cache.get("thr_1")).toBeNull();
  });

  it("отказ помнится недолго — хост чинится раньше, чем истекает полный срок", async () => {
    let now = 1_000;
    const { bb, calls } = host({ threadFails: true });
    const cache = createCallerEnvironmentCache(bb, { now: () => now });

    await cache.get("thr_1");
    now += 4_000;
    await cache.get("thr_1");
    expect(calls.threads).toEqual(["thr_1"]);

    now += 2_000;
    await cache.get("thr_1");
    expect(calls.threads).toEqual(["thr_1", "thr_1"]);
  });
});
