import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

// Тонкий интеграционный тест склейки prState: гоняем реальный rpc-контракт
// поверх заглушённого bb.sdk и проверяем, что статус окружения и PR правильно
// сводятся в решение о видимости кнопки.

interface StatusStub {
  hasUncommittedChanges: boolean;
  aheadCount: number;
  behindCount?: number;
  /** HEAD текущей ветки — по умолчанию фиксированный, чтобы мержи мог узнать «тот же коммит». */
  headSha?: string;
}

type PrState = "open" | "draft" | "merged" | "closed";
type ChecksState = "failing" | "no_checks" | "passing" | "pending" | "unknown";

interface HostOptions {
  environmentId: string | null;
  status?: StatusStub;
  pr?: {
    outcome: "absent" | "available" | "unavailable";
    url?: string;
    state?: PrState;
    checksState?: ChecksState;
  };
  prThrows?: boolean;
  mergePullRequest?: () => Promise<unknown>;
}

// `options` читается лениво при каждом вызове (не снимается один раз при
// создании host) — так тест может смёржить PR, затем подменить options.pr/
// options.status «под GitHub, ответивший merged» и переиспользовать тот же
// bb/harness (а с ним и ту же kv) для второго RPC-вызова.
function statusResultOf(status: StatusStub | undefined) {
  if (status === undefined) return { outcome: "unavailable" as const, message: "no git" };
  return {
    outcome: "available" as const,
    workspace: {
      workingTree: { hasUncommittedChanges: status.hasUncommittedChanges },
      mergeBase: {
        aheadCount: status.aheadCount,
        behindCount: status.behindCount ?? 0,
      },
      checkout: { kind: "branch" as const, branchName: "task", headSha: status.headSha ?? "sha-current" },
    },
  };
}

function prResultOf(pr: HostOptions["pr"]) {
  return pr?.outcome === "available"
    ? {
        outcome: "available",
        pullRequest: {
          url: pr.url ?? "https://x",
          state: pr.state ?? "open",
          checks: { state: pr.checksState ?? "no_checks" },
        },
      }
    : { outcome: pr?.outcome ?? "absent" };
}

