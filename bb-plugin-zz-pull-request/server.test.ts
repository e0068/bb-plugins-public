import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

// Тонкий интеграционный тест склейки prState: гоняем реальный rpc-контракт
// поверх заглушённого bb.sdk и проверяем, что статус окружения и PR правильно
// сводятся в решение о видимости кнопки.

interface StatusStub {
  hasUncommittedChanges: boolean;
  aheadCount: number;
  behindCount?: number;
}

type PrState = "open" | "draft" | "merged" | "closed";

function host(options: {
  environmentId: string | null;
  status?: StatusStub;
  pr?: { outcome: "absent" | "available" | "unavailable"; url?: string; state?: PrState };
  prThrows?: boolean;
}) {
  const statusResult =
    options.status === undefined
      ? { outcome: "unavailable" as const, message: "no git" }
      : {
          outcome: "available" as const,
          workspace: {
            workingTree: { hasUncommittedChanges: options.status.hasUncommittedChanges },
            mergeBase: {
              aheadCount: options.status.aheadCount,
              behindCount: options.status.behindCount ?? 0,
            },
          },
        };
  const prResult =
    options.pr?.outcome === "available"
      ? {
          outcome: "available",
          pullRequest: {
            url: options.pr.url ?? "https://x",
            state: options.pr.state ?? "open",
          },
        }
      : { outcome: options.pr?.outcome ?? "absent" };

  return createFakePluginHost({
    pluginId: "pull-request",
    sdk: {
      subscribe: () => () => {},
      threads: { get: async () => ({ environmentId: options.environmentId }) },
      environments: {
        get: async () => ({
          mergeBaseBranch: null,
          defaultBranch: "main",
          baseBranch: "origin/main",
          path: "/tmp/worktree",
        }),
        status: async () => statusResult,
        pullRequest: async () => {
          if (options.prThrows) throw new Error("409 personal environment");
          return prResult;
        },
      },
    },
  });
}

async function prState(options: Parameters<typeof host>[0]) {
  const { bb, harness } = host(options);
  await plugin(bb);
  return harness.behavior.callRpc("prState", { threadId: "t1" });
}

async function fastForwardState(options: Parameters<typeof host>[0]) {
  const { bb, harness } = host(options);
  await plugin(bb);
  return harness.behavior.callRpc("fastForwardState", { threadId: "t1" });
}

describe("prState (склейка)", () => {
  it("чисто + впереди базы + PR absent → видна", async () => {
    expect(
      await prState({
        environmentId: "env1",
        status: { hasUncommittedChanges: false, aheadCount: 2 },
        pr: { outcome: "absent" },
      }),
    ).toEqual({ visible: true, reason: "ready", prUrl: null });
  });

  it("несохранённые правки → скрыта", async () => {
    expect(
      await prState({
        environmentId: "env1",
        status: { hasUncommittedChanges: true, aheadCount: 2 },
        pr: { outcome: "absent" },
      }),
    ).toEqual({ visible: false, reason: "dirty", prUrl: null });
  });

  it("живой PR (open) → скрыта, но url отдаётся", async () => {
    expect(
      await prState({
        environmentId: "env1",
        status: { hasUncommittedChanges: false, aheadCount: 2 },
        pr: {
          outcome: "available",
          state: "open",
          url: "https://github.com/e0068/bb-plugins/pull/9",
        },
      }),
    ).toEqual({
      visible: false,
      reason: "pr-exists",
      prUrl: "https://github.com/e0068/bb-plugins/pull/9",
    });
  });

  it("PR слит (merged) + новый коммит впереди → видна снова", async () => {
    expect(
      await prState({
        environmentId: "env1",
        status: { hasUncommittedChanges: false, aheadCount: 1 },
        pr: {
          outcome: "available",
          state: "merged",
          url: "https://github.com/e0068/bb-plugins/pull/9",
        },
      }),
    ).toEqual({
      visible: true,
      reason: "ready",
      prUrl: "https://github.com/e0068/bb-plugins/pull/9",
    });
  });

  it("у треда нет окружения → скрыта", async () => {
    expect(await prState({ environmentId: null })).toEqual({
      visible: false,
      reason: "no-environment",
      prUrl: null,
    });
  });

  it("pullRequest бросает (персональное/не-git окружение) → скрыта, не падает", async () => {
    expect(
      await prState({
        environmentId: "env1",
        status: { hasUncommittedChanges: false, aheadCount: 2 },
        prThrows: true,
      }),
    ).toEqual({ visible: false, reason: "pr-unknown", prUrl: null });
  });

  it("git недоступен в окружении → скрыта", async () => {
    expect(await prState({ environmentId: "env1" })).toEqual({
      visible: false,
      reason: "status-unavailable",
      prUrl: null,
    });
  });
});

