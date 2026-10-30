// @vitest-environment node
// Граница этапов: Flow дожидается простоя треда, сжимает его, ставит модель следующего этапа и присылает «продолжай».
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { BOUNDARY_WAIT_MS, FALLBACK_MS, PLAN_TTL_MS, createBoundary, threadModelsOf, type StageState } from "./boundary";

const THREAD = "thr_boundary";

type Failing = { wait?: boolean; compact?: boolean; update?: boolean; send?: boolean };

const setup = (failing: Failing = {}, options: { state?: (stageId: string) => StageState; clock?: () => number } = {}) => {
  /** Запасные таймеры: тесты запускают их руками, минуту никто не ждёт. */
  const timers: Array<{ fire: () => Promise<void>; ms: number; cancelled: boolean }> = [];
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
        update: async (args: { model?: string | null | undefined; reasoningLevel?: string | null | undefined }) => {
          calls.push(`update:${args.model}/${args.reasoningLevel}`);
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
    ...(options.state === undefined ? {} : { stageState: async (_threadId: string, stageId: string) => options.state!(stageId) }),
    ...(options.clock === undefined ? {} : { now: options.clock }),
    setTimer: (fire, ms) => {
      const timer = { fire, ms, cancelled: false };
      timers.push(timer);
      return () => void (timer.cancelled = true);
    },
    warn: (message) => warnings.push(message),
  });
  /** Срабатывает последний живой таймер. */
  const fireTimer = async (): Promise<void> => {
    const live = timers.filter((timer) => !timer.cancelled);
    await live[live.length - 1]?.fire();
  };
  return { boundary, calls, waits, sends, warnings, timers, fireTimer };
};

const plan = { compact: true, model: { model: "claude-sonnet-4-5", reasoningLevel: "high" as const }, nextStage: 'implement "Implementation"', stageId: "implement", fresh: true };