function host(options: HostOptions) {
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
        status: async () => statusResultOf(options.status),
        pullRequest: async () => {
          if (options.prThrows) throw new Error("409 personal environment");
          return prResultOf(options.pr);
        },
        mergePullRequest:
          options.mergePullRequest ?? (async () => ({ ok: true, action: "pull_request_merge" })),
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

async function mergeState(options: Parameters<typeof host>[0]) {
  const { bb, harness } = host(options);
  await plugin(bb);
  return harness.behavior.callRpc("mergeState", { threadId: "t1" });
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

describe("mergeState (склейка)", () => {
  it("PR открыт + проверки прошли → видна, индикатор success", async () => {
    expect(
      await mergeState({
        environmentId: "env1",
        pr: {
          outcome: "available",
          state: "open",
          checksState: "passing",
          url: "https://github.com/e0068/bb-plugins/pull/9",
        },
      }),
    ).toEqual({
      visible: true,
      indicator: "success",
      prUrl: "https://github.com/e0068/bb-plugins/pull/9",
    });
  });

  it("PR открыт + проверки провалены → видна, индикатор failure", async () => {
    expect(
      await mergeState({
        environmentId: "env1",
        pr: { outcome: "available", state: "open", checksState: "failing" },
      }),
    ).toEqual({ visible: true, indicator: "failure", prUrl: "https://x" });
  });

  it("PR слит (merged) → скрыта, индикатор unknown", async () => {
    expect(
      await mergeState({
        environmentId: "env1",
        pr: { outcome: "available", state: "merged", checksState: "passing" },
      }),
    ).toEqual({ visible: false, indicator: "unknown", prUrl: "https://x" });
  });

  it("PR отсутствует → скрыта, prUrl null", async () => {
    expect(await mergeState({ environmentId: "env1", pr: { outcome: "absent" } })).toEqual({
      visible: false,
      indicator: "unknown",
      prUrl: null,
    });
  });

  it("у треда нет окружения → скрыта", async () => {
    expect(await mergeState({ environmentId: null })).toEqual({
      visible: false,
      indicator: "unknown",
      prUrl: null,
    });
  });

  it("pullRequest бросает → скрыта, не падает", async () => {
    expect(await mergeState({ environmentId: "env1", prThrows: true })).toEqual({
      visible: false,
      indicator: "unknown",
      prUrl: null,
    });
  });
});

describe("headAlreadyMerged после squash-мёржа (склейка mergePr → prState)", () => {
  it("тот же HEAD после mergePr не даёт снова показать PR, хотя aheadCount > 0", async () => {
    const options: Parameters<typeof host>[0] = {
      environmentId: "env1",
      status: { hasUncommittedChanges: false, aheadCount: 8, headSha: "sha-1" },
      pr: { outcome: "available", state: "open", checksState: "passing" },
    };
    const { bb, harness } = host(options);
    await plugin(bb);

    await harness.behavior.callRpc("mergePr", { threadId: "t1" });
    // GitHub теперь отдаёт PR как merged; squash оставил старые SHA локальной
    // ветки «впереди» — HEAD и aheadCount не поменялись.
    options.pr = { outcome: "available", state: "merged" };

    expect(await harness.behavior.callRpc("prState", { threadId: "t1" })).toEqual({
      visible: false,
      reason: "already-merged",
      prUrl: "https://x",
    });
  });

  it("новый коммит после мёржа (другой HEAD) → кнопка PR снова видна", async () => {
    const options: Parameters<typeof host>[0] = {
      environmentId: "env1",
      status: { hasUncommittedChanges: false, aheadCount: 8, headSha: "sha-1" },
      pr: { outcome: "available", state: "open", checksState: "passing" },
    };
    const { bb, harness } = host(options);
    await plugin(bb);

    await harness.behavior.callRpc("mergePr", { threadId: "t1" });
    options.pr = { outcome: "available", state: "merged" };
    options.status = { hasUncommittedChanges: false, aheadCount: 1, headSha: "sha-2" };

    expect(await harness.behavior.callRpc("prState", { threadId: "t1" })).toEqual({
      visible: true,
      reason: "ready",
      prUrl: "https://x",
    });
  });
});

describe("mergePr", () => {
  it("мёржит открытый PR через bb (squash) и возвращает ok", async () => {
    const calls: unknown[] = [];
    const { bb, harness } = host({
      environmentId: "env1",
      pr: { outcome: "available", state: "open", checksState: "passing" },
      mergePullRequest: async () => {
        calls.push("called");
        return { ok: true, action: "pull_request_merge" };
      },
    });
    await plugin(bb);
    expect(await harness.behavior.callRpc("mergePr", { threadId: "t1" })).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
  });

  it("у треда нет окружения → бросает", async () => {
    const { bb, harness } = host({ environmentId: null });
    await plugin(bb);
    await expect(harness.behavior.callRpc("mergePr", { threadId: "t1" })).rejects.toThrow();
  });

  // Раньше кнопки Merge/PR узнавали о свежесмёрженном PR только по «changed»
  // из environment:changed/thread:changed или по 20-секундному поллингу
  // (app.tsx) — отсюда заметная задержка перед тем, как «Pull Request»
  // сменялась на «Merge». mergePr публикует «changed» сам, сразу по успеху.
  it("публикует «changed» сразу по успеху — фронт не ждёт поллинга", async () => {
    const { bb, harness } = host({
      environmentId: "env1",
      pr: { outcome: "available", state: "open", checksState: "passing" },
    });
    await plugin(bb);
    await harness.behavior.callRpc("mergePr", { threadId: "t1" });
    const changed = harness.realtimeSignals.filter((signal) => signal.channel === "changed");
    expect(changed).toHaveLength(1);
  });
});

// bb сам узнаёт о смене статуса PR на GitHub не мгновенно (см.
// memory/decisions/republish-catchup-burst-after-mutation.md): один republish()
// сразу после мутации часто читает ещё не догнавший кэш bb, и без подстраховки
// кнопка ждала 20-секундного поллинга на фронте. Проверяем, что после мутации
// «changed» приходит не один раз, а короткой серией.
describe("серия догоняющих republish после мутации (createPr/fastForward/mergePr)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("mergePr → «changed» сразу и ещё несколько раз в следующие секунды", async () => {
    const { bb, harness } = host({
      environmentId: "env1",
      pr: { outcome: "available", state: "open", checksState: "passing" },
    });
    await plugin(bb);

    await harness.behavior.callRpc("mergePr", { threadId: "t1" });
    const changedCount = () =>
      harness.realtimeSignals.filter((signal) => signal.channel === "changed").length;

    expect(changedCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(changedCount()).toBe(2);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(changedCount()).toBe(5);
  });

  it("после диспоуза плагина отложенные republish не срабатывают", async () => {
    const { bb, harness } = host({
      environmentId: "env1",
      pr: { outcome: "available", state: "open", checksState: "passing" },
    });
    await plugin(bb);
    await harness.behavior.callRpc("mergePr", { threadId: "t1" });
    await harness.dispose();

    await vi.advanceTimersByTimeAsync(20_000);
    const changed = harness.realtimeSignals.filter((signal) => signal.channel === "changed");
    expect(changed).toHaveLength(1);
  });
});

describe("mainPullState (склейка)", () => {
  it("PR ещё не мёржили → попытки не было", async () => {
    const { bb, harness } = host({ environmentId: "env1" });
    await plugin(bb);
    expect(await harness.behavior.callRpc("mainPullState", { threadId: "t1" })).toEqual({
      attempted: false,
      ok: true,
      reason: null,
    });
  });

  it("у треда нет окружения → попытки не было", async () => {
    const { bb, harness } = host({ environmentId: null });
    await plugin(bb);
    expect(await harness.behavior.callRpc("mainPullState", { threadId: "t1" })).toEqual({
      attempted: false,
      ok: true,
      reason: null,
    });
  });

  // env.path в фейковом host — несуществующий каталог, поэтому реальный git
  // здесь неизбежно откажет; сама логика fetch origin <base>:<base>
  // (fast-forward-only + отказ на занятой в другом worktree ветке)
  // проверяется отдельно, без реального git, в
  // src/wiring/local-main-pull.test.ts. Здесь — только склейка mergePr →
  // KV → mainPullState.
  it("после mergePr попытка подтянуть main отражается в mainPullState", async () => {
    const { bb, harness } = host({
      environmentId: "env1",
      pr: { outcome: "available", state: "open", checksState: "passing" },
    });
    await plugin(bb);
    await harness.behavior.callRpc("mergePr", { threadId: "t1" });

    const state = await harness.behavior.callRpc("mainPullState", { threadId: "t1" });
    expect(state.attempted).toBe(true);
    expect(state.ok).toBe(false);
    expect(typeof state.reason).toBe("string");
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
