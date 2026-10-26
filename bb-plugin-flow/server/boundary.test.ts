// @vitest-environment node
// Граница этапов: Flow дожидается простоя треда, сжимает его, ставит модель следующего этапа и присылает «продолжай».
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { BOUNDARY_WAIT_MS, PLAN_TTL_MS, createBoundary, stageModelsOf, type StageState } from "./boundary";

const THREAD = "thr_boundary";

type Failing = { wait?: boolean; compact?: boolean; update?: boolean; send?: boolean };

const setup = (failing: Failing = {}, options: { state?: () => StageState; clock?: () => number } = {}) => {
  const calls: string[] = [];
  const waits: Array<{ threadId: string; status?: string | undefined; timeoutMs?: number | undefined }> = [];
  const sends: Array<{ mode?: string; text: string }> = [];
  const warnings: string[] = [];
  const { bb } = createFakePluginHost({
    pluginId: "flow",
    sdk: {
      threads: {
        wait: async (args: { threadId: string; status?: string | undefined; timeoutMs?: number | undefined }) => {
          waits.push(args);
          calls.push("wait");
          if (failing.wait === true) throw new Error("timed out");
          return { matched: true };
        },
        compact: async () => {
          calls.push("compact");
          if (failing.compact === true) throw new Error("compaction failed");
          return { ok: true };
        },
        update: async (args: { model?: string | null | undefined }) => {
          calls.push(`update:${args.model}`);
          if (failing.update === true) throw new Error("update failed");
          return {};
        },
      },
    },
  });
  const boundary = createBoundary({
    threads: bb.sdk.threads,
    send: async (_threadId, text) => {
      calls.push("send");
      if (failing.send === true) throw new Error("send failed");
      sends.push({ mode: "queue-if-active", text });
    },
    ...(options.state === undefined ? {} : { stageState: async () => options.state!() }),
    ...(options.clock === undefined ? {} : { now: options.clock }),
    warn: (message) => warnings.push(message),
  });
  return { boundary, calls, waits, sends, warnings };
};

const plan = { compact: true, model: "claude-sonnet-4-5", nextStage: 'implement "Implementation"', stageId: "implement", fresh: true };

describe("граница этапов: обслуживание", () => {
  it("ждёт простоя, сжимает, ставит модель — в таком порядке", async () => {
    const { boundary, calls, waits } = setup();
    boundary.schedule(THREAD, plan);
    await boundary.service(THREAD);
    expect(calls).toEqual(["wait", "compact", "update:claude-sonnet-4-5"]);
    expect(waits[0]).toMatchObject({ threadId: THREAD, status: "idle", timeoutMs: BOUNDARY_WAIT_MS });
  });

  it("предел ожидания — те же десять минут, что у реле", () => {
    expect(BOUNDARY_WAIT_MS).toBe(10 * 60_000);
  });

  it("план без сжатия не зовёт compact", async () => {
    const { boundary, calls } = setup();
    boundary.schedule(THREAD, { ...plan, compact: false });
    await boundary.service(THREAD);
    expect(calls).toEqual(["wait", "update:claude-sonnet-4-5"]);
  });

  it("план без модели не зовёт update", async () => {
    const { boundary, calls } = setup();
    boundary.schedule(THREAD, { ...plan, model: null });
    await boundary.service(THREAD);
    expect(calls).toEqual(["wait", "compact"]);
  });

  it("тред без назначенной границы не трогается", async () => {
    const { boundary, calls } = setup();
    await boundary.service(THREAD);
    expect(calls).toEqual([]);
    expect(boundary.scheduled(THREAD)).toBe(false);
  });

  it("план снимается при обслуживании: второй раз тот же тред не сжимается", async () => {
    const { boundary, calls } = setup();
    boundary.schedule(THREAD, plan);
    expect(boundary.scheduled(THREAD)).toBe(true);
    await boundary.service(THREAD);
    await boundary.service(THREAD);
    expect(calls.filter((call) => call === "compact")).toHaveLength(1);
    expect(boundary.scheduled(THREAD)).toBe(false);
  });

  it("второй schedule заменяет первый", async () => {
    const { boundary, calls } = setup();
    boundary.schedule(THREAD, plan);
    boundary.schedule(THREAD, { ...plan, compact: false, model: null });
    await boundary.service(THREAD);
    expect(calls).toEqual(["wait"]);
  });

  it("планы разных тредов не смешиваются", async () => {
    const { boundary, calls } = setup();
    boundary.schedule("thr_other", plan);
    await boundary.service(THREAD);
    expect(calls).toEqual([]);
    expect(boundary.scheduled("thr_other")).toBe(true);
  });

  it("сбой сжатия пишется в лог и не мешает смене модели", async () => {
    const { boundary, calls, warnings } = setup({ compact: true });
    boundary.schedule(THREAD, plan);
    await expect(boundary.service(THREAD)).resolves.toBeUndefined();
    expect(calls).toEqual(["wait", "compact", "update:claude-sonnet-4-5"]);
    expect(warnings.join("\n")).toContain("compaction failed");
  });

  it("сбой смены модели пишется в лог", async () => {
    const { boundary, warnings } = setup({ update: true });
    boundary.schedule(THREAD, plan);
    await expect(boundary.service(THREAD)).resolves.toBeUndefined();
    expect(warnings.join("\n")).toContain("update failed");
  });

  it("тред не простоял в срок — сжатие и модель не трогают идущий ход", async () => {
    const { boundary, calls, warnings } = setup({ wait: true });
    boundary.schedule(THREAD, plan);
    await expect(boundary.service(THREAD)).resolves.toBeUndefined();
    expect(calls).toEqual(["wait"]);
    expect(warnings.join("\n")).toContain("timed out");
  });
});