describe("граница этапов: обслуживание", () => {
  it("ждёт простоя, сжимает, ставит модель — в таком порядке", async () => {
    const { boundary, calls, waits } = setup();
    boundary.schedule(THREAD, plan);
    await boundary.service(THREAD);
    expect(calls).toEqual(["wait", "compact", "update:claude-sonnet-4-5/high"]);
    expect(waits[0]).toMatchObject({ threadId: THREAD, status: "idle", timeoutMs: BOUNDARY_WAIT_MS });
  });

  it("предел ожидания — те же десять минут, что у реле", () => {
    expect(BOUNDARY_WAIT_MS).toBe(10 * 60_000);
  });

  it("план без сжатия не зовёт compact", async () => {
    const { boundary, calls } = setup();
    boundary.schedule(THREAD, { ...plan, compact: false });
    await boundary.service(THREAD);
    expect(calls).toEqual(["wait", "update:claude-sonnet-4-5/high"]);
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
    expect(calls).toEqual(["wait", "compact", "update:claude-sonnet-4-5/high"]);
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
    expect(calls).toEqual(["wait", "compact", "update:claude-sonnet-4-5/high", "send"]);
    expect(sends).toEqual([{ mode: "queue-if-active", text: expect.stringContaining('carry on with stage implement "Implementation"') }]);
    expect(sends[0]!.text).toContain("Flow: the stage boundary is serviced");
  });

  it("сбой сжатия не теряет реплику", async () => {
    const { boundary, calls } = setup({ compact: true });
    boundary.schedule(THREAD, plan);
    await boundary.continueNow(THREAD);
    expect(calls).toEqual(["wait", "compact", "update:claude-sonnet-4-5/high", "send"]);
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
    expect(calls).toEqual(["wait", "compact", "update:claude-sonnet-4-5/high"]);
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

describe("граница этапов: два обещания подряд", () => {
  const next = { ...plan, stageId: "implement", fresh: false, compact: false, model: { model: "claude-opus-5-5", reasoningLevel: "high" as const } };

  it("«готово» и тут же «начат» одним махом — реплика одна, с моделью нового этапа", async () => {
    let state: StageState = "todo";
    const { boundary, calls, sends } = setup({}, { state: () => state });
    boundary.schedule(THREAD, plan);
    const first = boundary.continueNow(THREAD);
    // Агент начал следующий этап, пока первое обещание ждало: второе обещание — доработка начатого этапа.
    state = "started";
    boundary.schedule(THREAD, next);
    const second = boundary.continueNow(THREAD);
    await Promise.all([first, second]);
    expect(sends).toHaveLength(1);
    expect(calls).toContain("update:claude-opus-5-5/high");
    expect(calls.at(-1)).toBe("send");
    expect(boundary.scheduled(THREAD)).toBe(false);
  });

  it("первое обещание уже обслужено, а второе пришло под отправку — реплика уходит и по нему", async () => {
    const { boundary, sends } = setup();
    boundary.schedule(THREAD, plan);
    const first = boundary.continueNow(THREAD);
    await Promise.resolve();
    boundary.schedule(THREAD, { ...plan, stageId: "review", nextStage: 'review "Review"' });
    await boundary.continueNow(THREAD);
    await first;
    expect(sends.map((sent) => sent.text)).toEqual([expect.stringContaining('review "Review"')]);
  });

  it("сжатие первого плана не пропадает, если этап к его обслуживанию уже начат", async () => {
    const { boundary, calls } = setup({}, { state: () => "started" });
    boundary.schedule(THREAD, plan);
    const first = boundary.continueNow(THREAD);
    boundary.schedule(THREAD, next);
    await Promise.all([first, boundary.continueNow(THREAD)]);
    expect(calls).toEqual(["wait", "compact", "update:claude-opus-5-5/high", "send"]);
  });
});

describe("граница этапов: отметка задним числом (тред 29.10)", () => {
  // Журнал: «practice — done» обещает carry on с code-review; через десять секунд, пока агент ещё в ходу, «questions — done»
  // даёт второе обещание, но с этапом, уже закрытым ранее в прогоне. Обе реплики ждали конца хода.
  const codeReview = { ...plan, compact: true, stageId: "code-review", nextStage: 'code-review "code-review"', fresh: true };
  const closedStage = { ...plan, compact: true, stageId: "practice", nextStage: 'practice "Execution"', fresh: true };
  const states = (id: string): StageState => (id === "practice" ? "closed" : "todo");

  it("второе обещание про закрытый этап не гасит первое: carry on идёт с code-review", async () => {
    const { boundary, sends } = setup({}, { state: states });
    boundary.schedule(THREAD, codeReview);
    const first = boundary.continueNow(THREAD);
    boundary.schedule(THREAD, closedStage);
    const second = boundary.continueNow(THREAD);
    await Promise.all([first, second]);
    expect(sends.map((sent) => sent.text)).toEqual([expect.stringContaining('carry on with stage code-review "code-review"')]);
  });

  it("основная отправка упала — запасной таймер шлёт carry on о code-review, а не молчит", async () => {
    const failing = { send: true };
    const { boundary, sends, fireTimer } = setup(failing, { state: states });
    boundary.schedule(THREAD, codeReview);
    const first = boundary.continueNow(THREAD);
    boundary.schedule(THREAD, closedStage);
    const second = boundary.continueNow(THREAD);
    await expect(Promise.all([first, second])).rejects.toThrow("send failed");
    failing.send = false;
    await fireTimer();
    expect(sends.map((sent) => sent.text)).toEqual([expect.stringContaining('code-review "code-review"')]);
  });

  it("оба обещания про закрытые этапы — реплики нет", async () => {
    const { boundary, sends, fireTimer } = setup({}, { state: () => "closed" });
    boundary.schedule(THREAD, codeReview);
    const first = boundary.continueNow(THREAD);
    boundary.schedule(THREAD, closedStage);
    await Promise.all([first, boundary.continueNow(THREAD)]);
    await fireTimer();
    expect(sends).toEqual([]);
  });
});

describe("граница этапов: запасной сигнал", () => {
  it("обещание ставит таймер на минуту", async () => {
    const { boundary, timers } = setup();
    boundary.schedule(THREAD, plan);
    await boundary.continueNow(THREAD);
    expect(timers).toHaveLength(1);
    expect(timers[0]!.ms).toBe(FALLBACK_MS);
    expect(FALLBACK_MS).toBe(60_000);
  });

  it("сигнал, отправленный вовремя, не дублируется", async () => {
    const { boundary, sends, fireTimer } = setup();
    boundary.schedule(THREAD, plan);
    await boundary.continueNow(THREAD);
    await fireTimer();
    expect(sends).toHaveLength(1);
  });

  it("пропавший сигнал приходит по таймеру — без сжатия и смены модели", async () => {
    const lost = setup({ send: true }, { state: () => "todo" });
    lost.boundary.schedule(THREAD, plan);
    await expect(lost.boundary.continueNow(THREAD)).rejects.toThrow("send failed");
    lost.calls.length = 0;
    await lost.fireTimer();
    expect(lost.calls).toEqual(["send"]);
  });

  it("основная отправка упала — таймер повторяет её, один раз", async () => {
    let broken = true;
    const sends: string[] = [];
    const { bb } = createFakePluginHost({ pluginId: "flow", sdk: { threads: { wait: async () => ({ matched: true }), compact: async () => ({ ok: true }), update: async () => ({}) } } });
    const timers: Array<() => Promise<void>> = [];
    const boundary = createBoundary({
      threads: bb.sdk.threads,
      send: async (_threadId, text) => {
        if (broken) throw new Error("stale API handle");
        sends.push(text);
      },
      setTimer: (fire) => {
        timers.push(fire);
        return () => undefined;
      },
      warn: () => undefined,
    });
    boundary.schedule(THREAD, plan);
    await expect(boundary.continueNow(THREAD)).rejects.toThrow("stale API handle");
    broken = false;
    await timers[0]!();
    await timers[0]!();
    expect(sends).toHaveLength(1);
  });

  it("агент сам начал следующий этап, не закончив ход, — таймер молчит", async () => {
    const { boundary, sends, fireTimer } = setup({}, { state: () => "started" });
    boundary.schedule(THREAD, plan);
    await boundary.continueNow(THREAD);
    await fireTimer();
    expect(sends).toEqual([]);
  });

  it("тред разбудил Flow после автоматизации — таймер молчит", async () => {
    const { boundary, sends, fireTimer } = setup({ send: true });
    boundary.schedule(THREAD, plan);
    await expect(boundary.continueNow(THREAD)).rejects.toThrow();
    boundary.schedule(THREAD, plan);
    await boundary.service(THREAD);
    await fireTimer();
    expect(sends).toEqual([]);
  });

  it("этап закрыт к сроку таймера — сигнала нет", async () => {
    let state: StageState = "todo";
    const { boundary, sends, fireTimer } = setup({ send: true }, { state: () => state });
    boundary.schedule(THREAD, plan);
    await expect(boundary.continueNow(THREAD)).rejects.toThrow();
    state = "closed";
    await fireTimer();
    expect(sends).toEqual([]);
  });

  it("новое обещание снимает таймер прежнего", async () => {
    const { boundary, timers } = setup();
    boundary.schedule(THREAD, plan);
    await boundary.continueNow(THREAD);
    boundary.schedule(THREAD, plan);
    await boundary.continueNow(THREAD);
    expect(timers.map((timer) => timer.cancelled)).toEqual([true, false]);
  });

  it("обслуживание ещё идёт — таймер ждёт ещё минуту, а не шлёт вторую реплику", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const timers: Array<{ fire: () => Promise<void>; cancelled: boolean }> = [];
    const sends: string[] = [];
    const { bb } = createFakePluginHost({ pluginId: "flow", sdk: { threads: { wait: async () => (await gate, { matched: true }), compact: async () => ({ ok: true }), update: async () => ({}) } } });
    const boundary = createBoundary({
      threads: bb.sdk.threads,
      send: async (_threadId, text) => void sends.push(text),
      setTimer: (fire) => {
        const timer = { fire, cancelled: false };
        timers.push(timer);
        return () => void (timer.cancelled = true);
      },
      warn: () => undefined,
    });
    boundary.schedule(THREAD, plan);
    const serving = boundary.continueNow(THREAD);
    await Promise.resolve();
    await timers[0]!.fire();
    expect(sends).toEqual([]);
    expect(timers).toHaveLength(2);
    release();
    await serving;
    await timers[1]!.fire();
    expect(sends).toHaveLength(1);
  });

  it("обещание старше срока плана таймер уже не обслуживает", async () => {
    let clock = 0;
    const { boundary, sends, fireTimer } = setup({ send: true }, { clock: () => clock });
    boundary.schedule(THREAD, plan);
    await expect(boundary.continueNow(THREAD)).rejects.toThrow();
    clock = PLAN_TTL_MS + 1;
    await fireTimer();
    expect(sends).toEqual([]);
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

describe("модель треда с каталогом effort", () => {
  const sdkOf = (providerId: string, options: { providerId: string; model: string; reasoningLevel: string } | null) => ({
    threads: { get: async () => ({ providerId }), defaultExecutionOptions: async () => options },
    providers: {
      models: async () => ({
        providers: [{ id: "claude-code", available: true }],
        models: [
          { model: "claude-opus-4-1", isDefault: true, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "medium" }, { reasoningEffort: "high" }] },
          { model: "claude-sonnet-4-5", isDefault: false, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "low" }] },
          { model: "gpt-5", isDefault: false, defaultReasoningEffort: "medium", routeProviderId: "codex" },
        ],
      }),
    },
  });

  it("тред Claude Code — модель с effort и модели провайдера со своими effort, чужие маршруты не в счёт", async () => {
    const found = await threadModelsOf(sdkOf("claude-code", { providerId: "claude-code", model: "claude-opus-4-1", reasoningLevel: "high" }) as never, THREAD);
    expect(found?.current).toEqual({ providerId: "claude-code", model: "claude-opus-4-1", reasoningLevel: "high" });
    expect(found?.models).toEqual([
      { model: "claude-opus-4-1", efforts: ["medium", "high"] },
      { model: "claude-sonnet-4-5", efforts: ["low"] },
    ]);
  });

  it("модель треда неизвестна — плана моделей нет", async () => {
    expect(await threadModelsOf(sdkOf("claude-code", null) as never, THREAD)).toBeNull();
  });

  it("тред другого провайдера — модель не меняется", async () => {
    expect(await threadModelsOf(sdkOf("codex", { providerId: "codex", model: "gpt-5", reasoningLevel: "medium" }) as never, THREAD)).toBeNull();
  });
});
