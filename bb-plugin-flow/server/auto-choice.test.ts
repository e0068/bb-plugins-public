// @vitest-environment node
// Выбор flow треду с «Автоматически» до хода агента: первое `gate` начинает выбор в фоне и держит сообщение,
// итог выбора назначается треду, и очередь перепроверяется.
import type { StepOutcome } from "@bb-plugins/automation-steps/index";
import { describe, expect, it, vi } from "vitest";

import { AUTO_FLOW, NO_FLOW } from "../core/flows";
import type { FlowSettings } from "../shared/contract";
import { createAutoChoice } from "./auto-choice";

const settings = (autoAgent?: FlowSettings["autoAgent"]) =>
  ({ flows: [{ id: "quick", name: "Quick", description: "Small edits", stages: [] }], ...(autoAgent === undefined ? {} : { autoAgent }) }) as unknown as FlowSettings;

const setup = (outcome: () => Promise<StepOutcome>, options: { autoAgent?: FlowSettings["autoAgent"] } = {}) => {
  const flows = new Map([["thr", AUTO_FLOW]]);
  const picks = new Map<string, string>();
  const calls: Array<{ input: string; env: Record<string, string> }> = [];
  const started = vi.fn(async () => undefined);
  const release = vi.fn();
  let done: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => (done = resolve));
  const choice = createAutoChoice({
    settings: () => settings(options.autoAgent),
    threads: { flowOf: (id) => flows.get(id), assign: async (id, flowId) => void flows.set(id, flowId), pickedOf: (id) => picks.get(id) },
    started,
    skill: async () => "RULES",
    script: async (input, env) => {
      calls.push({ input, env: { ...env } });
      return outcome();
    },
    release: () => {
      release();
      done();
    },
    warn: () => undefined,
  });
  return { choice, flows, picks, calls, started, release, finished };
};

describe("выбор flow до хода агента", () => {
  it("первое сообщение ждёт; модель назвала flow — он у треда с пустым прогоном, очередь перепроверена", async () => {
    const t = setup(async () => ({ ok: true, detail: "quick" }));
    expect(t.choice.gate("thr", "Почини кнопку")).toBe("wait");
    await t.finished;
    expect(t.flows.get("thr")).toBe("quick");
    expect(t.started).toHaveBeenCalledWith("thr");
    expect(t.calls[0]?.input).toContain("RULES");
    expect(t.calls[0]?.input).toContain("Почини кнопку");
    expect(t.choice.gate("thr", "Почини кнопку")).toBe("proceed");
  });

  it("модель ответила none — тред без flow, прогона нет", async () => {
    const t = setup(async () => ({ ok: true, detail: NO_FLOW }));
    t.choice.gate("thr", "Привет");
    await t.finished;
    expect(t.flows.get("thr")).toBe(NO_FLOW);
    expect(t.started).not.toHaveBeenCalled();
  });

  it.each([
    ["сбой скрипта", async (): Promise<StepOutcome> => ({ ok: false, error: "claude: not found" })],
    ["неизвестный id", async (): Promise<StepOutcome> => ({ ok: true, detail: "gone" })],
    ["исключение", async (): Promise<StepOutcome> => Promise.reject(new Error("boom"))],
  ])("%s — тред без flow, сообщение отпущено", async (_, outcome) => {
    const t = setup(outcome);
    t.choice.gate("thr", "Почини кнопку");
    await t.finished;
    expect(t.flows.get("thr")).toBe(NO_FLOW);
    expect(t.release).toHaveBeenCalledOnce();
  });

  it("назначение упало — сообщение уходит без flow, а выбор не начинается снова", async () => {
    const t = setup(async () => ({ ok: true, detail: "quick" }));
    const choice = createAutoChoice({
      settings: () => settings(),
      threads: { flowOf: () => AUTO_FLOW, assign: async () => Promise.reject(new Error("kv")), pickedOf: () => undefined },
      started: t.started,
      skill: async () => "RULES",
      script: async () => ({ ok: true, detail: "quick" }),
      release: t.release,
      warn: () => undefined,
    });
    choice.gate("thr", "a");
    await vi.waitFor(() => expect(t.release).toHaveBeenCalledOnce());
    expect(choice.gate("thr", "a")).toBe("proceed");
  });

  it("повторный gate, пока выбор идёт, ждёт и второго выбора не начинает", async () => {
    let answer: (outcome: StepOutcome) => void = () => undefined;
    const t = setup(() => new Promise((resolve) => (answer = resolve)));
    t.choice.gate("thr", "a");
    await vi.waitFor(() => expect(t.calls).toHaveLength(1));
    expect(t.choice.gate("thr", "a")).toBe("wait");
    answer({ ok: true, detail: "quick" });
    await t.finished;
    expect(t.calls).toHaveLength(1);
  });

  it("владелец выбрал flow над композером, пока модель думала, — выбор модели не ставится, попытка отправки применит выбор владельца", async () => {
    let answer: (outcome: StepOutcome) => void = () => undefined;
    const t = setup(() => new Promise((resolve) => (answer = resolve)));
    t.choice.gate("thr", "a");
    await vi.waitFor(() => expect(t.calls).toHaveLength(1));
    t.picks.set("thr", "other");
    answer({ ok: true, detail: "quick" });
    await t.finished;
    expect(t.flows.get("thr")).toBe(AUTO_FLOW);
    expect(t.started).not.toHaveBeenCalled();
    expect(t.choice.gate("thr", "a")).toBe("proceed");
  });

  it("тред снова на «Автоматически» к перепроверке — сообщение уходит, второй выбор не начинается", async () => {
    const t = setup(async () => ({ ok: true, detail: "quick" }));
    t.choice.gate("thr", "a");
    await t.finished;
    t.flows.set("thr", AUTO_FLOW);
    expect(t.choice.gate("thr", "a")).toBe("proceed");
    expect(t.calls).toHaveLength(1);
    // Следующее сообщение — уже новый ход: выбор снова.
    expect(t.choice.gate("thr", "b")).toBe("wait");
  });

  it("владелец сменил flow треда, пока модель думала, — его flow остаётся", async () => {
    let answer: (outcome: StepOutcome) => void = () => undefined;
    const t = setup(() => new Promise((resolve) => (answer = resolve)));
    t.choice.gate("thr", "a");
    await vi.waitFor(() => expect(t.calls).toHaveLength(1));
    t.flows.set("thr", "other");
    answer({ ok: true, detail: "quick" });
    await t.finished;
    expect(t.flows.get("thr")).toBe("other");
    expect(t.started).not.toHaveBeenCalled();
  });

  it("агент выбора — блок «Агент» строки «Автоматически», без блока — Claude Code с Sonnet", async () => {
    const own = setup(async () => ({ ok: true, detail: NO_FLOW }), { autoAgent: { execution: { providerId: "codex", model: "gpt-5", reasoningLevel: "low" } } });
    own.choice.gate("thr", "a");
    await own.finished;
    expect(own.calls[0]?.env).toEqual({ FLOW_PROVIDER: "codex", FLOW_MODEL: "gpt-5", FLOW_EFFORT: "low" });
    const fallback = setup(async () => ({ ok: true, detail: NO_FLOW }));
    fallback.choice.gate("thr", "a");
    await fallback.finished;
    expect(fallback.calls[0]?.env).toEqual({ FLOW_PROVIDER: "claude-code", FLOW_MODEL: "sonnet", FLOW_EFFORT: "low" });
  });
});