describe("граница этапов: продолжить сразу", () => {
  it("после обслуживания реплика идёт в очередь, а порядок — сжатие, модель, реплика", async () => {
    const { boundary, calls, sends } = setup();
    boundary.schedule(THREAD, plan);
    await boundary.continueNow(THREAD);
    expect(calls).toEqual(["wait", "compact", "update:claude-sonnet-4-5", "send"]);
    expect(sends).toEqual([{ mode: "queue-if-active", text: expect.stringContaining('carry on with stage implement "Implementation"') }]);
    expect(sends[0]!.text).toContain("Flow: the stage boundary is serviced");
  });

  it("сбой сжатия не теряет реплику", async () => {
    const { boundary, calls } = setup({ compact: true });
    boundary.schedule(THREAD, plan);
    await boundary.continueNow(THREAD);
    expect(calls).toEqual(["wait", "compact", "update:claude-sonnet-4-5", "send"]);
  });

  it("тред не простоял в срок — реплика всё равно уходит, но в очередь", async () => {
    const { boundary, calls, sends } = setup({ wait: true });
    boundary.schedule(THREAD, plan);
    await boundary.continueNow(THREAD);
    expect(calls).toEqual(["wait", "send"]);
    expect(sends[0]!.mode).toBe("queue-if-active");
  });

  it("границы нет или её уже обслужила другая реплика — второй реплики нет", async () => {
    const { boundary, sends } = setup();
    await boundary.continueNow(THREAD);
    boundary.schedule(THREAD, plan);
    await boundary.service(THREAD);
    await boundary.continueNow(THREAD);
    expect(sends).toEqual([]);
  });

  it("сбой отправки уходит наружу: вызывающий пишет его в лог", async () => {
    const { boundary } = setup({ send: true });
    boundary.schedule(THREAD, plan);
    await expect(boundary.continueNow(THREAD)).rejects.toThrow("send failed");
  });
});