describe("fastForwardState (склейка)", () => {
  it("отстаём, своих коммитов нет, чисто → видна", async () => {
    expect(
      await fastForwardState({
        environmentId: "env1",
        status: { hasUncommittedChanges: false, aheadCount: 0, behindCount: 3 },
      }),
    ).toEqual({ visible: true, reason: "ready" });
  });

  it("не отстаём → скрыта", async () => {
    expect(
      await fastForwardState({
        environmentId: "env1",
        status: { hasUncommittedChanges: false, aheadCount: 0, behindCount: 0 },
      }),
    ).toEqual({ visible: false, reason: "up-to-date" });
  });

  it("свои коммиты впереди при отставании → скрыта (расхождение)", async () => {
    expect(
      await fastForwardState({
        environmentId: "env1",
        status: { hasUncommittedChanges: false, aheadCount: 2, behindCount: 3 },
      }),
    ).toEqual({ visible: false, reason: "diverged" });
  });

  it("у треда нет окружения → скрыта", async () => {
    expect(await fastForwardState({ environmentId: null })).toEqual({
      visible: false,
      reason: "no-environment",
    });
  });

  it("git недоступен в окружении → скрыта", async () => {
    expect(await fastForwardState({ environmentId: "env1" })).toEqual({
      visible: false,
      reason: "status-unavailable",
    });
  });
});

// Оболочка подписок: сервер просит фронт перечитать («changed») на изменение
// окружения всегда, а на изменение треда — только когда сменилась связка с
// окружением (появился/сменился PR), а не на статус-хартбитах.
type ChangeEvent = { changes: readonly string[] };
type SubscribeCall = [{ event: string; callback: (event: ChangeEvent) => void }];

async function subscriptions() {
  const { bb, harness } = createFakePluginHost({
    pluginId: "pull-request",
    sdk: { subscribe: () => () => {} },
  });
  await plugin(bb);
  const calls = harness.inspection.sdk.callsTo("subscribe") as SubscribeCall[];
  const callbackFor = (event: string) => {
    const call = calls.find((args) => args[0].event === event);
    if (!call) throw new Error(`нет подписки на ${event}`);
    return call[0].callback;
  };
  const changedCount = () =>
    harness.realtimeSignals.filter((signal) => signal.channel === "changed").length;
  return { callbackFor, changedCount };
}

describe("подписки republish «changed»", () => {
  it("environment:changed → перечитать (любое изменение окружения)", async () => {
    const { callbackFor, changedCount } = await subscriptions();
    callbackFor("environment:changed")({ changes: ["git-refs-changed"] });
    expect(changedCount()).toBe(1);
  });

  it("thread:changed с environment-changed → перечитать (bb опознал PR)", async () => {
    const { callbackFor, changedCount } = await subscriptions();
    callbackFor("thread:changed")({ changes: ["environment-changed"] });
    expect(changedCount()).toBe(1);
  });

  it("thread:changed без environment-changed → молчим (хартбиты не трогаем)", async () => {
    const { callbackFor, changedCount } = await subscriptions();
    callbackFor("thread:changed")({ changes: ["status-changed", "title-changed"] });
    expect(changedCount()).toBe(0);
  });
});