describe("граница этапов: реплика только пока этап ждёт агента", () => {
  it("этап закрыт, пока тред простаивал, — реплики нет, сжатие и модель до этого прошли", async () => {
    let state: StageState = "todo";
    const { boundary, calls, sends } = setup({}, { state: () => state });
    boundary.schedule(THREAD, plan);
    const sending = boundary.continueNow(THREAD);
    state = "closed";
    await sending;
    expect(sends).toEqual([]);
    expect(calls).toEqual(["wait", "compact", "update:claude-sonnet-4-5"]);
  });

  it("этап уже закрыт к назначению — тред не трогают вовсе", async () => {
    const { boundary, calls, sends } = setup({}, { state: () => "closed" });
    boundary.schedule(THREAD, plan);
    await boundary.continueNow(THREAD);
    boundary.schedule(THREAD, plan);
    await boundary.service(THREAD);
    expect(calls).toEqual([]);
    expect(sends).toEqual([]);
  });

  it("границу после «готово» этап, уже начатый агентом, не будит; границу перед доработкой — будит", async () => {
    const started = setup({}, { state: () => "started" });
    started.boundary.schedule(THREAD, plan);
    await started.boundary.continueNow(THREAD);
    expect(started.sends).toEqual([]);
    const rework = setup({}, { state: () => "started" });
    rework.boundary.schedule(THREAD, { ...plan, fresh: false });
    await rework.boundary.continueNow(THREAD);
    expect(rework.sends).toHaveLength(1);
  });

  it("двойное «готово» в одном ходу — одна реплика", async () => {
    const { boundary, sends } = setup();
    boundary.schedule(THREAD, plan);
    const first = boundary.continueNow(THREAD);
    boundary.schedule(THREAD, plan);
    const second = boundary.continueNow(THREAD);
    await Promise.all([first, second]);
    expect(sends).toHaveLength(1);
    expect(boundary.scheduled(THREAD)).toBe(false);
  });

  it("после реплики об этапе граница помнит, что он продолжен", async () => {
    const { boundary } = setup();
    expect(boundary.carriedOn(THREAD, "implement")).toBe(false);
    boundary.schedule(THREAD, plan);
    await boundary.continueNow(THREAD);
    expect(boundary.carriedOn(THREAD, "implement")).toBe(true);
    expect(boundary.carriedOn(THREAD, "testing")).toBe(false);
  });
});

describe("граница этапов: протухший план", () => {
  it("план старше срока не обслуживает посторонний будящий вызов", async () => {
    let clock = 0;
    const { boundary, calls } = setup({}, { clock: () => clock });
    boundary.schedule(THREAD, plan);
    clock = PLAN_TTL_MS + 1;
    expect(boundary.scheduled(THREAD)).toBe(false);
    await boundary.service(THREAD);
    expect(calls).toEqual([]);
  });

  it("план в пределах срока обслуживается", async () => {
    let clock = 0;
    const { boundary, calls } = setup({}, { clock: () => clock });
    boundary.schedule(THREAD, plan);
    clock = PLAN_TTL_MS;
    await boundary.service(THREAD);
    expect(calls).toContain("compact");
  });
});

describe("модель треда и каталог для границы", () => {
  const sdkOf = (providerId: string, options: { model: string } | null) => ({
    threads: { get: async () => ({ providerId }), defaultExecutionOptions: async () => options },
    providers: {
      models: async () => ({
        providers: [{ id: "claude-code", available: true }],
        models: [
          { model: "claude-opus-4-1", isDefault: true, defaultReasoningEffort: "medium" },
          { model: "claude-sonnet-4-5", isDefault: false, defaultReasoningEffort: "medium" },
          { model: "gpt-5", isDefault: false, defaultReasoningEffort: "medium", routeProviderId: "codex" },
        ],
      }),
    },
  });

  it("тред Claude Code — его модель и модели провайдера, чужие маршруты не в счёт", async () => {
    const found = await stageModelsOf(sdkOf("claude-code", { model: "claude-opus-4-1" }) as never, THREAD);
    expect(found?.current).toBe("claude-opus-4-1");
    expect(found?.models.map((entry) => entry.model).sort()).toEqual(["claude-opus-4-1", "claude-sonnet-4-5"]);
  });

  it("модель треда неизвестна — current пуст, каталог на месте", async () => {
    expect((await stageModelsOf(sdkOf("claude-code", null) as never, THREAD))?.current).toBeNull();
  });

  it("тред другого провайдера — модель не меняется", async () => {
    expect(await stageModelsOf(sdkOf("codex", { model: "gpt-5" }) as never, THREAD)).toBeNull();
  });
});
